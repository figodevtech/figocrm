import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { AsaasProvider } from '../src/lib/billing/asaas';

dotenv.config({ path: '.env.local', quiet: true });

const baseUrl = process.env.ASAAS_API_BASE_URL;
const apiKey = process.env.ASAAS_API_KEY;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
if (process.argv[2] !== '--confirm-sandbox' || baseUrl !== 'https://api-sandbox.asaas.com/v3'
  || !apiKey?.startsWith('$aact_hmlg_') || !webhookToken) {
  console.error('Smoke test permitido apenas com --confirm-sandbox e credenciais de sandbox.');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'User-Agent': 'FigoCRM/1.0 (Node.js; sandbox-smoke)',
  access_token: apiKey,
};
async function main(): Promise<void> {
if (!apiKey || !webhookToken || !baseUrl) throw new Error('Configuração de sandbox ausente.');
const webhooksResponse = await fetch(`${baseUrl}/webhooks?offset=0&limit=100`, {
  headers, signal: AbortSignal.timeout(8000), cache: 'no-store',
});
if (!webhooksResponse.ok) throw new Error(`Falha ao consultar webhooks: HTTP ${webhooksResponse.status}`);
const webhooks = await webhooksResponse.json();
const hook = (Array.isArray(webhooks.data) ? webhooks.data : []).find((entry: { url: string; enabled: boolean }) => {
  try {
    const url = new URL(entry.url);
    return entry.enabled === true && url.protocol === 'https:' && url.pathname === '/api/webhooks/payment';
  } catch { return false; }
});
if (!hook) throw new Error('Webhook HTTPS ativo do FigoCRM não encontrado no sandbox.');

const endpointCheck = await fetch(hook.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'asaas-access-token': 'invalid-smoke-token' },
  body: JSON.stringify({ id: 'evt_invalid_smoke', event: 'CHECKOUT_CREATED' }),
  redirect: 'manual', signal: AbortSignal.timeout(8000), cache: 'no-store',
});
if (endpointCheck.status !== 401) throw new Error(`Webhook público ainda não está pronto (HTTP ${endpointCheck.status}).`);
const tokenCheck = await fetch(hook.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
  body: JSON.stringify({ id: `evt_auth_smoke_${randomUUID()}`, event: 'SMOKE_IGNORED' }),
  redirect: 'manual', signal: AbortSignal.timeout(8000), cache: 'no-store',
});
if (tokenCheck.status !== 200) throw new Error(`Token do webhook público não foi validado (HTTP ${tokenCheck.status}).`);

const origin = new URL(hook.url).origin;
const provider = new AsaasProvider({ apiKey, webhookToken, baseUrl });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  if (String(input) === `${baseUrl}/checkouts` && !response.ok) {
    const body = await response.clone().json().catch(() => ({}));
    const errors = Array.isArray(body.errors) ? body.errors : [];
    const safe = (value: unknown) => String(value || '').slice(0, 200)
      .replace(/\$aact_\S+/g, '[secret]')
      .replace(/https?:\/\/\S+/g, '[url]')
      .replace(/[\w.+-]+@[\w.-]+/g, '[email]');
    console.error(JSON.stringify({ checkoutHttpStatus: response.status,
      errors: errors.map((item: { code?: string; description?: string }) => ({
        code: safe(item.code), description: safe(item.description),
      })) }));
  }
  return response;
};
let checkoutId: string | undefined;
try {
  const checkout = await provider.createCheckout({
    userId: `smoke-${randomUUID()}`,
    email: 'qa-sandbox@example.com',
    successUrl: `${origin}/app/conta?checkout=retorno`,
    cancelUrl: `${origin}/app/conta`,
  });
  checkoutId = checkout.providerSessionId;
  console.log(JSON.stringify({ checkoutCreated: true, linkHttps: new URL(checkout.url).protocol === 'https:' }));
} finally {
  globalThis.fetch = originalFetch;
  if (checkoutId) {
    const canceled = await fetch(`${baseUrl}/checkouts/${encodeURIComponent(checkoutId)}/cancel`, {
      method: 'POST', headers, signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    console.log(JSON.stringify({ checkoutCanceled: canceled.ok, cancelHttpStatus: canceled.status }));
    if (!canceled.ok) {
      console.error(`Checkout de teste requer cancelamento manual: ${checkoutId}`);
      process.exitCode = 1;
    }
  }
}
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha no smoke test Asaas.');
  process.exitCode = 1;
});
