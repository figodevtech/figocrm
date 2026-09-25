// tests/e2e/subscription.e2e.ts
// Fases 4 e 8 contra o Supabase real: assinatura fail-closed no banco e no app, bloqueio da brecha de
// auto-upgrade, voz de consulta liberada com trial vencido e webhook de billing (assinatura + idempotência).

import assert from 'assert';
import crypto from 'crypto';
import { adminClient, createTestUser, run, seedCustomer, seedItem, sql, test, TestUser } from './helpers';
import { runVoicePipeline } from '../../src/lib/ai/orchestrator';
import { interpretVoiceCommandWithLLM } from '../../src/lib/ai/interpret';
import { getSubscriptionAccess } from '../../src/lib/subscription';
import { handleBillingWebhook } from '../../src/lib/billing/webhook';
import type { BillingProvider, NormalizedBillingEvent } from '../../src/lib/billing/types';
import { AsaasProvider } from '../../src/lib/billing/asaas';

let user: TestUser;
let customerId: string;

const setSub = (fields: string) => sql(`UPDATE subscriptions SET ${fields} WHERE user_id = $1`, [user.id]);
const access = () => getSubscriptionAccess(user.client);
const canInsert = async () => !(await user.client.from('customers').insert({ user_id: user.id, name: `Teste ${Date.now()}` })).error;

test('cadastro nasce em trial de 7 dias, criado no servidor', async () => {
  user = await createTestUser('sub');
  const [sub] = await sql<{ status: string; days: number }>(
    `SELECT status, round(extract(epoch FROM trial_ends_at - trial_started_at) / 86400)::int AS days FROM subscriptions WHERE user_id = $1`, [user.id]);
  assert.deepStrictEqual(sub, { status: 'trialing', days: 7 });
  const a = await access();
  assert.strictEqual(a.canWrite, true);
  assert.strictEqual(a.trialDaysRemaining, 7);
  customerId = await seedCustomer(user, 'Cliente Base');
});

test('brecha fechada: usuário não altera o próprio status/trial nem a tabela de assinatura', async () => {
  const profile = await user.client.from('profiles').update({ subscription_status: 'active', trial_ends_at: '2099-01-01' }).eq('id', user.id).select();
  assert.ok(profile.error, 'update de colunas de cobrança no profile deve falhar');
  const name = await user.client.from('profiles').update({ full_name: 'Nome Novo' }).eq('id', user.id).select('full_name');
  assert.ifError(name.error);

  const sub = await user.client.from('subscriptions').update({ status: 'active' }).eq('user_id', user.id).select();
  assert.ok(sub.error || (sub.data ?? []).length === 0, 'update em subscriptions deve falhar');
  const ins = await user.client.from('subscriptions').insert({ user_id: user.id, status: 'active' });
  assert.ok(ins.error);
  const catalog = await user.client.from('plan_entitlements').update({ voice_monthly_limit: 9999 })
    .eq('plan_code', 'free').select();
  assert.ok(catalog.error || (catalog.data ?? []).length === 0, 'usuário não muda a cota do catálogo');
  const checkout = await user.client.from('billing_checkout_sessions').insert({ user_id: user.id,
    provider: 'asaas', provider_checkout_id: 'forged', external_reference: user.id,
    checkout_url: 'https://asaas.com/forged', plan_code: 'figo_pro_plus_mensal', price_cents: 8990 });
  assert.ok(checkout.error, 'usuário não cria checkout pago na Data API');
  const [row] = await sql<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
  assert.strictEqual(row.status, 'trialing');
});

test('trial vencido: passa ao Free e mantém escrita e leitura', async () => {
  await setSub(`status = 'trialing', trial_ends_at = NOW() - INTERVAL '1 day'`);
  const a = await access();
  assert.deepStrictEqual([a.canWrite, a.reason, a.effectiveStatus, a.effectivePlan], [true, 'trial_expired', 'expired', 'free']);

  const direct = await user.client.from('customers').insert({ user_id: user.id, name: 'Cliente Free' });
  assert.ifError(direct.error);

  const item = await sql<{ id: string }>(`INSERT INTO items (user_id, name, acquisition_cost) VALUES ($1, 'Moto X', 100) RETURNING id`, [user.id]);
  const rpc = await user.client.rpc('execute_deal_transaction', {
    p_payload: { customer_id: customerId, deal_type: 'venda', total_value: 500, items_out: [{ item_id: item[0].id, evaluated_value: 500 }], cash_movements: [{ direction: 'IN', amount: 500 }] },
  });
  assert.ifError(rpc.error);
  const [{ n }] = await sql<{ n: number }>('SELECT count(*)::int AS n FROM deals WHERE user_id = $1', [user.id]);
  assert.strictEqual(n, 1);

  const read = await user.client.from('customers').select('id');
  assert.ifError(read.error);
  assert.ok((read.data ?? []).length >= 1, 'dados continuam acessíveis');
});

test('trial vencido: voz de consulta e escrita seguem disponíveis no Free', async () => {
  const deps = { supabase: user.client, userId: user.id, interpret: (t: string, c: Parameters<typeof interpretVoiceCommandWithLLM>[1]) => interpretVoiceCommandWithLLM(t, c, { mode: 'rules_only' }) };
  const query = await runVoicePipeline('Quanto dinheiro eu tenho na rua?', deps);
  assert.strictEqual(query.assistant.status, 'answered');

  assert.strictEqual((await access()).canWrite, true);
});

test('past_due: Pro durante carência, Free depois', async () => {
  await setSub(`status = 'past_due', past_due_at = NOW() - INTERVAL '1 day'`);
  assert.strictEqual((await access()).reason, 'past_due_grace');
  assert.strictEqual(await canInsert(), true);
  await setSub(`past_due_at = NOW() - INTERVAL '4 days'`);
  assert.strictEqual((await access()).effectivePlan, 'free');
  assert.strictEqual(await canInsert(), true);
});

test('active: Pro até o fim do período + carência; depois Free', async () => {
  await setSub(`status = 'active', current_period_end = NOW() + INTERVAL '20 days', past_due_at = NULL`);
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '1 day'`);
  assert.strictEqual((await access()).reason, 'renewal_pending');
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '5 days'`);
  assert.strictEqual((await access()).reason, 'renewal_overdue');
  assert.strictEqual((await access()).effectivePlan, 'free');
  assert.strictEqual(await canInsert(), true);
});

test('canceled e expired viram Free; blocked e assinatura ausente negam escrita', async () => {
  await setSub(`status = 'canceled', current_period_end = NOW() + INTERVAL '5 days'`);
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '1 hour'`);
  assert.strictEqual((await access()).effectivePlan, 'free');
  assert.strictEqual(await canInsert(), true);
  await setSub(`status = 'expired'`);
  assert.strictEqual(await canInsert(), true);
  await setSub(`status = 'blocked'`);
  assert.strictEqual(await canInsert(), false);
  await sql('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
  const a = await access();
  assert.deepStrictEqual([a.canWrite, a.reason], [false, 'subscription_missing']);
  assert.strictEqual(await canInsert(), false);
  await sql(`INSERT INTO subscriptions (user_id, status, trial_started_at, trial_ends_at) VALUES ($1, 'expired', NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day')`, [user.id]);
});

test('Free conta clientes avulsos e bloqueia o 11º no banco; edição continua', async () => {
  const limited = await createTestUser('free-limit');
  await sql(`UPDATE subscriptions SET status = 'expired', trial_ends_at = NOW() - INTERVAL '1 day' WHERE user_id = $1`, [limited.id]);
  for (let i = 0; i < 10; i++) {
    const { error } = await limited.client.from('customers').insert({
      user_id: limited.id, name: `Cliente ${i}`, is_provisional: i === 9,
    });
    assert.ifError(error);
  }
  const a = await getSubscriptionAccess(limited.client);
  assert.deepStrictEqual([a.customerCount, a.customerLimit, a.canCreateCustomer], [10, 10, false]);
  const extra = await limited.client.from('customers').insert({ user_id: limited.id, name: 'Cliente 11' });
  assert.strictEqual(extra.error?.hint, 'FREE_CUSTOMER_LIMIT');
  const { data: first } = await limited.client.from('customers').select('id').eq('name', 'Cliente 0').single();
  const edited = await limited.client.from('customers').update({ notes: 'Editado' }).eq('id', first!.id);
  assert.ifError(edited.error);
});

test('Pro aceita mais de 10 clientes; downgrade preserva dados e impede nova criação', async () => {
  const pro = await createTestUser('pro-downgrade');
  await sql(`UPDATE subscriptions SET status = 'active', current_period_end = NOW() + INTERVAL '30 days' WHERE user_id = $1`, [pro.id]);
  for (let i = 0; i < 11; i++) {
    const { error } = await pro.client.from('customers').insert({ user_id: pro.id, name: `Pro ${i}` });
    assert.ifError(error);
  }
  await sql(`UPDATE subscriptions SET status = 'expired' WHERE user_id = $1`, [pro.id]);
  const a = await getSubscriptionAccess(pro.client);
  assert.deepStrictEqual([a.effectivePlan, a.customerCount, a.canCreateCustomer], ['free', 11, false]);
  const read = await pro.client.from('customers').select('id');
  assert.ifError(read.error);
  assert.strictEqual(read.data?.length, 11);
  const extra = await pro.client.from('customers').insert({ user_id: pro.id, name: 'Pro 12' });
  assert.strictEqual(extra.error?.hint, 'FREE_CUSTOMER_LIMIT');
});

test('Free permite 20 comandos de voz no mês e recusa o 21º', async () => {
  const voice = await createTestUser('voice-quota');
  await sql(`UPDATE subscriptions SET status = 'expired' WHERE user_id = $1`, [voice.id]);
  for (let i = 0; i < 20; i++) {
    const { data, error } = await voice.client.rpc('consume_voice_rate_limit', {
      p_bucket: 'voice', p_limit_per_minute: 100, p_limit_per_hour: 100,
    });
    assert.ifError(error);
    assert.strictEqual(data.allowed, true);
  }
  const { data: denied, error } = await voice.client.rpc('consume_voice_rate_limit', {
    p_bucket: 'voice', p_limit_per_minute: 100, p_limit_per_hour: 100,
  });
  assert.ifError(error);
  assert.deepStrictEqual([denied.allowed, denied.reason, denied.monthly_limit], [false, 'monthly_limit', 20]);
  assert.strictEqual((await getSubscriptionAccess(voice.client)).voiceRemainingThisMonth, 0);
});

test('trial usa 300 comandos; Pro e Pro Mais respeitam 300 e 1000 no banco', async () => {
  const limited = await createTestUser('three-plan-voice');
  const consume = () => limited.client.rpc('consume_voice_rate_limit', {
    p_bucket: 'voice', p_limit_per_minute: 10000, p_limit_per_hour: 10000,
  });
  const seedUsage = (hits: number) => sql(`INSERT INTO voice_rate_limits (user_id,bucket,window_kind,window_start,hits)
    VALUES ($1,'voice','month',date_trunc('month',now()),$2)
    ON CONFLICT (user_id,bucket,window_kind,window_start) DO UPDATE SET hits = excluded.hits`, [limited.id, hits]);
  assert.deepStrictEqual([(await getSubscriptionAccess(limited.client)).effectivePlan,
    (await getSubscriptionAccess(limited.client)).voiceMonthlyLimit], ['pro', 300]);
  await seedUsage(299);
  assert.strictEqual((await consume()).data?.allowed, true);
  assert.deepStrictEqual([(await consume()).data?.allowed, (await consume()).data?.monthly_limit], [false, 300]);
  await sql(`UPDATE subscriptions SET status='active', plan_code='figo_pro_plus_mensal', price_cents=8990,
    current_period_end=now()+interval '30 days' WHERE user_id=$1`, [limited.id]);
  assert.deepStrictEqual([(await getSubscriptionAccess(limited.client)).effectivePlan,
    (await getSubscriptionAccess(limited.client)).voiceMonthlyLimit], ['pro_plus', 1000]);
  for (let i = 0; i < 11; i++) {
    const { error } = await limited.client.from('customers').insert({ user_id: limited.id, name: `Pro Mais ${i}` });
    assert.ifError(error);
  }
  await seedUsage(999);
  assert.strictEqual((await consume()).data?.allowed, true);
  assert.deepStrictEqual([(await consume()).data?.allowed, (await consume()).data?.monthly_limit], [false, 1000]);
  await sql(`UPDATE subscriptions SET plan_code='figo_pro_mensal', price_cents=3990 WHERE user_id=$1`, [limited.id]);
  await seedUsage(299);
  assert.strictEqual((await consume()).data?.allowed, true);
  assert.deepStrictEqual([(await consume()).data?.allowed, (await consume()).data?.monthly_limit], [false, 300]);
});

test('dois inserts simultâneos com 9 clientes só permitem chegar a 10', async () => {
  const concurrent = await createTestUser('free-concurrent');
  await sql(`UPDATE subscriptions SET status = 'expired' WHERE user_id = $1`, [concurrent.id]);
  for (let i = 0; i < 9; i++) await seedCustomer(concurrent, `Antes ${i}`);
  const results = await Promise.all(['A', 'B'].map((name) => concurrent.client.from('customers')
    .insert({ user_id: concurrent.id, name: `Concorrente ${name}` })));
  assert.strictEqual(results.filter((r) => !r.error).length, 1);
  assert.strictEqual(results.filter((r) => r.error?.hint === 'FREE_CUSTOMER_LIMIT').length, 1);
  assert.strictEqual((await getSubscriptionAccess(concurrent.client)).customerCount, 10);
});

// ------------------------------------------------------------------ billing webhook

const SECRET = 'test-webhook-secret';
const testProvider: BillingProvider = {
  name: 'test',
  createCustomer: async () => ({ providerCustomerId: 'cus_1' }),
  createSubscription: async () => { throw new Error('não usado'); },
  createCheckout: async () => { throw new Error('não usado'); },
  changeSubscriptionPlan: async () => undefined,
  cancelSubscription: async () => undefined,
  reactivateSubscription: async () => undefined,
  getSubscription: async () => null,
  async verifyWebhook(rawBody, headers) {
    const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const given = headers.get('x-test-signature') ?? '';
    if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
    const body = JSON.parse(rawBody);
    return { provider: 'test', eventId: body.id, type: body.type, userId: body.userId, providerSubscriptionId: body.subscriptionId,
      currentPeriodEnd: body.periodEnd, cancelAtPeriodEnd: body.cancelAtPeriodEnd,
      occurredAt: body.createdAt, raw: body } satisfies NormalizedBillingEvent;
  },
};

function webhookRequest(body: object, signature?: string): Request {
  const raw = JSON.stringify(body);
  return new Request('http://localhost/api/webhooks/payment', {
    method: 'POST',
    body: raw,
    headers: { 'x-test-signature': signature ?? crypto.createHmac('sha256', SECRET).update(raw).digest('hex') },
  });
}

test('webhook sem provedor configurado recusa e não altera nada', async () => {
  const res = await handleBillingWebhook(webhookRequest({ id: 'x' }), { provider: null });
  assert.strictEqual(res.status, 503);
});

test('cancelamento de assinatura sem conta vinculada é reconhecido sem travar a fila', async () => {
  const eventId = `evt_orphan_sub_cancel_${Date.now()}`;
  const response = await handleBillingWebhook(webhookRequest({ id: eventId, type: 'subscription.canceled',
    subscriptionId: 'sub_sem_conta', createdAt: new Date().toISOString() }),
  { provider: testProvider, admin: adminClient() });
  assert.strictEqual(response.status, 200);
  const { data } = await adminClient().from('billing_events').select('processed_at,error')
    .eq('event_id', eventId).single();
  assert.ok(data?.processed_at);
  assert.strictEqual(data?.error, null);
  await adminClient().from('billing_events').delete().eq('event_id', eventId);
});

test('webhook com assinatura inválida é recusado', async () => {
  const event = { id: `evt_${Date.now()}`, type: 'subscription.activated', userId: user.id, createdAt: new Date().toISOString() };
  const res = await handleBillingWebhook(webhookRequest(event, 'f'.repeat(64)), { provider: testProvider, admin: adminClient() });
  assert.strictEqual(res.status, 401);
  const [row] = await sql<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
  assert.strictEqual(row.status, 'expired');
});

test('webhook válido ativa a assinatura uma única vez (idempotente por event_id)', async () => {
  const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const event = { id: `evt_${Date.now()}`, type: 'subscription.activated', userId: user.id, subscriptionId: `sub_${user.id.slice(0, 8)}`, periodEnd, createdAt: new Date().toISOString() };
  const first = await handleBillingWebhook(webhookRequest(event), { provider: testProvider, admin: adminClient() });
  assert.deepStrictEqual(await first.json(), { received: true, applied: true, duplicate: false });
  const replay = await handleBillingWebhook(webhookRequest(event), { provider: testProvider, admin: adminClient() });
  assert.deepStrictEqual(await replay.json(), { received: true, applied: false, duplicate: true });

  const [row] = await sql<{ status: string; provider: string }>('SELECT status, provider FROM subscriptions WHERE user_id = $1', [user.id]);
  assert.deepStrictEqual(row, { status: 'active', provider: 'test' });
  const [{ n }] = await sql<{ n: number }>('SELECT count(*)::int AS n FROM billing_events WHERE event_id = $1', [event.id]);
  assert.strictEqual(n, 1);
  assert.strictEqual(await canInsert(), true, 'assinatura ativa libera escrita');
  await seedItem(user, 'Item pós-assinatura', 10);
  await sql('DELETE FROM billing_events WHERE provider = $1 AND user_id = $2', ['test', user.id]);
});

test('cancelamento mantém Pro pago até o vencimento e depois libera o Free', async () => {
  const event = { id: `evt_cancel_${Date.now()}`, type: 'subscription.canceled', userId: user.id,
    subscriptionId: `sub_${user.id.slice(0, 8)}`, cancelAtPeriodEnd: true, createdAt: new Date().toISOString() };
  const response = await handleBillingWebhook(webhookRequest(event), { provider: testProvider, admin: adminClient() });
  assert.strictEqual(response.status, 200);
  const paid = await access();
  assert.deepStrictEqual([paid.status, paid.effectivePlan, paid.reason, paid.cancelAtPeriodEnd],
    ['canceled', 'pro', 'canceled_until_period_end', true]);
  await setSub(`current_period_end = NOW() - INTERVAL '1 day'`);
  const free = await access();
  assert.deepStrictEqual([free.effectivePlan, free.reason], ['free', 'canceled']);
});

test('Asaas: checkout pago não ativa Pro Mais; pagamento autenticado ativa o plano comprado', async () => {
  const billed = await createTestUser('asaas-billing');
  await sql(`UPDATE subscriptions SET status = 'expired' WHERE user_id = $1`, [billed.id]);
  const checkoutId = `co_${Date.now()}`;
  const admin = adminClient();
  const { error: checkoutError } = await admin.from('billing_checkout_sessions').insert({
    user_id: billed.id, provider: 'asaas', provider_checkout_id: checkoutId,
    external_reference: billed.id, checkout_url: `https://sandbox.asaas.com/checkoutSession/show?id=${checkoutId}`,
    plan_code: 'figo_pro_plus_mensal', price_cents: 8990,
  });
  assert.ifError(checkoutError);
  const provider = new AsaasProvider({ apiKey: 'mock-key', webhookToken: 'mock-token', baseUrl: 'https://api-sandbox.asaas.com/v3' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('api-sandbox.asaas.com')
    ? Response.json({ id: 'sub_asaas_1', customer: 'cus_asaas_1', status: 'ACTIVE',
      cycle: 'MONTHLY', billingType: 'CREDIT_CARD', value: 89.9,
      nextDueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), externalReference: billed.id })
    : originalFetch(url, init);
  try {
    const req = (body: object, token = 'mock-token') => new Request('https://figocrm.test/api/webhooks/payment', {
      method: 'POST', headers: { 'asaas-access-token': token }, body: JSON.stringify(body),
    });
    const orphanEventId = `evt_orphan_cancel_${Date.now()}`;
    const orphanCanceled = await handleBillingWebhook(req({ id: orphanEventId, event: 'CHECKOUT_CANCELED',
      checkout: { id: 'checkout-sem-sessao' } }), { provider, admin });
    assert.strictEqual(orphanCanceled.status, 200);
    const { data: orphanLog, error: orphanReadError } = await admin.from('billing_events')
      .select('processed_at, error').eq('event_id', orphanEventId).single();
    assert.ifError(orphanReadError);
    assert.ok(orphanLog?.processed_at);
    assert.strictEqual(orphanLog?.error, null);
    await admin.from('billing_events').delete().eq('event_id', orphanEventId);
    const other = await createTestUser('asaas-other');
    const mismatchEventId = `evt_mismatch_${Date.now()}`;
    const mismatched = await handleBillingWebhook(req({ id: mismatchEventId, event: 'CHECKOUT_PAID',
      checkout: { id: checkoutId, customer: 'cus_asaas_1', externalReference: other.id } }), { provider, admin });
    assert.strictEqual(mismatched.status, 500);
    await admin.from('billing_events').delete().eq('event_id', mismatchEventId);
    assert.strictEqual((await getSubscriptionAccess(billed.client)).effectivePlan, 'free');
    const checkoutEvent = { id: `evt_checkout_${Date.now()}`, event: 'CHECKOUT_PAID',
      checkout: { id: checkoutId, customer: 'cus_asaas_1' } };
    const paid = await handleBillingWebhook(req(checkoutEvent), { provider, admin });
    assert.strictEqual(paid.status, 200);
    assert.strictEqual((await getSubscriptionAccess(billed.client)).effectivePlan, 'free');
    const created = await handleBillingWebhook(req({ id: `evt_payment_created_${Date.now()}`, event: 'PAYMENT_CREATED',
      payment: { id: 'pay_asaas_1', customer: 'cus_asaas_1', subscription: 'sub_asaas_1',
        checkoutSession: checkoutId } }), { provider, admin });
    assert.strictEqual(created.status, 200);
    assert.strictEqual((await getSubscriptionAccess(billed.client)).effectivePlan, 'free');
    const { data: linked, error: linkedError } = await admin.from('subscriptions')
      .select('provider_subscription_id').eq('user_id', billed.id).single();
    assert.ifError(linkedError);
    assert.strictEqual(linked?.provider_subscription_id, 'sub_asaas_1');
    const paymentEvent = { id: `evt_payment_${Date.now()}`, event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_asaas_1', customer: 'cus_asaas_1', subscription: 'sub_asaas_1',
        dueDate: new Date().toISOString().slice(0, 10), value: 89.9 } };
    const wrongPriceEvent = { ...paymentEvent, id: `evt_wrong_price_${Date.now()}`,
      payment: { ...paymentEvent.payment, value: 39.9 } };
    const wrongPrice = await handleBillingWebhook(req(wrongPriceEvent), { provider, admin });
    assert.strictEqual(wrongPrice.status, 500, 'valor diferente do checkout não ativa assinatura');
    assert.strictEqual((await getSubscriptionAccess(billed.client)).effectivePlan, 'free');
    await admin.from('billing_events').delete().eq('event_id', wrongPriceEvent.id);
    const badToken = await handleBillingWebhook(req(paymentEvent, 'wrong'), { provider, admin });
    assert.strictEqual(badToken.status, 401);
    assert.strictEqual((await getSubscriptionAccess(billed.client)).effectivePlan, 'free');
    const confirmed = await handleBillingWebhook(req(paymentEvent), { provider, admin });
    assert.strictEqual(confirmed.status, 200);
    const paidAccess = await getSubscriptionAccess(billed.client);
    assert.strictEqual(paidAccess.effectivePlan, 'pro_plus');
    assert.strictEqual(paidAccess.voiceMonthlyLimit, 1000);
    assert.strictEqual(paidAccess.effectiveStatus, 'active');
    assert.strictEqual(paidAccess.trialEndsAt, undefined);
    assert.ok(paidAccess.currentPeriodEnd);
    const replay = await handleBillingWebhook(req(paymentEvent), { provider, admin });
    assert.strictEqual((await replay.json()).duplicate, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

run('E2E: ASSINATURA FAIL-CLOSED E BILLING');
