import assert from 'node:assert/strict';
import { AsaasProvider, asaasConfig } from '../../src/lib/billing/asaas';

const provider = new AsaasProvider({ apiKey: 'test-key', webhookToken: 'test-webhook-token', baseUrl: 'https://api-sandbox.asaas.com/v3' });
const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init: RequestInit }> = [];

globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init: init || {} });
  if (String(url).endsWith('/checkouts')) return Response.json({ id: 'checkout-1', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1' });
  if (String(url).endsWith('/subscriptions/sub-1') && init?.method === 'PUT') return Response.json({ id: 'sub-1' });
  if (String(url).endsWith('/subscriptions/sub-1')) return Response.json({
    id: 'sub-1', customer: 'cus-1', status: 'ACTIVE', cycle: 'MONTHLY', billingType: 'CREDIT_CARD',
    value: 24.5, nextDueDate: '2026-11-01', externalReference: 'user-1',
  });
  throw new Error(`Unexpected URL: ${url}`);
};

async function main() {
try {
  const originalEnv = {
    ASAAS_API_BASE_URL: process.env.ASAAS_API_BASE_URL,
    ASAAS_API_KEY: process.env.ASAAS_API_KEY,
    ASAAS_WEBHOOK_TOKEN: process.env.ASAAS_WEBHOOK_TOKEN,
  };
  try {
    process.env.ASAAS_API_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    process.env.ASAAS_API_KEY = 'invalid-key';
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-secret';
    assert.strictEqual(asaasConfig(), null);
    process.env.ASAAS_API_KEY = '$aact_hmlg_dummy';
    process.env.ASAAS_WEBHOOK_TOKEN = 'your-dedicated-webhook-token';
    assert.strictEqual(asaasConfig(), null);
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-secret';
    assert.ok(asaasConfig());
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const checkout = await provider.createCheckout({ userId: 'user-1', email: 'test@example.com',
    successUrl: 'https://figocrm.test/success', cancelUrl: 'https://figocrm.test/cancel', nextDueDate: '2026-10-01' });
  assert.strictEqual(checkout.providerSessionId, 'checkout-1');
  const body = JSON.parse(String(requests[0].init.body));
  assert.deepStrictEqual(body.billingTypes, ['CREDIT_CARD']);
  assert.deepStrictEqual(body.chargeTypes, ['RECURRENT']);
  assert.strictEqual(body.items[0].value, 24.5);
  assert.strictEqual(body.subscription.cycle, 'MONTHLY');
  assert.match(body.subscription.nextDueDate, /^2026-10-01 \d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(body.externalReference, 'user-1');
  assert.strictEqual(body.customerData, undefined);
  assert.strictEqual(body.minutesToExpire, 60);
  assert.strictEqual((requests[0].init.headers as Record<string, string>).access_token, 'test-key');
  assert.match((requests[0].init.headers as Record<string, string>)['User-Agent'], /^FigoCRM\//);

  const raw = JSON.stringify({ id: 'evt-1', event: 'PAYMENT_CONFIRMED', payment: {
    id: 'pay-1', customer: 'cus-1', subscription: 'sub-1', dueDate: '2026-10-01',
  } });
  assert.strictEqual(await provider.verifyWebhook(raw, new Headers({ 'asaas-access-token': 'wrong' })), null);
  const event = await provider.verifyWebhook(raw, new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(event?.type, 'subscription.activated');
  assert.strictEqual(event?.userId, 'user-1');
  assert.strictEqual(event?.currentPeriodEnd, '2026-11-01T00:00:00.000Z');

  const checkoutPaid = await provider.verifyWebhook(JSON.stringify({ id: 'evt-2', event: 'CHECKOUT_PAID',
    checkout: { id: 'checkout-1', customer: 'cus-1' } }), new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(checkoutPaid?.type, 'checkout.paid');
  assert.strictEqual(checkoutPaid?.providerCustomerId, 'cus-1');
  const paymentCreated = await provider.verifyWebhook(JSON.stringify({ id: 'evt-3', event: 'PAYMENT_CREATED',
    payment: { id: 'pay-2', customer: 'cus-1', subscription: 'sub-1', checkoutSession: 'checkout-1' } }),
  new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(paymentCreated?.type, 'subscription.created');
  assert.strictEqual(paymentCreated?.providerCheckoutId, 'checkout-1');
  assert.strictEqual(paymentCreated?.providerSubscriptionId, 'sub-1');
  await provider.cancelSubscription({ providerSubscriptionId: 'sub-1', atPeriodEnd: true });
  await provider.reactivateSubscription({ providerSubscriptionId: 'sub-1' });
  const updates = requests.filter((r) => r.init.method === 'PUT').map((r) => JSON.parse(String(r.init.body)));
  assert.deepStrictEqual(updates.map((u) => u.status), ['INACTIVE', 'ACTIVE']);
  console.log('Asaas: checkout, token, evento financeiro e correlação passaram.');
} finally {
  globalThis.fetch = originalFetch;
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
