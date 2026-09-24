// tests/unit/domain.test.ts
// Testes offline das regras de domínio deste ciclo: assinatura fail-closed, renegociação, escolha do
// estorno, eventos de billing e tradução dos formulários manuais em DealCommand.

import assert from 'assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubscriptionAccess, parseAccessRow, assertWritePermission, SubscriptionWriteDeniedError } from '../../src/lib/subscription';
import { planRenegotiation } from '../../src/lib/domain/financial-operations';
import { pickSettlement, ReversibleSettlement } from '../../src/lib/domain/financial-target-resolver';
import { subscriptionUpdateFor } from '../../src/lib/billing/service';
import { buildManualSaleCommand, buildManualTradeCommand } from '../../src/lib/domain/manual-deal-commands';
import { buildDealCommand } from '../../src/lib/ai/command-builder';
import { validateDealBalance } from '../../src/lib/finance/deal-balance';
import type { NormalizedBillingEvent } from '../../src/lib/billing/types';
import { confirmationAnswer, describeForReadback } from '../../src/lib/ai/readback';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function fakeRpc(result: { data?: unknown; error?: { message: string } } | Error): SupabaseClient {
  return {
    rpc: async () => {
      if (result instanceof Error) throw result;
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient;
}

const row = (over: Record<string, unknown>) => ({
  status: 'trialing', effective_status: 'trialing', effective_plan: 'pro', can_read: true, can_write: true, reason: 'trial',
  customer_count: 0, customer_limit: null, can_create_customer: true,
  voice_monthly_limit: 1000, voice_used_this_month: 0, voice_remaining_this_month: 1000,
  trial_ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), current_period_end: null, grace_until: null,
  cancel_at_period_end: false, ...over,
});

// ------------------------------------------------------------------ assinatura

test('fail-closed: erro do Supabase, exceção, resposta vazia ou malformada negam escrita', async () => {
  for (const client of [
    fakeRpc({ error: { message: 'boom' } }),
    fakeRpc(new Error('network')),
    fakeRpc({ data: [] }),
    fakeRpc({ data: [{ foo: 1 }] }),
    fakeRpc({ data: [row({ can_write: 'true' })] }),
  ]) {
    const access = await getSubscriptionAccess(client);
    assert.strictEqual(access.canWrite, false);
    assert.strictEqual(access.reason, 'billing_unavailable');
  }
});

test('fail-closed: assinatura/perfil ausente e blocked negam escrita com mensagem clara', async () => {
  for (const [reason, status] of [
    ['subscription_missing', 'missing'],
    ['blocked', 'blocked'],
  ] as const) {
    const client = fakeRpc({ data: [row({ can_write: false, reason, effective_status: status })] });
    await assert.rejects(assertWritePermission(undefined, client), (err: unknown) => {
      assert.ok(err instanceof SubscriptionWriteDeniedError);
      assert.strictEqual(err.reason, reason);
      assert.ok(err.message.length > 10 && !/null|undefined|error/i.test(err.message));
      return true;
    });
  }
});

test('trial encerrado e cobrança vencida preservam escrita no Free com limite de clientes', async () => {
  const free = row({ status: 'expired', effective_status: 'expired', effective_plan: 'free',
    reason: 'trial_expired', customer_count: 10, customer_limit: 10, can_create_customer: false,
    voice_monthly_limit: 20, voice_used_this_month: 7, voice_remaining_this_month: 13 });
  const access = await assertWritePermission(undefined, fakeRpc({ data: [free] }));
  assert.strictEqual(access.effectivePlan, 'free');
  assert.strictEqual(access.canCreateCustomer, false);
  assert.strictEqual(access.voiceRemainingThisMonth, 13);
});

test('trialing, active e past_due dentro da carência escrevem; dias de trial calculados', async () => {
  assert.strictEqual(parseAccessRow([row({})]).trialDaysRemaining, 3);
  for (const r of [row({}), row({ status: 'active', effective_status: 'active', reason: 'active' }), row({ status: 'past_due', effective_status: 'past_due', reason: 'past_due_grace' })]) {
    const access = await assertWritePermission(undefined, fakeRpc({ data: [r] }));
    assert.strictEqual(access.canWrite, true);
  }
});

// ------------------------------------------------------------------ renegociação

test('renegociação: conta precisa fechar; só quantidade divide; só valor precisa dividir exato', () => {
  assert.deepStrictEqual(planRenegotiation(200000, 4, 50000), { ok: true, count: 4, amountCents: 50000 });
  assert.deepStrictEqual(planRenegotiation(200000, 4, 40000), { ok: false, reason: 'mismatch' });
  assert.deepStrictEqual(planRenegotiation(200000, 3), { ok: true, count: 3 });
  assert.deepStrictEqual(planRenegotiation(200000, undefined, 50000), { ok: true, count: 4, amountCents: 50000 });
  assert.deepStrictEqual(planRenegotiation(200000, undefined, 30000), { ok: false, reason: 'not_divisible' });
  assert.deepStrictEqual(planRenegotiation(200000), { ok: false, reason: 'missing_count' });
});

// ------------------------------------------------------------------ estorno

test('estorno: com valor filtra pelo valor; sem valor só vale operação desta conversa; vários → pergunta', () => {
  const now = Date.parse('2026-09-23T15:00:00Z');
  const s = (id: string, amount: number, minutesAgo: number, kind: 'payment' | 'adjustment' = 'payment'): ReversibleSettlement => ({
    id, kind, amount, receivableId: 'r', createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
  });
  const rows = [s('a', 500, 5), s('b', 500, 600), s('c', 1000, 3000, 'adjustment')];

  assert.strictEqual(pickSettlement(rows, { amount: 1000 }, now).status, 'resolved');
  assert.strictEqual(pickSettlement(rows, { amount: 500 }, now).status, 'ambiguous');
  const recent = pickSettlement(rows, {}, now);
  assert.strictEqual(recent.status === 'resolved' && recent.settlement.id, 'a');
  assert.strictEqual(pickSettlement(rows, { amount: 700 }, now).status, 'not_found');
  assert.strictEqual(pickSettlement(rows, { kind: 'adjustment' }, now).status, 'not_found', 'abatimento antigo sem valor não é adivinhado');
});

// ------------------------------------------------------------------ billing

const event = (type: NormalizedBillingEvent['type'], over: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent => ({
  provider: 'test', eventId: 'e1', type, occurredAt: '2026-09-23T00:00:00Z', raw: {}, ...over,
});

test('billing: ativação, falha, cancelamento e evento atrasado', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const activated = subscriptionUpdateFor(event('subscription.activated', { currentPeriodEnd: '2026-10-23T00:00:00Z' }), { current_period_end: null, past_due_at: null }, now);
  assert.strictEqual(activated.status, 'active');
  assert.strictEqual(activated.current_period_end, '2026-10-23T00:00:00Z');

  const failed = subscriptionUpdateFor(event('payment.failed'), { current_period_end: null, past_due_at: '2026-09-20T00:00:00Z' }, now);
  assert.strictEqual(failed.status, 'past_due');
  assert.strictEqual(failed.past_due_at, '2026-09-20T00:00:00Z', 'carência conta da primeira falha');

  const canceled = subscriptionUpdateFor(event('subscription.canceled'), { current_period_end: '2026-10-23T00:00:00Z', past_due_at: null }, now);
  assert.strictEqual(canceled.status, 'canceled');

  const late = subscriptionUpdateFor(event('subscription.renewed', { currentPeriodEnd: '2026-09-30T00:00:00Z' }), { current_period_end: '2026-10-23T00:00:00Z', past_due_at: null }, now);
  assert.strictEqual(late.current_period_end, undefined, 'evento atrasado não volta o período');
  assert.strictEqual(late.status, undefined, 'evento atrasado não reativa assinatura cancelada');
  const checkout = subscriptionUpdateFor(event('checkout.paid'), { current_period_end: null, past_due_at: null }, now);
  assert.deepStrictEqual(checkout, {}, 'checkout pago não libera Pro sem webhook financeiro');
  const oldFailure = subscriptionUpdateFor(event('payment.failed', { providerSubscriptionId: 'sub-antiga' }),
    { current_period_end: '2026-10-23T00:00:00Z', past_due_at: null, provider_subscription_id: 'sub-atual' }, now);
  assert.deepStrictEqual(oldFailure, {}, 'falha de assinatura antiga não derruba a assinatura atual');
});

// ------------------------------------------------------------------ manual = voz

test('formulário manual gera o mesmo DealCommand financeiro que a voz (troca parcelada)', () => {
  const manual = buildManualTradeCommand({
    customerId: 'c1', itemOutId: 'i1', itemIn: { name: 'Bros', evaluatedValue: 15000 }, tradeBalance: 11000, direction: 'received',
    immediateCash: 3000, immediatePaymentMethod: 'pix', installments: { count: 4, value: 2000, dueDay: 15 },
  });
  assert.ok(manual.ok);
  const voice = buildDealCommand({
    intent: 'create_trade', counterparty: { name: 'Carlos' }, itemOut: 'XRE', itemIn: 'Bros', totalValue: 26000, itemInValue: 15000,
    direction: 'inflow', tradeBalance: 11000, cashIn: 3000, paymentMethod: 'pix', receivable: 8000, installmentsCount: 4, installmentAmount: 2000,
    dueDay: 15, requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '',
  });
  assert.strictEqual(voice.status, 'ok');
  if (!manual.ok || voice.status !== 'ok') return;
  const shape = (c: typeof manual.command) => ({
    out: c.itemsOut.map((i) => i.negotiatedValue),
    in: c.itemsIn.map((i) => i.negotiatedValue),
    cashIn: c.cashIn.map((m) => [m.amount, m.method]),
    rec: c.receivables.map((r) => [r.totalAmount, r.installments?.count, r.installments?.installmentAmount, r.installments?.dueDayOfMonth]),
  });
  assert.deepStrictEqual(shape(manual.command), shape(voice.command));
  assert.ok(validateDealBalance(manual.command).isBalanced);
});

test('formulário manual rejeita parcelas que não fecham e volta paga maior que o item', () => {
  assert.strictEqual(buildManualSaleCommand({ customerId: 'c', itemId: 'i', totalValue: 1000, cashInflow: 400, receivable: { totalAmount: 600, installmentsCount: 3, installmentValue: 150 } }).ok, false);
  assert.strictEqual(buildManualTradeCommand({ customerId: 'c', itemOutId: 'i', itemIn: { name: 'X', evaluatedValue: 100 }, tradeBalance: 500, direction: 'paid' }).ok, false);
  assert.ok(buildManualSaleCommand({ customerId: 'c', itemId: 'i', totalValue: 1000, cashInflow: 400, receivable: { totalAmount: 600, installmentsCount: 3, installmentValue: 200 } }).ok);
});

test('leitura de volta: sim/não curtos; frase nova não é resposta', () => {
  assert.strictEqual(confirmationAnswer('Sim'), 'yes');
  assert.strictEqual(confirmationAnswer('isso mesmo, pode lançar'), 'yes');
  assert.strictEqual(confirmationAnswer('Não, tá errado'), 'no');
  assert.strictEqual(confirmationAnswer('Não'), 'no');
  assert.strictEqual(confirmationAnswer('O Carlos pagou 300 no pix agora mesmo'), null);
  const text = describeForReadback({ intent: 'create_sale', item: 'iPhone 11', counterparty: { name: 'Adriana' }, totalValue: 4200, cashIn: 4200, paymentMethod: 'pix',
    requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '' });
  assert.strictEqual(text, 'Entendi: venda de iPhone 11 para Adriana por R$ 4.200, entrou R$ 4.200 no Pix. Confirma?');
});

(async () => {
  let failed = 0;
  console.log('\nTESTES UNITÁRIOS DE DOMÍNIO\n───────────────────────────');
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
      failed++;
      console.error(`  \x1b[31m✗\x1b[0m ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} testes passaram.`);
  if (failed > 0) process.exit(1);
})();
