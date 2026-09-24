// tests/e2e/ui-responsive.e2e.ts
// Validação das telas no navegador real (Chrome instalado, via playwright-core) contra `next start`:
//  - todas as telas do app em 360, 390, 430, 768, 1024 e 1440 px: sem rolagem horizontal,
//    sem sidebar / menu hambúrguer, alvos de toque ≥ 40 px no celular
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
const WIDTHS = [360, 390, 430, 768, 1024, 1440];
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

let user: TestUser;
let browser: Browser;
let cookies: Array<{ name: string; value: string; url: string }> = [];
const ids: Record<string, string> = {};

async function authedContext(width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, locale: 'pt-BR', hasTouch: width < 1024 });
  await ctx.addCookies(cookies);
  await ctx.grantPermissions(['microphone'], { origin: BASE });
  return ctx;
}

async function open(page: Page, route: string) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  assert.ok(res && res.status() < 400, `${route}: HTTP ${res?.status()}`);
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

  // Sessão pelo mesmo formato de cookie do app (@supabase/ssr)
  const jar = new Map<string, string>();
  const ssr = createServerClient(env.url, env.anonKey, {
    cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)) },
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
  `/app/receber?cliente=${ids.carlos}`,
  '/app/negocios',
  '/app/conta',
];

for (const width of WIDTHS) {
  test(`${width}px: todas as telas sem rolagem horizontal, sem sidebar/hambúrguer e com alvos de toque adequados`, async () => {
    const ctx = await authedContext(width);
    const page = await ctx.newPage();
    const problems: string[] = [];
    for (const route of ROUTES()) {
      await open(page, route);
      const check = await page.evaluate((mobile) => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const sidebar = document.querySelectorAll('aside, [class*="sidebar" i], [aria-label*="menu" i]').length;
        const small: string[] = [];
        if (mobile) {
          for (const el of Array.from(document.querySelectorAll('main button, main a, nav a, nav button, [role="radio"], [role="tab"]'))) {
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if ((el as HTMLElement).closest('p')) continue; // link dentro de texto
            if (r.height < 40) small.push(`${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}(${Math.round(r.height)}px)`);
          }
        }
        return { overflow, sidebar, small, h1: document.querySelector('h1')?.textContent ?? '' };
      }, width < 1024);
      if (check.overflow > 1) problems.push(`${route}: rolagem horizontal de ${check.overflow}px`);
      if (check.sidebar > 0) problems.push(`${route}: sidebar/menu encontrado`);
      if (check.small.length > 0) problems.push(`${route}: alvos pequenos ${check.small.slice(0, 4).join(', ')}`);
      if (!check.h1) problems.push(`${route}: sem título (h1)`);
      if (SHOTS && (width === 390 || width === 1440)) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const name = route.replace(/[^a-z0-9]+/gi, '_').replace(/_[0-9a-f]{8}_[0-9a-f_]{27}/gi, '_id').slice(0, 60);
        await page.screenshot({ path: path.join(SHOTS, `${width}${name}.png`), fullPage: true });
      }
    }
    await ctx.close();
    assert.deepStrictEqual(problems, []);
  });
}

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

test('encerra navegador', async () => {
  await browser?.close();
});

run(`UI: TELAS, RESPONSIVIDADE E FLUXOS NO NAVEGADOR (${BASE})`);
