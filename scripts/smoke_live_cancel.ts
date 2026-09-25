// Fluxo publicado de cancelamento e reativação com usuário e assinatura descartáveis do Sandbox.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServerClient } from '@supabase/ssr';
import { adminClient, cleanupTestUsers, createTestUser, env } from '../tests/e2e/helpers';

const appUrl = 'https://figocrm-navy.vercel.app';
const baseUrl = process.env.ASAAS_API_BASE_URL;
const apiKey = process.env.ASAAS_API_KEY;
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => fs.existsSync(path));

if (process.argv[2] !== '--confirm-sandbox' || baseUrl !== 'https://api-sandbox.asaas.com/v3'
  || !apiKey?.startsWith('$aact_hmlg_') || !chrome) {
  throw new Error('Use --confirm-sandbox, chave de homologação e Chrome/Edge instalado.');
}

const headers = { access_token: apiKey, 'User-Agent': 'FigoCRM/1.0 (live-cancel-smoke)',
  'Content-Type': 'application/json' };
async function call(path: string, method = 'GET', body?: object): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, { method, headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000), cache: 'no-store' });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} (${JSON.stringify(result.errors ?? [])})`);
  return result;
}
const dayAfter = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const testUser = await createTestUser('live-cancel');
  const id = randomUUID();
  let customerId: string | undefined;
  let subscriptionId: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const customer = await call('/customers', 'POST', { name: 'FigoCRM Teste Cancelamento',
      email: `qa-cancel-${id}@example.com`, cpfCnpj: '24971563792', mobilePhone: '47998781877',
      externalReference: testUser.id });
    assert.equal(typeof customer.id, 'string');
    customerId = customer.id as string;
    const paidUntil = dayAfter(15);
    const subscription = await call('/subscriptions', 'POST', { customer: customerId,
      billingType: 'CREDIT_CARD', nextDueDate: dayAfter(30), value: 24.5, cycle: 'MONTHLY',
      externalReference: testUser.id,
      creditCard: { holderName: 'Marcelo Henrique Almeida', number: '5162306219378829',
        expiryMonth: '05', expiryYear: '2030', ccv: '318' },
      creditCardHolderInfo: { name: 'Marcelo Henrique Almeida',
        email: `qa-cancel-${id}@example.com`, cpfCnpj: '24971563792',
        postalCode: '89223005', addressNumber: '277', phone: '4738010919',
        mobilePhone: '47998781877' }, remoteIp: '203.0.113.10',
    });
    assert.equal(typeof subscription.id, 'string');
    subscriptionId = subscription.id as string;
    const { error: linkError } = await adminClient().from('subscriptions').update({
      status: 'active', plan_code: 'figo_pro_mensal', price_cents: 2450,
      current_period_start: `${dayAfter(0)}T00:00:00.000Z`,
      current_period_end: `${paidUntil}T00:00:00.000Z`, trial_ends_at: null,
      provider: 'asaas', provider_customer_id: customerId, provider_subscription_id: subscriptionId,
    }).eq('user_id', testUser.id);
    assert.ifError(linkError);

    const jar = new Map<string, string>();
    const ssr = createServerClient(env.url, env.anonKey, { cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    } });
    assert.ifError((await ssr.auth.signInWithPassword({ email: testUser.email, password: testUser.password })).error);
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1100, height: 900 } });
    await context.addCookies([...jar.entries()].map(([name, value]) => ({ name, value, url: appUrl })));
    const page = await context.newPage();
    const account = await page.goto(`${appUrl}/app/conta`, { waitUntil: 'domcontentloaded' });
    assert.equal(account?.status(), 200);
    const cancelButton = page.getByRole('button', { name: 'Cancelar renovação' });
    await cancelButton.waitFor({ timeout: 20_000 });
    await cancelButton.click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar a renovação do Pro?' });
    await dialog.waitFor({ state: 'visible' });
    assert.match(await dialog.innerText(), new RegExp(paidUntil.split('-').reverse().join('/')));
    await page.screenshot({ path: process.env.CANCEL_SCREENSHOT_PATH
      || path.join(os.tmpdir(), 'figocrm-cancel-dialog-sandbox.png') });
    await dialog.getByRole('button', { name: 'Manter meu Pro' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await call(`/subscriptions/${subscriptionId}`)).status, 'ACTIVE');
    await cancelButton.click();
    await dialog.getByRole('button', { name: 'Confirmar cancelamento' }).click();
    await page.getByRole('button', { name: 'Reativar renovação do Pro' }).waitFor({ timeout: 25_000 });

    const stopped = await call(`/subscriptions/${subscriptionId}`);
    assert.equal(stopped.status, 'INACTIVE');
    const payments = await call(`/subscriptions/${subscriptionId}/payments?limit=100&offset=0`);
    assert.ok(((payments.data as Array<{ status: string; dueDate: string }>) || [])
      .every((payment) => payment.status !== 'PENDING' || payment.dueDate < paidUntil));
    const { data: canceled } = await adminClient().from('subscriptions')
      .select('status,cancel_at_period_end,current_period_end').eq('user_id', testUser.id).single();
    assert.equal(canceled?.status, 'canceled');
    assert.equal(canceled?.cancel_at_period_end, true);
    assert.equal(canceled?.current_period_end?.slice(0, 10), paidUntil);
    assert.match(await page.locator('body').innerText(), /Renovação cancelada/);

    // Simula o fim do período para verificar a tela Free sem oferecer reativação inválida.
    const { error: expireError } = await adminClient().from('subscriptions').update({
      current_period_end: `${dayAfter(-1)}T00:00:00.000Z`,
    }).eq('user_id', testUser.id);
    assert.ifError(expireError);
    await page.reload();
    await page.getByText('Sua assinatura Pro terminou.', { exact: false }).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole('button', { name: 'Reativar renovação do Pro' }).count(), 0);
    const { error: restoreError } = await adminClient().from('subscriptions').update({
      current_period_end: `${paidUntil}T00:00:00.000Z`,
    }).eq('user_id', testUser.id);
    assert.ifError(restoreError);
    await page.reload();

    await page.getByRole('button', { name: 'Reativar renovação do Pro' }).click();
    await page.getByRole('button', { name: 'Cancelar renovação' }).waitFor({ timeout: 25_000 });
    assert.equal((await call(`/subscriptions/${subscriptionId}`)).status, 'ACTIVE');
    const { data: reactivated } = await adminClient().from('subscriptions')
      .select('status,cancel_at_period_end').eq('user_id', testUser.id).single();
    assert.equal(reactivated?.status, 'active');
    assert.equal(reactivated?.cancel_at_period_end, false);
    console.log(JSON.stringify({ dialog: true, keptProOnDismiss: true, canceledAtPeriodEnd: true,
      futurePaymentsRemoved: true, reactivated: true }));
  } finally {
    await browser?.close();
    try { if (subscriptionId) await call(`/subscriptions/${encodeURIComponent(subscriptionId)}`, 'DELETE'); }
    finally {
      try { if (customerId) await call(`/customers/${encodeURIComponent(customerId)}`, 'DELETE'); }
      finally { await cleanupTestUsers(); }
    }
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
