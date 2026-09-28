// tests/e2e/ui-responsive.e2e.ts
// Validação das telas no navegador real (Chrome instalado, via playwright-core) contra `next start`:
//  - matriz de aparelhos com alturas reais e safe areas simuladas: sem overflow,
//    sem controles sob notch/status bar/home indicator e com alvos de toque adequados
//  - proteção de rotas (sem sessão → /login?next; logado em /login → /app)
//  - fluxos clicando: nova venda com parcelamento, receber pagamento + desfazer, voz contextual (texto)
//
//   npm run build && npx next start -p 3100
//   UI_BASE_URL=http://localhost:3100 UI_SCREENSHOT_DIR=<pasta> npx tsx tests/e2e/ui-responsive.e2e.ts

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServerClient } from '@supabase/ssr';
import { createTestUser, env, run, test, TestUser } from './helpers';
import { createCustomer } from '../../src/lib/domain/customers';
import { createItem } from '../../src/lib/domain/items';
import { buildManualSaleCommand } from '../../src/lib/domain/manual-deal-commands';
import { executeDealCommand } from '../../src/lib/domain/command-executor';
import { createLoanContract } from '../../src/lib/domain/loans';

const BASE = (process.env.UI_BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
const SHOTS = process.env.UI_SCREENSHOT_DIR;
type DeviceProfile = { name: string; width: number; height: number; safeTop: number; safeBottom: number };
const DEVICE_MATRIX: DeviceProfile[] = [
  { name: 'Android compacto', width: 360, height: 800, safeTop: 24, safeBottom: 0 },
  { name: 'iPhone SE', width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { name: 'iPhone 13/14', width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { name: 'iPhone Pro', width: 393, height: 852, safeTop: 59, safeBottom: 34 },
  { name: 'Android Pixel/Samsung', width: 412, height: 915, safeTop: 24, safeBottom: 0 },
  { name: 'iPhone Pro Max', width: 430, height: 932, safeTop: 59, safeBottom: 34 },
  { name: 'Tablet', width: 768, height: 1024, safeTop: 0, safeBottom: 0 },
  { name: 'Desktop', width: 1440, height: 900, safeTop: 0, safeBottom: 0 },
  { name: 'Mobile sem inset', width: 390, height: 844, safeTop: 0, safeBottom: 0 },
];
const selectedWidths = process.env.UI_WIDTHS?.split(',').map(Number).filter((width) => Number.isInteger(width) && width > 0);
const DEVICES = selectedWidths ? DEVICE_MATRIX.filter((device) => selectedWidths.includes(device.width)) : DEVICE_MATRIX;
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

let user: TestUser;
let browser: Browser;
let cookies: Array<{ name: string; value: string; url: string }> = [];
const ids: Record<string, string> = {};

async function authedContext(width: number, height = DEVICE_MATRIX.find((device) => device.width === width)?.height ?? 900): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', hasTouch: width < 1024 });
  await ctx.addCookies(cookies);
  await ctx.grantPermissions(['microphone'], { origin: BASE });
  return ctx;
}

async function open(page: Page, route: string) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 60_000 });
  assert.ok(res && res.status() < 400, `${route}: HTTP ${res?.status()}`);
  await page.locator('main h1').first().waitFor({ timeout: 15_000 });
}

async function applySafeArea(page: Page, device: DeviceProfile) {
  await page.addStyleTag({ content: `:root { --safe-top: ${device.safeTop}px !important; --safe-bottom: ${device.safeBottom}px !important; }` });
}

async function screenshot(page: Page, device: DeviceProfile, route: string) {
  if (!SHOTS || ![375, 390, 393, 412, 430, 1440].includes(device.width) || device.name === 'Mobile sem inset') return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const routeName = route.replace(/^\//, '').replaceAll('/', '_') || 'home';
  await page.screenshot({ path: path.join(SHOTS, `${device.width}x${device.height}-${routeName}.png`) });
}

test('setup: usuário com cliente, estoque, venda parcelada e empréstimo', async () => {
  assert.ok(CHROME, 'Chrome não encontrado (defina CHROME_PATH)');
  user = await createTestUser('ui');
  const carlos = await createCustomer(user.client, user.id, { name: 'Carlos Alberto', phone: '83999999999' });
  assert.ok(carlos.ok);
  ids.carlos = carlos.ok ? carlos.customer.id : '';
  const iphone = await createItem(user.client, user.id, { name: 'iPhone 13 128GB Preto', acquisitionCost: 2000, targetSalePrice: 2900 }, [{ category: 'reparo', amount: 250 }]);
  const samsung = await createItem(user.client, user.id, { name: 'Samsung A54', acquisitionCost: 900, targetSalePrice: 1500 });
  assert.ok(iphone.ok && samsung.ok);
  ids.iphone = iphone.ok ? iphone.itemId : '';
  const sale = buildManualSaleCommand({ customerId: ids.carlos, itemId: ids.iphone, totalValue: 3200, cashInflow: 1000, paymentMethod: 'pix', receivable: { totalAmount: 2200, installmentsCount: 4, installmentValue: 550 } });
  assert.ok(sale.ok);
  if (sale.ok) assert.ok((await executeDealCommand(sale.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' })).success);
  const loan = await createLoanContract(user.client, { customerId: ids.carlos, principal: 2000, interestType: 'fixed_amount', interestAmount: 500, installmentsCount: 5, source: 'manual' });
  assert.ok(loan.success);
  ids.loan = loan.loanContractId!;
  const avulso = await createCustomer(user.client, user.id, { name: 'Zé da Feira' }, { provisional: true });
  assert.ok(avulso.ok);
  ids.avulso = avulso.ok ? avulso.customer.id : '';
  const avulsoSale = buildManualSaleCommand({ customerId: ids.avulso, newItem: { name: 'Caixa de som' }, totalValue: 300, cashInflow: 300, paymentMethod: 'pix' });
  assert.ok(avulsoSale.ok);
  if (avulsoSale.ok) assert.ok((await executeDealCommand(avulsoSale.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' })).success);

  // Sessão pelo mesmo formato de cookie do app (@supabase/ssr)
  const jar = new Map<string, string>();
  const ssr = createServerClient(env.url, env.anonKey, {
    cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (list: Array<{ name: string; value: string }>) => list.forEach(({ name, value }) => jar.set(name, value)) },
  });
  assert.ifError((await ssr.auth.signInWithPassword({ email: user.email, password: user.password })).error);
  cookies = [...jar.entries()].map(([name, value]) => ({ name, value, url: BASE }));
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});

test('proteção de rotas no navegador: sem sessão → login com next; logado no /login → /app', async () => {
  const anon = await browser.newContext();
  const page = await anon.newPage();
  await page.goto(`${BASE}/app/clientes`);
  assert.match(page.url(), /\/login\?next=%2Fapp%2Fclientes$/);
  await anon.close();

  const ctx = await authedContext(390);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  assert.strictEqual(new URL(p.url()).pathname, '/app');
  await ctx.close();
});

const ROUTES = () => [
  '/app',
  '/app/clientes',
  `/app/clientes/${ids.carlos}`,
  '/app/clientes/novo',
  '/app/estoque',
  '/app/estoque/novo',
  `/app/estoque/${ids.iphone}`,
  '/app/vendas/nova',
  '/app/trocas/nova',
  '/app/emprestimos',
  '/app/emprestimos/novo',
  `/app/emprestimos/${ids.loan}`,
  `/app/emprestimos/${ids.loan}/contrato`,
  '/app/pendencias',
  `/app/receber?cliente=${ids.carlos}`,
  '/app/negocios',
  '/app/conta',
  `/app/clientes/${ids.avulso}`,
  '/app/estoque?filtro=revisar',
];

for (const device of DEVICES) {
  test(`${device.name} ${device.width}x${device.height}: safe areas, navegação e overflow`, async () => {
    const ctx = await authedContext(device.width, device.height);
    const page = await ctx.newPage();
    const problems: string[] = [];
    for (const route of ROUTES()) {
      await open(page, route);
      await applySafeArea(page, device);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const check = await page.evaluate(({ mobile, safeTop, safeBottom }) => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const sidebar = document.querySelectorAll('aside, [class*="sidebar" i], [aria-label*="menu" i]').length;
        const small: string[] = [];
        const header = document.querySelector('header');
        const headerControls = [...(header?.querySelectorAll('a, button') || [])].map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
        const bottomNav = document.querySelector('nav[aria-label="Navegação inferior"]');
        const bottomControls = [...(bottomNav?.querySelectorAll('a, button') || [])].map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
        const brand = header?.querySelector('a[aria-label="CRM Voz — Início"]')?.getBoundingClientRect();
        const badge = [...(header?.querySelectorAll('a[href="/app/conta"]') || [])]
          .map((element) => element.getBoundingClientRect()).find((rect) => rect.width && rect.height);
        const lastContent = document.querySelector('main')?.lastElementChild?.getBoundingClientRect();
        if (mobile) {
          for (const el of Array.from(document.querySelectorAll('main button, main a, nav a, nav button, [role="radio"], [role="tab"]'))) {
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if ((el as HTMLElement).closest('p')) continue; // link dentro de texto
            if (r.height < 40) small.push(`${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}(${Math.round(r.height)}px)`);
          }
        }
        return {
          overflow, sidebar, small, h1: document.querySelector('h1')?.textContent ?? '',
          headerSafe: !mobile || headerControls.every((rect) => rect.top >= safeTop - 1),
          headerTargets: !mobile || headerControls.every((rect) => rect.width >= 44 && rect.height >= 44),
          brandFits: !mobile || !brand || !badge || brand.right <= badge.left + 1,
          bottomSafe: !mobile || bottomControls.every((rect) => rect.bottom <= innerHeight - safeBottom + 1),
          bottomTargets: !mobile || bottomControls.every((rect) => rect.width >= 44 && rect.height >= 44),
          lastContentClear: !mobile || !lastContent || !bottomNav || lastContent.bottom <= bottomNav.getBoundingClientRect().top - 1,
        };
      }, { mobile: device.width < 1024, safeTop: device.safeTop, safeBottom: device.safeBottom });
      if (check.overflow > 1) problems.push(`${route}: rolagem horizontal de ${check.overflow}px`);
      if (check.sidebar > 0) problems.push(`${route}: sidebar/menu encontrado`);
      if (check.small.length > 0) problems.push(`${route}: alvos pequenos ${check.small.slice(0, 4).join(', ')}`);
      if (!check.h1) problems.push(`${route}: sem título (h1)`);
      if (!check.headerSafe) problems.push(`${route}: controle do header sob a status bar`);
      if (!check.headerTargets) problems.push(`${route}: controle do header menor que 44px`);
      if (!check.brandFits) problems.push(`${route}: nome e badge sobrepostos`);
      if (!check.bottomSafe) problems.push(`${route}: controle sobre o home indicator`);
      if (!check.bottomTargets) problems.push(`${route}: controle inferior menor que 44px`);
      if (!check.lastContentClear) problems.push(`${route}: último conteúdo encoberto pela barra`);
      if (['/app', '/app/clientes', '/app/estoque', '/app/conta'].includes(route)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await screenshot(page, device, route);
      }
    }
    await ctx.close();
    const anon = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    const login = await anon.newPage();
    for (const route of ['/login', '/cadastro', '/esqueci-senha']) {
      await open(login, route);
      await applySafeArea(login, device);
      const logoTop = await login.getByRole('link', { name: 'CRM Voz — página inicial' }).evaluate((element) => element.getBoundingClientRect().top);
      if (logoTop < device.safeTop - 1) problems.push(`${route}: logo sob a status bar`);
      await login.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const contentBottom = await login.locator('main > div').evaluate((element) => element.getBoundingClientRect().bottom);
      if (contentBottom > device.height - device.safeBottom + 1) problems.push(`${route}: último conteúdo encoberto pela safe area inferior`);
      if (route === '/login') {
        await login.evaluate(() => window.scrollTo(0, 0));
        await screenshot(login, device, route);
      }
    }
    await anon.close();
    assert.deepStrictEqual(problems, []);
  });
}

test('skip link focado aparece abaixo da safe area superior', async () => {
  const device = DEVICE_MATRIX.find((entry) => entry.name === 'iPhone Pro')!;
  const ctx = await authedContext(device.width, device.height);
  const page = await ctx.newPage();
  await open(page, '/app');
  await applySafeArea(page, device);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Pular para o conteúdo' });
  assert.ok(await skip.isVisible());
  const top = await skip.evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(top >= device.safeTop, `skip link começou em ${top}px, antes da safe area de ${device.safeTop}px`);
  await ctx.close();
});

test('celular: barra inferior com Falar no centro; desktop: navegação no topo (sem barra inferior)', async () => {
  const mobile = await authedContext(390);
  const m = await mobile.newPage();
  await open(m, '/app');
  const bottom = m.getByRole('navigation', { name: 'Navegação inferior' });
  assert.ok(await bottom.isVisible());
  assert.deepStrictEqual((await bottom.innerText()).split(/\s+/).filter(Boolean), ['Início', 'Clientes', 'Falar', 'Estoque', 'Conta']);
  // Atalhos grandes da Home continuam visíveis (a barra não substitui a Home)
  for (const label of ['Nova venda', 'Receber pagamento', 'Novo cliente', 'Nova mercadoria', 'Emprestar dinheiro', 'Nova troca']) {
    assert.ok(await m.getByRole('link', { name: new RegExp(label) }).isVisible(), label);
  }
  await mobile.close();

  const desk = await authedContext(1440);
  const d = await desk.newPage();
  await open(d, '/app');
  assert.ok(await d.getByRole('navigation', { name: 'Principal' }).isVisible());
  assert.strictEqual(await d.getByRole('navigation', { name: 'Navegação inferior' }).isVisible(), false);
  await desk.close();
});

test('clicando: Nova venda → Carlos → Samsung → 1500 → 500 no Pix + 2×500 → Venda registrada', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, '/app/vendas/nova');
  await page.getByRole('button', { name: /Carlos Alberto/ }).click();
  await page.getByRole('button', { name: /Samsung A54/ }).click();
  await page.getByLabel(/Por quanto vendeu/).fill('1500');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('checkbox', { name: 'Dinheiro / Pix' }).click();
  await page.getByLabel('Quanto ele pagou agora').fill('500');
  await page.getByRole('checkbox', { name: 'Ficou devendo' }).click();
  await page.getByLabel('Quantidade').fill('2');
  const status = page.getByRole('status').filter({ hasText: '×' });
  assert.match(await status.innerText(), /2 × R\$ 500 = R\$ 1\.000/, 'valor da parcela preenchido pela divisão exata');
  await page.getByLabel('Quantidade').fill('3');
  assert.match(await status.innerText(), /Passa R\$ 500/, 'conta que não fecha é avisada');
  assert.ok(await page.getByRole('button', { name: 'Continuar' }).isDisabled(), 'não deixa seguir');
  await page.getByLabel('Quantidade').fill('2');
  assert.match(await status.innerText(), /2 × R\$ 500 = R\$ 1\.000/);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Salvar venda' }).click();
  await page.getByRole('heading', { name: 'Venda registrada' }).waitFor({ timeout: 15000 });
  await ctx.close();
});

test('clicando: Receber → Carlos com 2 dívidas → escolhe empréstimo → 500 → Desfazer', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, `/app/receber?cliente=${ids.carlos}`);
  assert.ok(await page.getByText('Qual dívida ele está pagando?').isVisible(), 'mais de uma dívida: usuário escolhe');
  await page.getByRole('button', { name: /Empréstimo de R\$ 2\.000/ }).click();
  assert.strictEqual(await page.getByLabel('Valor recebido').inputValue(), '500');
  await page.getByRole('button', { name: 'Salvar pagamento' }).click();
  await page.getByText(/Recebido R\$ 500\. Falta R\$ 2\.000/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.getByText(/Desfiz o pagamento de R\$ 500/).waitFor({ timeout: 15000 });
  await ctx.close();
});

test('voz na tela do cliente: painel mostra o contexto e responde sobre ele (texto como fallback do microfone)', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, `/app/clientes/${ids.carlos}`);
  await page.getByRole('button', { name: 'Falar', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Falar' });
  await dialog.waitFor();
  assert.ok(await dialog.getByText('Sobre: Carlos Alberto').isVisible());
  await dialog.getByRole('button', { name: /Prefere digitar/ }).click();
  await dialog.getByLabel('O que aconteceu?').fill('Quanto ele me deve?');
  await dialog.getByRole('button', { name: 'Enviar' }).click();
  await dialog.getByText(/Carlos Alberto deve/).waitFor({ timeout: 30000 });
  const text = await dialog.innerText();
  assert.ok(!/STT|LLM|RPC|Structured/.test(text), 'sem termos técnicos');
  await page.keyboard.press('Escape');
  assert.strictEqual(await dialog.isVisible(), false);
  await ctx.close();
});

test('avulsos na tela: Home avisa; cliente avulso vinculado ao Carlos some; custo pendente é informado', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, '/app');
  assert.ok(await page.getByRole('link', { name: /1 cliente avulso/ }).isVisible(), 'aviso de cliente avulso na Home');
  assert.ok(await page.getByRole('link', { name: /1 venda sem custo/ }).isVisible(), 'aviso de venda sem custo na Home');

  await open(page, `/app/clientes/${ids.avulso}`);
  await page.getByRole('button', { name: 'Vincular a um cliente' }).click();
  await page.getByRole('button', { name: /Carlos Alberto/ }).click();
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await page.waitForURL((url) => url.pathname === `/app/clientes/${ids.carlos}`, { timeout: 15000 });
  await page.getByText('Venda — Caixa de som').waitFor({ timeout: 15000 });

  await open(page, '/app/estoque?filtro=revisar');
  await page.getByRole('link', { name: /Caixa de som/ }).first().click();
  await page.getByLabel('Valor de compra').fill('180');
  await page.getByRole('button', { name: 'Salvar custo' }).click();
  await page.getByText('Custo salvo. Lucro da venda: R$ 120.').waitFor({ timeout: 15000 });
  await ctx.close();
});

test('offline: avisa que ações dependem de conexão', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, '/app');
  await ctx.setOffline(true);
  await page.getByRole('status').filter({ hasText: 'Você está sem conexão' }).waitFor();
  assert.match(await page.getByRole('status').filter({ hasText: 'Você está sem conexão' }).innerText(), /Algumas ações precisam de internet para serem registradas/);
  await ctx.setOffline(false);
  await ctx.close();
});

test('logout bloqueia /app e permite login novamente', async () => {
  const ctx = await authedContext(390);
  const page = await ctx.newPage();
  await open(page, '/app/conta');
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15000 });
  await page.goto(`${BASE}/app`);
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15000 });
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => url.pathname === '/app', { timeout: 15000 });
  await ctx.close();
});

test('cookie de sessão inválido volta ao login sem loop e é removido', async () => {
  const tokenCookie = cookies.find((cookie) => cookie.name.includes('auth-token'));
  assert.ok(tokenCookie, 'cookie de sessão não encontrado');
  const ctx = await browser.newContext();
  await ctx.addCookies([{ ...tokenCookie, value: 'invalid' }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`);
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15000 });
  assert.ok(!(await ctx.cookies(BASE)).some((cookie) => cookie.name === tokenCookie.name && cookie.value === 'invalid'));
  await ctx.close();
});

test('encerra navegador', async () => {
  await browser?.close();
});

run(`UI: TELAS, RESPONSIVIDADE E FLUXOS NO NAVEGADOR (${BASE})`);
