import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServerClient } from '@supabase/ssr';
import { adminClient, cleanupTestUsers, createTestUser, env } from '../tests/e2e/helpers';

const baseUrl = 'https://figocrm-navy.vercel.app';
const asaasUrl = process.env.ASAAS_API_BASE_URL;
const asaasKey = process.env.ASAAS_API_KEY;
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => fs.existsSync(path));

if (process.argv[2] !== '--confirm-sandbox' || asaasUrl !== 'https://api-sandbox.asaas.com/v3'
  || !asaasKey?.startsWith('$aact_hmlg_') || !chrome) {
  console.error('Use --confirm-sandbox, chave de homologação e Chrome/Edge instalado.');
  process.exit(1);
}

async function main() {
  const user = await createTestUser('live-checkout');
  let checkoutId: string | undefined;
  let browser;
  try {
    const jar = new Map<string, string>();
    const ssr = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    const { error: loginError } = await ssr.auth.signInWithPassword({ email: user.email, password: user.password });
    assert.ifError(loginError);

    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ locale: 'pt-BR' });
    await context.addCookies([...jar.entries()].map(([name, value]) => ({ name, value, url: baseUrl })));
    const page = await context.newPage();
    const accountResponse = await page.goto(`${baseUrl}/app/conta`, { waitUntil: 'domcontentloaded' });
    assert.equal(accountResponse?.status(), 200);
    const button = page.getByRole('button', { name: /Assinar Pro por R\$ 24,50\/mês/ });
    await button.waitFor({ timeout: 20_000 });
    let resolveCapture!: (value: { status: number; result: { url?: string; error?: string } }) => void;
    const capture = new Promise<{ status: number; result: { url?: string; error?: string } }>(
      (resolve) => { resolveCapture = resolve; },
    );
    await page.route('**/api/billing/checkout', async (route) => {
      const apiResponse = await route.fetch();
      const result = await apiResponse.json() as { url?: string; error?: string };
      resolveCapture({ status: apiResponse.status(), result });
      await route.fulfill({ response: apiResponse, body: JSON.stringify(result) });
    });
    await button.click();
    const { status, result } = await Promise.race([
      capture,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Checkout não respondeu em 20 s')), 20_000)),
    ]);
    assert.equal(status, 200, `Checkout retornou HTTP ${status} (${result.error || 'sem código'})`);
    assert.ok(result.url);
    const checkoutLink = new URL(result.url);
    assert.equal(checkoutLink.protocol, 'https:');
    assert.equal(checkoutLink.hostname, 'sandbox.asaas.com');
    await page.waitForURL((url) => url.hostname === 'sandbox.asaas.com', { timeout: 20_000 });

    const { data: row, error: rowError } = await adminClient().from('billing_checkout_sessions')
      .select('provider_checkout_id, status, checkout_url').eq('user_id', user.id)
      .eq('provider', 'asaas').order('created_at', { ascending: false }).limit(1).single();
    assert.ifError(rowError);
    assert.ok(row);
    checkoutId = row.provider_checkout_id;
    assert.equal(row.checkout_url, result.url);
    console.log(JSON.stringify({ appCheckoutHttpStatus: status, redirectedToSandbox: true,
      persisted: true, initialStatus: row.status }));
  } finally {
    await browser?.close();
    if (!checkoutId) {
      const { data } = await adminClient().from('billing_checkout_sessions').select('provider_checkout_id')
        .eq('user_id', user.id).eq('provider', 'asaas').order('created_at', { ascending: false }).limit(1).maybeSingle();
      checkoutId = data?.provider_checkout_id;
    }
    if (checkoutId) {
      const canceled = await fetch(`${asaasUrl}/checkouts/${encodeURIComponent(checkoutId)}/cancel`, {
        method: 'POST', headers: { access_token: asaasKey!, 'User-Agent': 'FigoCRM/1.0 (sandbox-smoke)' },
        signal: AbortSignal.timeout(10_000), cache: 'no-store',
      });
      console.log(JSON.stringify({ checkoutCanceled: canceled.ok, cancelHttpStatus: canceled.status }));
      if (!canceled.ok) process.exitCode = 1;
      if (canceled.ok) {
        let webhookProcessed = false;
        for (let i = 0; i < 20; i++) {
          const { data } = await adminClient().from('billing_events').select('processed_at,error')
            .eq('user_id', user.id).eq('event_type', 'checkout.canceled').limit(1).maybeSingle();
          if (data?.processed_at && !data.error) { webhookProcessed = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        console.log(JSON.stringify({ cancellationWebhookProcessed: webhookProcessed }));
        if (!webhookProcessed) process.exitCode = 1;
      }
    }
    await cleanupTestUsers();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha no checkout publicado.');
  process.exitCode = 1;
});
