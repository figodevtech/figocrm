// Verifica no Sandbox: parar recorrência, eliminar cobrança futura já criada e reativar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { AsaasProvider } from '../src/lib/billing/asaas';

dotenv.config({ path: '.env.local', quiet: true });

const baseUrl = process.env.ASAAS_API_BASE_URL;
const apiKey = process.env.ASAAS_API_KEY;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
if (process.argv[2] !== '--confirm-sandbox' || baseUrl !== 'https://api-sandbox.asaas.com/v3'
  || !apiKey?.startsWith('$aact_hmlg_') || !webhookToken) {
  throw new Error('Use --confirm-sandbox e credenciais exclusivas do Asaas Sandbox.');
}

const provider = new AsaasProvider({ baseUrl, apiKey, webhookToken });
const headers = { access_token: apiKey, 'User-Agent': 'FigoCRM/1.0 (sandbox-cancel-smoke)',
  'Content-Type': 'application/json' };

async function call(path: string, method = 'GET', body?: object): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, { method, headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000), cache: 'no-store' });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} (${JSON.stringify(result.errors ?? [])})`);
  return result;
}

function dayAfter(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const id = randomUUID();
  let customerId: string | undefined;
  let subscriptionId: string | undefined;
  try {
    const customer = await call('/customers', 'POST', {
      name: 'FigoCRM Teste Cancelamento', email: `qa-cancel-${id}@example.com`,
      cpfCnpj: '24971563792', mobilePhone: '47998781877', externalReference: `qa-cancel-${id}`,
    });
    customerId = String(customer.id);
    const firstDueDate = dayAfter(30);
    const paidUntil = dayAfter(15);
    const subscription = await call('/subscriptions', 'POST', {
      customer: customerId, billingType: 'CREDIT_CARD', nextDueDate: firstDueDate,
      value: 24.5, cycle: 'MONTHLY', externalReference: `qa-cancel-${id}`,
      creditCard: { holderName: 'Marcelo Henrique Almeida', number: '5162306219378829',
        expiryMonth: '05', expiryYear: '2030', ccv: '318' },
      creditCardHolderInfo: { name: 'Marcelo Henrique Almeida',
        email: `qa-cancel-${id}@example.com`, cpfCnpj: '24971563792',
        postalCode: '89223005', addressNumber: '277', phone: '4738010919',
        mobilePhone: '47998781877' },
      remoteIp: '203.0.113.10',
    });
    subscriptionId = String(subscription.id);
    const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
    const before = await call(`${path}/payments?limit=100&offset=0`);
    const pending = (before.data as Array<{ status: string; dueDate: string }> | undefined) ?? [];
    assert.ok(pending.some((payment) => payment.status === 'PENDING' && payment.dueDate >= paidUntil),
      'O Asaas não criou a cobrança futura esperada para este teste.');

    await provider.cancelSubscription({ providerSubscriptionId: subscriptionId,
      atPeriodEnd: true, currentPeriodEnd: `${paidUntil}T00:00:00.000Z` });
    const stopped = await call(path);
    assert.strictEqual(stopped.status, 'INACTIVE');
    const after = await call(`${path}/payments?limit=100&offset=0`);
    const remaining = (after.data as Array<{ status: string; dueDate: string }> | undefined) ?? [];
    assert.ok(remaining.every((payment) => payment.status !== 'PENDING' || payment.dueDate < paidUntil),
      'Restou uma cobrança futura pendente após o cancelamento.');

    await provider.reactivateSubscription({ providerSubscriptionId: subscriptionId });
    const restarted = await call(path);
    assert.strictEqual(restarted.status, 'ACTIVE');
    console.log(JSON.stringify({ futurePaymentRemoved: true, renewalStopped: true, reactivated: true }));
  } finally {
    if (subscriptionId) await call(`/subscriptions/${encodeURIComponent(subscriptionId)}`, 'DELETE');
    if (customerId) await call(`/customers/${encodeURIComponent(customerId)}`, 'DELETE');
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
