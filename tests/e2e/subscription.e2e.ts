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
  const [row] = await sql<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
  assert.strictEqual(row.status, 'trialing');
});

test('trial vencido: escrita negada no banco (REST e RPC), leitura liberada', async () => {
  await setSub(`status = 'trialing', trial_ends_at = NOW() - INTERVAL '1 day'`);
  const a = await access();
  assert.deepStrictEqual([a.canWrite, a.reason, a.effectiveStatus], [false, 'trial_expired', 'expired']);

  const direct = await user.client.from('customers').insert({ user_id: user.id, name: 'Não deve gravar' });
  assert.strictEqual(direct.error?.hint, 'SUBSCRIPTION_INACTIVE');

  const item = await sql<{ id: string }>(`INSERT INTO items (user_id, name, acquisition_cost) VALUES ($1, 'Moto X', 100) RETURNING id`, [user.id]);
  const rpc = await user.client.rpc('execute_deal_transaction', {
    p_payload: { customer_id: customerId, deal_type: 'venda', total_value: 500, items_out: [{ item_id: item[0].id, evaluated_value: 500 }], cash_movements: [{ direction: 'IN', amount: 500 }] },
  });
  assert.strictEqual(rpc.error?.hint, 'SUBSCRIPTION_INACTIVE');
  const [{ n }] = await sql<{ n: number }>('SELECT count(*)::int AS n FROM deals WHERE user_id = $1', [user.id]);
  assert.strictEqual(n, 0);

  const read = await user.client.from('customers').select('id');
  assert.ifError(read.error);
  assert.ok((read.data ?? []).length >= 1, 'dados continuam acessíveis');
});

test('trial vencido: voz de consulta responde; voz de escrita recusa com mensagem de assinatura', async () => {
  const deps = { supabase: user.client, userId: user.id, interpret: (t: string, c: Parameters<typeof interpretVoiceCommandWithLLM>[1]) => interpretVoiceCommandWithLLM(t, c, { mode: 'rules_only' }) };
  const query = await runVoicePipeline('Quanto dinheiro eu tenho na rua?', deps);
  assert.strictEqual(query.assistant.status, 'answered');

  const write = await runVoicePipeline('Vendi o Moto X pro Cliente Base por 500 no Pix.', deps);
  assert.strictEqual(write.assistant.status, 'error');
  assert.strictEqual(write.assistant.status === 'error' && write.assistant.code, 'subscription_required');
  assert.match(write.assistant.message, /teste grátis de 7 dias acabou/);
});

test('past_due: escreve dentro da carência de 3 dias, bloqueia depois', async () => {
  await setSub(`status = 'past_due', past_due_at = NOW() - INTERVAL '1 day'`);
  assert.strictEqual((await access()).reason, 'past_due_grace');
  assert.strictEqual(await canInsert(), true);
  await setSub(`past_due_at = NOW() - INTERVAL '4 days'`);
  assert.strictEqual((await access()).canWrite, false);
  assert.strictEqual(await canInsert(), false);
});

test('active: escreve até o fim do período + carência; renovação atrasada além disso bloqueia', async () => {
  await setSub(`status = 'active', current_period_end = NOW() + INTERVAL '20 days', past_due_at = NULL`);
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '1 day'`);
  assert.strictEqual((await access()).reason, 'renewal_pending');
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '5 days'`);
  assert.strictEqual((await access()).reason, 'renewal_overdue');
  assert.strictEqual(await canInsert(), false);
});

test('canceled: escreve até o fim do período pago; expired, blocked e assinatura ausente bloqueiam', async () => {
  await setSub(`status = 'canceled', current_period_end = NOW() + INTERVAL '5 days'`);
  assert.strictEqual(await canInsert(), true);
  await setSub(`current_period_end = NOW() - INTERVAL '1 hour'`);
  assert.strictEqual(await canInsert(), false);
  for (const status of ['expired', 'blocked']) {
    await setSub(`status = '${status}'`);
    assert.strictEqual(await canInsert(), false, status);
  }
  await sql('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
  const a = await access();
  assert.deepStrictEqual([a.canWrite, a.reason], [false, 'subscription_missing']);
  assert.strictEqual(await canInsert(), false);
  await sql(`INSERT INTO subscriptions (user_id, status, trial_started_at, trial_ends_at) VALUES ($1, 'expired', NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day')`, [user.id]);
});

// ------------------------------------------------------------------ billing webhook

const SECRET = 'test-webhook-secret';
const testProvider: BillingProvider = {
  name: 'test',
  createCustomer: async () => ({ providerCustomerId: 'cus_1' }),
  createSubscription: async () => { throw new Error('não usado'); },
  createCheckout: async () => { throw new Error('não usado'); },
  cancelSubscription: async () => undefined,
  reactivateSubscription: async () => undefined,
  getSubscription: async () => null,
  async verifyWebhook(rawBody, headers) {
    const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const given = headers.get('x-test-signature') ?? '';
    if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
    const body = JSON.parse(rawBody);
    return { provider: 'test', eventId: body.id, type: body.type, userId: body.userId, providerSubscriptionId: body.subscriptionId,
      currentPeriodEnd: body.periodEnd, occurredAt: body.createdAt, raw: body } satisfies NormalizedBillingEvent;
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

run('E2E: ASSINATURA FAIL-CLOSED E BILLING');
