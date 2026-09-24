// tests/unit/app-modules.test.ts
// Testes offline dos módulos do app (ciclo "atalhos"): empréstimo com juros, grade de parcelas,
// contas dos formulários manuais (venda/troca = mesmo DealCommand), histórico do cliente,
// AssistantResponse → tela, contexto de voz por tela, proteção de rotas e parser de voz para empréstimo.

import assert from 'assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateLoanTerms, loanTermsFromInstallments, uniformInstallment } from '../../src/lib/finance/loans';
import { planLoan, todayISO } from '../../src/lib/domain/loan-plan';
import { buildLoanPayload } from '../../src/lib/domain/loans';
import { formatBRL, formatShortDate, matchesSearch, parseMoneyInput, parsePercentInput } from '../../src/lib/format';
import { checkInstallmentPlan, saleRemaining, suggestInstallmentValue, tradeDifference } from '../../src/lib/domain/manual-plan';
import { buildManualSaleCommand, buildManualTradeCommand } from '../../src/lib/domain/manual-deal-commands';
import { validateDealBalance } from '../../src/lib/finance/deal-balance';
import { buildCustomerTimeline, debtLabel, installmentState, itemStatusView, timelineDayLabel } from '../../src/lib/domain/views';
import { assistantView } from '../../src/lib/voice/assistant-view';
import { applyScreenContext, parseScreenContext } from '../../src/lib/ai/screen-context';
import { emptyContext } from '../../src/lib/ai/context_manager';
import { guardRedirect, isPublicPath, safeNextPath } from '../../src/lib/auth/redirects';
import { validateCustomerInput } from '../../src/lib/domain/customers';
import { validateCost, validateItemInput, itemTotalCost } from '../../src/lib/domain/items';
import { interpretVoiceCommand } from '../../src/lib/ai/interpreter';
import { checkGrounding, completenessGaps } from '../../src/lib/ai/grounding';
import { describeForReadback } from '../../src/lib/ai/readback';
import { fromLLM } from '../../src/lib/ai/interpret';
import { LLMInterpretationSchema } from '../../src/lib/ai/schemas/llm-interpretation.schema';
import { buildDealCommand, UNNAMED_ITEM } from '../../src/lib/ai/command-builder';
import { resumePending } from '../../src/lib/ai/orchestrator';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// ------------------------------------------------------------------ empréstimo

test('juros: % sobre o total, % ao mês (simples), valor fixo e sem juros', () => {
  const total = calculateLoanTerms({ principal: 2000, interestType: 'percent_total', interestRate: 25, installmentsCount: 5 });
  assert.ok(total.ok);
  if (total.ok) {
    assert.deepStrictEqual([total.terms.interestCents, total.terms.totalCents], [50000, 250000]);
    assert.deepStrictEqual(total.terms.installmentCents, [50000, 50000, 50000, 50000, 50000]);
  }
  const monthly = calculateLoanTerms({ principal: 2000, interestType: 'percent_monthly', interestRate: 10, installmentsCount: 4 });
  assert.ok(monthly.ok && monthly.terms.interestCents === 80000 && monthly.terms.totalCents === 280000);
  const fixed = calculateLoanTerms({ principal: 2000, interestType: 'fixed_amount', interestAmount: 500, installmentsCount: 5 });
  assert.ok(fixed.ok && fixed.terms.totalCents === 250000 && fixed.terms.interestRate === null);
  const zero = calculateLoanTerms({ principal: 900, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 3 });
  assert.ok(zero.ok && zero.terms.interestCents === 0 && uniformInstallment(zero.terms.installmentCents) === 30000);
  const fraction = calculateLoanTerms({ principal: 1000, interestType: 'percent_monthly', interestRate: 2.5, installmentsCount: 3 });
  assert.ok(fraction.ok && fraction.terms.interestCents === 7500 && fraction.terms.interestRate === 2.5);
});

test('grade: centavos que sobram vão para as primeiras parcelas e a soma fecha exatamente', () => {
  const res = calculateLoanTerms({ principal: 1000, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 3 });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepStrictEqual(res.terms.installmentCents, [33334, 33333, 33333]);
  assert.strictEqual(res.terms.installmentCents.reduce((a, b) => a + b, 0), res.terms.totalCents);
  assert.strictEqual(uniformInstallment(res.terms.installmentCents), null);
});

test('juros recusam entrada inválida (sem taxa, negativo, parcelas fora do limite)', () => {
  assert.strictEqual(calculateLoanTerms({ principal: 0, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 2 }).ok, false);
  assert.strictEqual(calculateLoanTerms({ principal: 100, interestType: 'percent_total', installmentsCount: 2 }).ok, false);
  assert.strictEqual(calculateLoanTerms({ principal: 100, interestType: 'fixed_amount', interestAmount: -1, installmentsCount: 2 }).ok, false);
  assert.strictEqual(calculateLoanTerms({ principal: 100, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 0 }).ok, false);
  assert.strictEqual(calculateLoanTerms({ principal: 100, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 121 }).ok, false);
});

test('"emprestei 2 mil em 5 de 500": juro fixo é a diferença; parcelas abaixo do emprestado são recusadas', () => {
  const ok = loanTermsFromInstallments(2000, 5, 500);
  assert.ok(ok.ok && ok.terms.interestType === 'fixed_amount' && ok.terms.interestCents === 50000);
  assert.strictEqual(loanTermsFromInstallments(2000, 5, 300).ok, false);
});

test('vencimentos: primeira data explícita segue no mesmo dia; fim de mês é limitado; antes da data do empréstimo é recusado', () => {
  const plan = planLoan({ principal: 2000, interestType: 'fixed_amount', interestAmount: 500, installmentsCount: 5, startDate: '2026-09-23', firstDueDate: '2026-10-10' });
  assert.ok(plan.ok);
  if (plan.ok) assert.deepStrictEqual(plan.schedule.map((s) => s.dueDate), ['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
  const endOfMonth = planLoan({ principal: 300, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 3, startDate: '2026-12-01', firstDueDate: '2027-01-31' });
  assert.ok(endOfMonth.ok);
  if (endOfMonth.ok) assert.deepStrictEqual(endOfMonth.schedule.map((s) => s.dueDate), ['2027-01-31', '2027-02-28', '2027-03-31']);
  const before = planLoan({ principal: 300, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 3, startDate: '2026-09-23', firstDueDate: '2026-09-01' });
  assert.strictEqual(before.ok, false);
  const byDay = planLoan({ principal: 300, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 2, startDate: '2026-09-23', dueDay: 10 });
  assert.ok(byDay.ok && byDay.schedule[0].dueDate === '2026-10-10' && byDay.schedule[1].dueDate === '2026-11-10');
  // Sem data nem dia (caso da voz): mensal no mesmo dia do empréstimo, nunca "a cada 30 dias" (que escorrega)
  const monthly = planLoan({ principal: 2000, interestType: 'fixed_amount', interestAmount: 500, installmentsCount: 5, startDate: '2026-09-23' });
  assert.ok(monthly.ok);
  if (monthly.ok) assert.deepStrictEqual(monthly.schedule.map((s) => s.dueDate), ['2026-10-23', '2026-11-23', '2026-12-23', '2027-01-23', '2027-02-23']);
  const jan31 = planLoan({ principal: 200, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 2, startDate: '2027-01-31' });
  assert.ok(jan31.ok && jan31.schedule[0].dueDate === '2027-02-28');
});

test('payload da RPC: total = principal + juros e soma das parcelas = total', () => {
  const plan = planLoan({ principal: 2000, interestType: 'percent_total', interestRate: 25, installmentsCount: 5, startDate: '2026-09-23', firstDueDate: '2026-10-10' });
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const payload = buildLoanPayload({ customerId: 'c1', principal: 2000, interestType: 'percent_total', interestRate: 25, installmentsCount: 5, source: 'manual', idempotencyKey: 'k1' }, plan);
  assert.strictEqual(payload.total_amount, payload.principal_amount + payload.interest_amount);
  assert.strictEqual(payload.installments.reduce((acc, i) => acc + i.original_value, 0), 2500);
  assert.strictEqual(payload.interest_rate, 25);
  assert.strictEqual(payload.idempotency_key, 'k1');
  assert.match(todayISO(new Date('2026-09-24T02:00:00Z')), /^2026-09-23$/, 'data de negócio no fuso do Brasil');
});

// ------------------------------------------------------------------ valores digitados

test('dinheiro digitado: milhar com ponto, decimal com vírgula, R$ e texto inválido', () => {
  assert.strictEqual(parseMoneyInput('3.200'), 3200);
  assert.strictEqual(parseMoneyInput('3200,50'), 3200.5);
  assert.strictEqual(parseMoneyInput('R$ 1.500,00'), 1500);
  assert.strictEqual(parseMoneyInput('1.000.000'), 1000000);
  assert.strictEqual(parseMoneyInput('2.5'), 2.5);
  assert.strictEqual(parseMoneyInput('abc'), null);
  assert.strictEqual(parseMoneyInput('1,234,5'), null);
  assert.strictEqual(parseMoneyInput(''), null);
  assert.strictEqual(parsePercentInput('2,5'), 2.5);
  assert.strictEqual(parsePercentInput('10%'), 10);
  assert.strictEqual(formatBRL(12450), 'R$ 12.450');
  assert.strictEqual(formatBRL(1500.5), 'R$ 1.500,50');
  assert.strictEqual(formatShortDate('2026-10-10', '2026-09-23'), '10/10');
  assert.strictEqual(formatShortDate('2027-01-10', '2026-09-23'), '10/01/2027');
  assert.ok(matchesSearch('joao', 'João Carlos') && !matchesSearch('maria', 'João'));
});

// ------------------------------------------------------------------ venda e troca manuais

test('parcelamento: 4 × 550 = 2200 fecha; 4 × 500 não fecha e não deixa salvar', () => {
  assert.strictEqual(saleRemaining(320000, 100000, 0), 220000);
  const ok = checkInstallmentPlan(220000, 4, 55000);
  assert.ok(ok.ok);
  assert.match(ok.message, /4 × R\$ 550 = R\$ 2\.200/);
  const bad = checkInstallmentPlan(220000, 4, 50000);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /Faltam R\$ 200/);
  assert.strictEqual(suggestInstallmentValue(220000, 4), 55000);
  assert.strictEqual(suggestInstallmentValue(100000, 3), null);
});

test('fluxo 3 (manual): 3200, 1000 no Pix e 4×550 vira o DealCommand balanceado da voz', () => {
  const built = buildManualSaleCommand({
    customerId: 'c1', itemId: 'i1', totalValue: 3200, paymentMethod: 'pix', cashInflow: 1000,
    receivable: { totalAmount: 2200, installmentsCount: 4, installmentValue: 550, firstDueDate: '2026-10-10', intervalDays: 30 },
    idempotencyKey: 'venda-1',
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  const c = built.command;
  assert.deepStrictEqual(c.itemsOut.map((i) => [i.itemId, i.negotiatedValue]), [['i1', 3200]]);
  assert.deepStrictEqual(c.cashIn.map((m) => [m.amount, m.method]), [[1000, 'pix']]);
  assert.deepStrictEqual(c.receivables.map((r) => [r.totalAmount, r.installments?.count, r.installments?.installmentAmount, r.installments?.firstDueDate]), [[2200, 4, 550, '2026-10-10']]);
  assert.ok(validateDealBalance(c).isBalanced);
  assert.strictEqual(c.idempotencyKey, 'venda-1');
});

test('venda com mercadoria recebida como parte do pagamento: entra em itemsIn e o balanço fecha', () => {
  const built = buildManualSaleCommand({ customerId: 'c', itemId: 'i', totalValue: 5000, cashInflow: 2000, itemIn: { name: 'Bros 2019', evaluatedValue: 3000 } });
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.deepStrictEqual(built.command.itemsIn.map((i) => [i.description, i.negotiatedValue]), [['Bros 2019', 3000]]);
  assert.ok(validateDealBalance(built.command).isBalanced);
  assert.strictEqual(buildManualSaleCommand({ customerId: 'c', itemId: 'i', totalValue: 5000, itemIn: { name: '', evaluatedValue: 3000 } }).ok, false);
});

test('troca: entreguei Bros 17 mil, recebi XRE 22 mil → eu paguei 5 mil (itemOut, itemIn, cashOut, parcelas com 1º vencimento)', () => {
  const diff = tradeDifference(1700000, 2200000);
  assert.deepStrictEqual(diff, { direction: 'paid', balanceCents: 500000 });
  assert.deepStrictEqual(tradeDifference(100, 100), { direction: 'even', balanceCents: 0 });
  const built = buildManualTradeCommand({
    customerId: 'c', itemOutId: 'bros', itemIn: { name: 'XRE', evaluatedValue: 22000 }, tradeBalance: 5000, direction: 'paid',
    immediateCash: 2000, immediatePaymentMethod: 'pix', installments: { count: 3, value: 1000, firstDueDate: '2026-10-10' },
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  const c = built.command;
  assert.deepStrictEqual(c.itemsOut.map((i) => i.negotiatedValue), [17000]);
  assert.deepStrictEqual(c.itemsIn.map((i) => [i.description, i.negotiatedValue]), [['XRE', 22000]]);
  assert.deepStrictEqual(c.cashOut.map((m) => m.amount), [2000]);
  assert.deepStrictEqual(c.payables.map((p) => [p.totalAmount, p.installments?.count, p.installments?.firstDueDate]), [[3000, 3, '2026-10-10']]);
  assert.ok(validateDealBalance(c).isBalanced);
});

// ------------------------------------------------------------------ telas

test('status em português: disponível, reservado, vendido e recebido em troca', () => {
  assert.deepStrictEqual(itemStatusView('disponivel'), { key: 'available', label: 'Disponível' });
  assert.deepStrictEqual(itemStatusView('reservado'), { key: 'reserved', label: 'Reservado' });
  assert.deepStrictEqual(itemStatusView('vendido', true), { key: 'sold', label: 'Vendido' });
  assert.deepStrictEqual(itemStatusView('disponivel', true), { key: 'trade_in', label: 'Recebido em troca' });
});

test('parcela: paga, parcial, atrasada, renegociada; dívida rotulada pela mercadoria ou "Empréstimo"', () => {
  const today = '2026-10-15';
  assert.strictEqual(installmentState({ status: 'paid', balance: 0, dueDate: '2026-10-10' }, today).key, 'paid');
  assert.strictEqual(installmentState({ status: 'partially_paid', balance: 300, dueDate: '2026-11-10', paidValue: 200 }, today).key, 'partial');
  assert.strictEqual(installmentState({ status: 'pending', balance: 500, dueDate: '2026-10-10' }, today).key, 'overdue');
  assert.strictEqual(installmentState({ status: 'renegotiated', balance: 0, dueDate: '2026-10-10' }, today).key, 'renegotiated');
  assert.strictEqual(debtLabel({ loanContractId: 'l', loanPrincipal: 2000 }, formatBRL), 'Empréstimo de R$ 2.000');
  assert.strictEqual(debtLabel({ dealId: 'd', itemsOut: ['iPhone 13'] }, formatBRL), 'iPhone 13');
});

test('histórico do cliente: vendas, trocas, empréstimos, pagamentos, abatimentos, renegociações e estornos em ordem', () => {
  const events = buildCustomerTimeline({
    deals: [
      { id: 'd1', deal_type: 'venda', created_at: '2026-09-10T12:00:00Z', total_value: 3200, deal_items: [{ direction: 'OUT', items: { name: 'iPhone 13' } }] },
      { id: 'd2', deal_type: 'troca', created_at: '2026-09-05T12:00:00Z', total_value: 17000, deal_items: [{ direction: 'OUT', items: { name: 'Bros' } }, { direction: 'IN', items: { name: 'XRE' } }] },
    ],
    loans: [{ id: 'l1', created_at: '2026-09-03T12:00:00Z', principal_amount: 2000, total_amount: 2500 }],
    settlements: [
      { id: 's1', kind: 'payment', amount: 500, created_at: '2026-09-23T15:00:00Z', reversal_of: null, receivable_id: 'r-loan' },
      { id: 's2', kind: 'adjustment', amount: 300, created_at: '2026-09-01T12:00:00Z', reversal_of: null, adjustment_type: 'discount', receivable_id: 'r-sale' },
      { id: 's3', kind: 'payment', amount: 500, created_at: '2026-09-23T16:00:00Z', reversal_of: 's1', receivable_id: 'r-loan' },
    ],
    renegotiations: [{ id: 'n1', created_at: '2026-09-20T12:00:00Z', renegotiated_amount: 1200, new_count: 4, receivable_id: 'r-sale' }],
    debtLabels: { 'r-loan': 'Empréstimo de R$ 2.000', 'r-sale': 'iPhone 13' },
  });
  assert.deepStrictEqual(events.map((e) => e.kind), ['reversal', 'payment', 'renegotiation', 'sale', 'trade', 'loan', 'adjustment']);
  const pay = events.find((e) => e.kind === 'payment')!;
  assert.deepStrictEqual([pay.direction, pay.amount, pay.detail], ['in', 500, 'Empréstimo de R$ 2.000']);
  assert.strictEqual(events.find((e) => e.kind === 'loan')!.direction, 'out');
  assert.strictEqual(events.find((e) => e.kind === 'trade')!.title, 'Troca — Bros por XRE');
  assert.strictEqual(timelineDayLabel('2026-09-23', '2026-09-23'), 'Hoje');
  assert.strictEqual(timelineDayLabel('2026-09-22', '2026-09-23'), 'Ontem');
  assert.strictEqual(timelineDayLabel('2026-09-10', '2026-09-23'), '10/09');
});

// ------------------------------------------------------------------ AssistantResponse → tela

test('AssistantResponse: executed com desfazer, answered, needs_input com candidatos e com Sim/Não, erro de assinatura', () => {
  const done = assistantView({ status: 'executed', message: 'Pronto. Registrei R$ 500 do Carlos. Ainda faltam R$ 1.500.', undoAvailable: true, operationId: 'op1', operationType: 'payment' });
  assert.deepStrictEqual([done.tone, done.title, done.message, done.undoOperationId, done.refresh], ['success', 'Pronto', 'Registrei R$ 500 do Carlos. Ainda faltam R$ 1.500.', 'op1', true]);
  const noUndo = assistantView({ status: 'executed', message: 'Pronto. Venda registrada.', undoAvailable: false, operationId: 'd1' });
  assert.strictEqual(noUndo.undoOperationId, undefined);
  assert.strictEqual(assistantView({ status: 'answered', message: 'Carlos deve R$ 800.' }).tone, 'info');
  const who = assistantView({ status: 'needs_input', message: 'Qual João?', field: 'customer', candidates: [{ id: '1', label: 'João Silva' }, { id: '2', label: 'João Santos' }] });
  assert.deepStrictEqual(who.choices.map((c) => c.say), ['João Silva', 'João Santos']);
  assert.ok(who.awaitingAnswer);
  const confirm = assistantView({ status: 'needs_input', message: 'Entendi: ... Confirma?', field: 'confirmation' });
  assert.deepStrictEqual(confirm.choices.map((c) => c.say), ['sim', 'não']);
  const sub = assistantView({ status: 'error', message: 'Seu teste acabou.', retryable: false, code: 'subscription_required' });
  assert.ok(sub.subscriptionCta && !sub.retry);
  const free = assistantView({ status: 'error', message: 'Limite de clientes do Free.', retryable: false, code: 'plan_customer_limit' });
  assert.deepStrictEqual([free.title, free.subscriptionCta, free.retry], ['Limite do Free', true, false]);
  const voiceFree = assistantView({ status: 'error', message: 'Cota de voz do Free.', retryable: false, code: 'plan_voice_limit' });
  assert.deepStrictEqual([voiceFree.subscriptionCta, voiceFree.retry], [true, false]);
  assert.ok(assistantView({ status: 'error', message: 'x', retryable: true, code: 'rate_limited' }).retry);
  assert.strictEqual(assistantView(undefined).tone, 'error');
  for (const v of [done, who, confirm, sub]) assert.ok(!/STT|LLM|RPC|Structured/i.test(`${v.title} ${v.message}`));
});

// ------------------------------------------------------------------ voz contextual

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

test('contexto da tela: só UUIDs de campos conhecidos passam (objeto ou JSON)', () => {
  assert.deepStrictEqual(parseScreenContext({ customerId: U1, itemId: 'x', hack: U2 }), { customerId: U1 });
  assert.deepStrictEqual(parseScreenContext(JSON.stringify({ loanContractId: U2 })), { loanContractId: U2 });
  assert.strictEqual(parseScreenContext('não é json'), undefined);
  assert.strictEqual(parseScreenContext([U1]), undefined);
  assert.strictEqual(parseScreenContext({ customerId: "1' OR 1=1" }), undefined);
});

function fakeSupabase(rows: Record<string, Record<string, unknown> | null>): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

test('tela do Carlos: "ele" vira customerId = Carlos; dívida de outra conversa é descartada; ID de outro usuário é ignorado', async () => {
  const base = { ...emptyContext('u'), lastCustomer: { id: U2, name: 'Joana' }, lastReceivableId: 'rec-joana' };
  const ctx = await applyScreenContext(fakeSupabase({ customers: { id: U1, name: 'Carlos' } }), 'u', base, { customerId: U1 });
  assert.deepStrictEqual(ctx.lastCustomer, { id: U1, name: 'Carlos', type: 'customer' });
  assert.strictEqual(ctx.lastReceivableId, undefined);
  assert.strictEqual(ctx.screenLabel, 'cliente Carlos');

  const loanCtx = await applyScreenContext(
    fakeSupabase({ loan_contracts: { id: U2, customer_id: U1, customers: { name: 'Carlos' }, receivables: [{ id: 'rec-loan' }] } }),
    'u', emptyContext('u'), { loanContractId: U2 }
  );
  assert.deepStrictEqual([loanCtx.lastCustomer?.id, loanCtx.lastReceivableId], [U1, 'rec-loan']);

  const foreign = await applyScreenContext(fakeSupabase({}), 'u', base, { customerId: U1 });
  assert.deepStrictEqual(foreign.lastCustomer, base.lastCustomer, 'RLS não devolveu: contexto não muda');
});

test('voz de empréstimo (parser determinístico): valor, parcelas, juros % e fixo, "sem juros"', () => {
  const ctx = { ...emptyContext('u'), lastCustomer: { id: U1, name: 'Carlos' } };
  const a = interpretVoiceCommand('Emprestei dois mil pro Carlos em cinco de quinhentos.', ctx);
  assert.deepStrictEqual([a.intent, a.counterparty?.name, a.amount, a.installmentsCount, a.installmentAmount], ['create_loan', 'Carlos', 2000, 5, 500]);
  const b = interpretVoiceCommand('Emprestei 2 mil pro Carlos com 10% ao mês em 4 vezes todo dia 10');
  assert.deepStrictEqual([b.interestType, b.interestRate, b.installmentsCount, b.dueDay], ['percent_monthly', 10, 4, 10]);
  const c = interpretVoiceCommand('Emprestei mil reais pro João em 5 vezes com 200 de juros');
  assert.deepStrictEqual([c.interestType, c.interestAmount, c.amount], ['fixed_amount', 200, 1000]);
  assert.strictEqual(interpretVoiceCommand('emprestei 3 mil pro Pedro sem juros em 3 parcelas').interestType, 'none');
  const pay = interpretVoiceCommand('Carlos pagou a segunda do empréstimo');
  assert.deepStrictEqual([pay.intent, pay.installmentRef, pay.debtHint, pay.paymentScope], ['register_payment', 2, 'empréstimo', 'installment_full']);
  const ctxPay = interpretVoiceCommand('Ele pagou mais 500 do empréstimo.', ctx);
  assert.deepStrictEqual([ctxPay.counterparty?.name, ctxPay.amount, ctxPay.debtHint], ['Carlos', 500, 'empréstimo']);
  assert.notStrictEqual(interpretVoiceCommand('vou passar lá na segunda-feira').installmentRef, 2);
});

test('empréstimo por voz sem juros definido pergunta; com parcelas ditas não pergunta; LLM mapeia create_loan', () => {
  const base = { intent: 'create_loan' as const, counterparty: { name: 'Carlos' }, amount: 2000, installmentsCount: 5, requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '' };
  assert.deepStrictEqual(completenessGaps(base).map((g) => g.type), ['loan_interest']);
  assert.deepStrictEqual(completenessGaps({ ...base, installmentAmount: 500 }), []);
  assert.deepStrictEqual(completenessGaps({ ...base, interestType: 'percent_total', interestRate: 25 }), []);
  assert.deepStrictEqual(completenessGaps({ ...base, amount: undefined, installmentsCount: undefined, interestType: 'none' }).map((g) => g.type), ['deal_total', 'installments_count']);
  assert.strictEqual(describeForReadback({ ...base, installmentAmount: 500 }), 'Entendi: empréstimo de R$ 2.000 para Carlos, volta em 5x de R$ 500. Confirma?');

  const llm = LLMInterpretationSchema.parse({
    intent: 'create_loan', customerName: 'Carlos', item: null, itemOut: null, itemIn: null, totalValue: null, itemInValue: null, cashIn: null, cashOut: null,
    paymentMethod: 'pix', tradeBalance: null, direction: null, receivable: null, payable: null, installmentsCount: 4, installmentAmount: null, dueDay: 10,
    dueMonthOffset: null, firstDueDate: null, amount: 2000, paymentScope: null, installmentRef: null, installmentNumber: null, debtHint: null,
    adjustmentType: null, operationKind: null, renegotiationScope: null, installmentNumbers: [], queryType: null,
    interestType: 'percent_monthly', interestRate: 10, interestAmount: null, missingInformation: [], ambiguities: [],
  });
  const cmd = fromLLM(llm, 'x', 'x');
  assert.deepStrictEqual([cmd.intent, cmd.amount, cmd.interestType, cmd.interestRate, cmd.paymentScope], ['create_loan', 2000, 'percent_monthly', 10, undefined]);
});

// ------------------------------------------------------------------ proteção de rotas

test('rotas: /app/* sem sessão → /login?next; login/cadastro com sessão → /app; recuperação de senha é pública', () => {
  assert.strictEqual(guardRedirect('/app/clientes', '?filtro=atrasados', false), '/login?next=%2Fapp%2Fclientes%3Ffiltro%3Datrasados');
  assert.strictEqual(guardRedirect('/app', '', false), '/login?next=%2Fapp');
  assert.strictEqual(guardRedirect('/login', '', true), '/app');
  assert.strictEqual(guardRedirect('/cadastro', '', true), '/app');
  assert.strictEqual(guardRedirect('/app/estoque', '', true), null);
  for (const p of ['/', '/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/auth/callback', '/api/voice/process']) assert.ok(isPublicPath(p), p);
  assert.strictEqual(isPublicPath('/app'), false);
  assert.strictEqual(isPublicPath('/loginx'), false);
});

test('next só aceita rotas internas do app (sem open redirect)', () => {
  assert.strictEqual(safeNextPath('/app/clientes/1'), '/app/clientes/1');
  assert.strictEqual(safeNextPath('/redefinir-senha'), '/redefinir-senha');
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/login', '/appx', '/app\r\nx', '']) assert.strictEqual(safeNextPath(bad), '/app', bad);
});

// ------------------------------------------------------------------ validações de cadastro

test('cliente: só nome obrigatório; CPF/CNPJ e telefone conferidos', () => {
  assert.ok(validateCustomerInput({ name: 'Carlos' }).ok);
  assert.strictEqual(validateCustomerInput({ name: '  ' }).ok, false);
  assert.strictEqual(validateCustomerInput({ name: 'Carlos', document: '123' }).ok, false);
  assert.ok(validateCustomerInput({ name: 'Carlos', document: '123.456.789-09', phone: '(83) 99999-9999' }).ok);
  assert.strictEqual(validateCustomerInput({ name: 'Carlos', phone: '123' }).ok, false);
});

test('mercadoria: nome e valor de compra obrigatórios; IMEI/ano validados; custo total = compra + custos', () => {
  assert.ok(validateItemInput({ name: 'iPhone 13', acquisitionCost: 2000 }).ok);
  assert.strictEqual(validateItemInput({ name: '', acquisitionCost: 2000 }).ok, false);
  assert.strictEqual(validateItemInput({ name: 'X', acquisitionCost: NaN }).ok, false);
  assert.strictEqual(validateItemInput({ name: 'X', acquisitionCost: 1, imei: '123' }).ok, false);
  assert.strictEqual(validateItemInput({ name: 'X', acquisitionCost: 1, modelYear: 1800 }).ok, false);
  const plate = validateItemInput({ name: 'XRE', acquisitionCost: 1, plate: 'abc1d23' });
  assert.ok(plate.ok && plate.data.plate === 'ABC1D23');
  assert.ok(validateCost({ category: 'reparo', amount: 200 }).ok);
  assert.strictEqual(validateCost({ category: 'inventada', amount: 200 }).ok, false);
  assert.strictEqual(validateCost({ category: 'transporte', amount: 0 }).ok, false);
  assert.strictEqual(itemTotalCost(2000, [{ amount: 200 }, { amount: 50 }]), 2250);
});

// ------------------------------------------------------------------ voz não fica refém de cadastro

test('venda por voz sem mercadoria/cliente dito não pergunta cadastro: vira avulso; pagamento sem cliente ainda pergunta', () => {
  const base = { requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '' };
  const sale = { ...base, intent: 'create_sale' as const, totalValue: 3000, cashIn: 3000, paymentMethod: 'pix' as const };
  assert.deepStrictEqual(completenessGaps(sale), [], 'sem cliente e sem mercadoria: nada bloqueia');
  const built = buildDealCommand(sale);
  assert.strictEqual(built.status, 'ok');
  if (built.status === 'ok') {
    assert.deepStrictEqual(built.command.itemsOut.map((i) => [i.description, i.newItem, i.negotiatedValue]), [[UNNAMED_ITEM, true, 3000]]);
    assert.strictEqual(built.command.counterparty, undefined, 'executor cria "Cliente avulso"');
  }
  const trade = buildDealCommand({ ...base, intent: 'create_trade', itemIn: 'Bros', totalValue: 5000, itemInValue: 5000, direction: 'even', tradeBalance: 0 });
  assert.ok(trade.status === 'ok' && trade.command.itemsOut[0].newItem === true);
  assert.deepStrictEqual(completenessGaps({ ...base, intent: 'register_payment', amount: 500, paymentScope: 'amount' }).map((g) => g.type), ['customer_reference']);
  assert.deepStrictEqual(completenessGaps({ ...base, intent: 'create_sale', item: 'iPhone' }).map((g) => g.type), ['deal_total'], 'valor continua obrigatório');
});

test('formulário: venda e troca de mercadoria fora do estoque (custo opcional) geram o mesmo DealCommand', () => {
  const sale = buildManualSaleCommand({ customerId: 'c', newItem: { name: 'iPhone 15' }, totalValue: 3000, cashInflow: 3000, paymentMethod: 'pix' });
  assert.ok(sale.ok);
  if (sale.ok) assert.deepStrictEqual(sale.command.itemsOut.map((i) => [i.description, i.newItem, i.acquisitionValue, i.itemId]), [['iPhone 15', true, undefined, undefined]]);
  const known = buildManualSaleCommand({ customerId: 'c', newItem: { name: 'Fone', acquisitionCost: 80 }, totalValue: 150, cashInflow: 150 });
  assert.ok(known.ok && known.command.itemsOut[0].acquisitionValue === 80);
  assert.strictEqual(buildManualSaleCommand({ customerId: 'c', totalValue: 150, cashInflow: 150 }).ok, false, 'precisa de item do estoque ou descrito');
  const trade = buildManualTradeCommand({ customerId: 'c', itemOutNew: { name: 'Bros' }, itemIn: { name: 'XRE', evaluatedValue: 22000 }, tradeBalance: 5000, direction: 'paid', immediateCash: 5000 });
  assert.ok(trade.ok && trade.command.itemsOut[0].newItem === true && validateDealBalance(trade.command).isBalanced);
});

test('"quanto você pagou nele?": número vira custo; "não sei" deixa para depois; comando novo nunca é absorvido', () => {
  const pending = {
    kind: 'missing_info' as const,
    originalTranscript: 'Quanto você pagou no iPhone 15?',
    promptAsked: 'Quanto você pagou no iPhone 15?',
    field: 'amount',
    timestamp: Date.now(),
    draft: {
      intent: 'set_item_cost', item: 'iPhone 15', totalValue: 3000, resolvedRefs: { itemId: U1 },
      requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '',
    } as unknown as Record<string, unknown>,
  };
  assert.deepStrictEqual([resumePending('dois mil', pending)?.intent, resumePending('dois mil', pending)?.amount], ['set_item_cost', 2000]);
  assert.strictEqual(resumePending('Paguei 1800 nele', pending)?.amount, 1800);
  assert.strictEqual(resumePending('uns 2 mil e quinhentos', pending)?.amount, 2500);
  assert.strictEqual(resumePending('dois', pending)?.amount, 2000, 'convenção de milhar quando a venda foi em milhares');
  const later = resumePending('não sei agora', pending);
  assert.deepStrictEqual([later?.intent, later?.confirmationPrompt], ['unrecognized_command', 'Beleza. Dá pra informar o custo depois, na tela da mercadoria.']);
  assert.strictEqual(resumePending('Vendi outro iPhone pro Pedro por 3 mil', pending), null, 'venda nova não vira custo');
  assert.strictEqual(resumePending('O Carlos pagou 500', pending), null, 'pagamento não vira custo');
});

test('grounding: "o João pagou" nunca vira o "João Santos" do contexto; pronome e tela do cliente completam', () => {
  const base = { intent: 'register_payment' as const, amount: 500, paymentScope: 'amount' as const, requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '' };
  const ctx = { ...emptyContext('u'), lastCustomer: { id: U1, name: 'João Santos' } };
  const expanded = checkGrounding({ ...base, counterparty: { name: 'João Santos' } }, 'O João pagou 500 no Pix.', ctx);
  assert.deepStrictEqual(expanded.map((g) => g.field), ['customer'], 'nome parcial dito não é completado pelo contexto');
  assert.deepStrictEqual(checkGrounding({ ...base, counterparty: { name: 'João Santos' } }, 'Ele pagou 500 no Pix.', ctx), [], 'pronome usa o contexto');
  const onScreen = { ...ctx, screenCustomerId: U1 };
  assert.deepStrictEqual(
    checkGrounding({ ...base, intent: 'create_sale', amount: undefined, totalValue: 100, counterparty: { name: 'João Santos' } }, 'Vendi um fone por 100 no Pix.', onScreen),
    [],
    'tela do cliente é contexto explícito'
  );
});

(async () => {
  let failed = 0;
  console.log('\nTESTES UNITÁRIOS DOS MÓDULOS DO APP\n───────────────────────────────────');
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
