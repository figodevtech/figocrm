import assert from 'node:assert/strict';
import { AsaasProvider, asaasConfig } from '../../src/lib/billing/asaas';
import { requestedPlanFromPayload } from '../../src/lib/billing/types';

const provider = new AsaasProvider({ apiKey: 'test-key', webhookToken: 'test-webhook-token', baseUrl: 'https://api-sandbox.asaas.com/v3' });
const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init: RequestInit }> = [];
let subscriptionStatus = 'ACTIVE';
let futurePaymentDeleted = false;
let subscriptionMissing = false;

globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init: init || {} });
  if (String(url).endsWith('/checkouts')) return Response.json({ id: 'checkout-1', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1' });
  if (String(url).endsWith('/subscriptions/sub-1') && init?.method === 'PUT') {
    subscriptionStatus = JSON.parse(String(init.body)).status || subscriptionStatus;
    return Response.json({ id: 'sub-1', status: subscriptionStatus });
  }
  if (String(url).endsWith('/subscriptions/sub-1') && subscriptionMissing)
    return Response.json({}, { status: 404 });
  if (String(url).endsWith('/subscriptions/sub-1')) return Response.json({
    id: 'sub-1', customer: 'cus-1', status: subscriptionStatus, cycle: 'MONTHLY', billingType: 'CREDIT_CARD',
    value: 39.9, nextDueDate: '2026-11-01', externalReference: 'user-1',
  });
  if (String(url).includes('/subscriptions/sub-1/payments?')) return Response.json({
    data: [
      { id: 'pay-paid', status: 'CONFIRMED', dueDate: '2026-10-01' },
      { id: 'pay-prior', status: 'PENDING', dueDate: '2026-10-15' },
      ...(futurePaymentDeleted ? [] : [{ id: 'pay-next', status: 'PENDING', dueDate: '2026-11-01' }]),
    ], hasMore: false,
  });
  if (String(url).endsWith('/payments/pay-next') && init?.method === 'DELETE') {
    futurePaymentDeleted = true;
    return Response.json({ deleted: true });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

async function main() {
try {
  assert.strictEqual(requestedPlanFromPayload({ plan: 'pro' }), 'pro');
  assert.strictEqual(requestedPlanFromPayload({ plan: 'pro_plus' }), 'pro_plus');
  for (const bad of [{ plan: 'free' }, { plan: 'pro', priceCents: 1 }, { plan: 'pro_plus', price: 0 }, {}, null])
    assert.strictEqual(requestedPlanFromPayload(bad), null);
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
    plan: 'pro', successUrl: 'https://figocrm.test/success', cancelUrl: 'https://figocrm.test/cancel', nextDueDate: '2026-10-01' });
  assert.strictEqual(checkout.providerSessionId, 'checkout-1');
  const body = JSON.parse(String(requests[0].init.body));
  assert.deepStrictEqual(body.billingTypes, ['CREDIT_CARD']);
  assert.deepStrictEqual(body.chargeTypes, ['RECURRENT']);
  assert.strictEqual(body.items[0].value, 39.9);
  await provider.createCheckout({ userId: 'user-1', email: 'test@example.com', plan: 'pro_plus',
    successUrl: 'https://figocrm.test/success', cancelUrl: 'https://figocrm.test/cancel' });
  assert.strictEqual(JSON.parse(String(requests[1].init.body)).items[0].value, 89.9);
  assert.strictEqual(body.subscription.cycle, 'MONTHLY');
  assert.match(body.subscription.nextDueDate, /^2026-10-01 \d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(body.externalReference, 'user-1');
  assert.strictEqual(body.customerData, undefined);
  assert.strictEqual(body.minutesToExpire, 60);
  assert.strictEqual((requests[0].init.headers as Record<string, string>).access_token, 'test-key');
  assert.match((requests[0].init.headers as Record<string, string>)['User-Agent'], /^FigoCRM\//);

  const raw = JSON.stringify({ id: 'evt-1', event: 'PAYMENT_CONFIRMED', payment: {
    id: 'pay-1', customer: 'cus-1', subscription: 'sub-1', dueDate: '2026-10-01', value: 39.9,
  } });
  assert.strictEqual(await provider.verifyWebhook(raw, new Headers({ 'asaas-access-token': 'wrong' })), null);
  const event = await provider.verifyWebhook(raw, new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(event?.type, 'subscription.activated');
  assert.strictEqual(event?.userId, 'user-1');
  assert.strictEqual(event?.currentPeriodStart, '2026-10-01T00:00:00.000Z');
  assert.strictEqual(event?.currentPeriodEnd, '2026-11-01T00:00:00.000Z');
  assert.strictEqual(event?.cancelAtPeriodEnd, false);

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
  await provider.cancelSubscription({ providerSubscriptionId: 'sub-1', atPeriodEnd: true,
    currentPeriodEnd: '2026-11-01T00:00:00.000Z' });
  assert.strictEqual(futurePaymentDeleted, true);
  await provider.cancelSubscription({ providerSubscriptionId: 'sub-1', atPeriodEnd: true,
    currentPeriodEnd: '2026-11-01T00:00:00.000Z' });
  assert.strictEqual(requests.filter((r) => r.url.endsWith('/payments/pay-next') && r.init.method === 'DELETE').length, 1);
  const delayedPayment = await provider.verifyWebhook(raw, new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(delayedPayment?.cancelAtPeriodEnd, true, 'cobrança tardia não religa recorrência inativa');
  await provider.reactivateSubscription({ providerSubscriptionId: 'sub-1' });
  await provider.changeSubscriptionPlan({ providerSubscriptionId: 'sub-1', plan: 'pro_plus' });
  const staleInactivated = await provider.verifyWebhook(JSON.stringify({ id: 'evt-4',
    event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: 'sub-1' } }),
  new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(staleInactivated?.type, 'ignored', 'webhook atrasado não cancela assinatura reativada');
  subscriptionMissing = true;
  const removedBeforeDelivery = await provider.verifyWebhook(JSON.stringify({ id: 'evt-5',
    event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: 'sub-1' } }),
  new Headers({ 'asaas-access-token': 'test-webhook-token' }));
  assert.strictEqual(removedBeforeDelivery?.type, 'subscription.canceled');
  const updates = requests.filter((r) => r.init.method === 'PUT').map((r) => JSON.parse(String(r.init.body)));
  assert.deepStrictEqual(updates.map((u) => u.status), ['INACTIVE', 'ACTIVE', undefined]);
  assert.deepStrictEqual([updates[2].value, updates[2].updatePendingPayments], [89.9, false]);
  assert.strictEqual(requests.filter((r) => r.url.endsWith('/checkouts')).length, 2,
    'mudança de plano não cria outra assinatura');
  console.log('Asaas: checkout, token, evento financeiro e correlação passaram.');
} finally {
  globalThis.fetch = originalFetch;
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
