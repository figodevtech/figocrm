// tests/unit/ai-pipeline.test.ts
// Testes offline (sem banco, sem rede) das garantias do pipeline de IA:
// Zod estrito, reparo único, fallback, grounding contra valores inventados, builder, resolvers.

import assert from 'assert';
import { interpretVoiceCommandWithLLM } from '../../src/lib/ai/interpret';
import type { LLMCaller, LLMRequest } from '../../src/lib/ai/provider';
import { LLMProviderError } from '../../src/lib/ai/provider';
import {
  LLM_INTERPRETATION_JSON_SCHEMA,
  LLMInterpretation,
  LLMInterpretationSchema,
} from '../../src/lib/ai/schemas/llm-interpretation.schema';
import { buildDealCommand } from '../../src/lib/ai/command-builder';
import { computeNewDueDate, resumePending } from '../../src/lib/ai/orchestrator';
import { emptyContext, ConversationContext } from '../../src/lib/ai/context_manager';
import { matchCandidateAnswer, pickCandidates } from '../../src/lib/domain/entity-resolver';
import { pickInstallment, OpenInstallment } from '../../src/lib/domain/financial-target-resolver';
import { extractSpokenNumbers } from '../../src/lib/voice/numbers';
import { mentionsOtherName } from '../../src/lib/ai/grounding';
import { checkGrounding } from '../../src/lib/ai/grounding';
import { buildInstallmentSchedule, addCalendarMonthsClamped, addExactDays } from '../../src/lib/finance/installment-schedule';
import { interpretScheduleRule } from '../../src/lib/ai/schedule-interpretation';
import { planLoan } from '../../src/lib/domain/loan-plan';
import type { InterpretedVoiceCommand } from '../../src/lib/ai/interpreter';
import { interpretVoiceCommand } from '../../src/lib/ai/interpreter';
import { inferTradeBalanceDirection } from '../../src/lib/ai/trade-direction';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function llmOutput(partial: Partial<LLMInterpretation>): LLMInterpretation {
  return {
    intent: 'unrecognized_command',
    customerName: null, item: null, itemOut: null, itemIn: null,
    totalValue: null, itemInValue: null, cashIn: null, cashOut: null, paymentMethod: null,
    tradeBalance: null, direction: null, receivable: null, payable: null,
    installmentsCount: null, installmentAmount: null, dueDay: null, dueMonthOffset: null, firstDueDate: null,
    scheduleType: null, explicitDueDates: [], recurrenceDay: null, intervalDays: null,
    amount: null, paymentScope: null, installmentRef: null, installmentNumber: null, debtHint: null,
    adjustmentType: null, operationKind: null, renegotiationScope: null, installmentNumbers: [],
    queryType: null, interestType: null, interestRate: null, interestAmount: null, missingInformation: [], ambiguities: [],
    ...partial,
  };
}

function fakeLLM(...responses: Array<string | Error>): LLMCaller & { calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];
  const fn = (async (req: LLMRequest) => {
    calls.push(req);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return { content: next, provider: 'openai' as const, model: 'fake', latencyMs: 5, promptTokens: 100, completionTokens: 50 };
  }) as LLMCaller & { calls: LLMRequest[] };
  fn.calls = calls;
  return fn;
}

const CANONICAL = 'Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.';
const canonicalLLM = llmOutput({
  intent: 'create_trade', customerName: 'Carlos', itemOut: 'XRE', itemIn: 'Bros',
  totalValue: 26000, itemInValue: 15000, cashIn: 3000, paymentMethod: 'pix', tradeBalance: 11000, direction: 'inflow',
  receivable: 8000, installmentsCount: 4, installmentAmount: 2000, dueDay: 15,
});

// ---------------------------------------------------------------- schema

test('JSON Schema da OpenAI e Zod têm exatamente as mesmas chaves', () => {
  const jsonKeys = Object.keys((LLM_INTERPRETATION_JSON_SCHEMA as { properties: object }).properties).sort();
  const zodKeys = Object.keys(LLMInterpretationSchema.shape).sort();
  assert.deepStrictEqual(jsonKeys, zodKeys);
  assert.deepStrictEqual([...(LLM_INTERPRETATION_JSON_SCHEMA as { required: string[] }).required].sort(), zodKeys);
});

test('Zod rejeita objeto parcial, campo extra e valor negativo', () => {
  assert.strictEqual(LLMInterpretationSchema.safeParse({ intent: 'create_sale' }).success, false);
  assert.strictEqual(LLMInterpretationSchema.safeParse({ ...canonicalLLM, extra: 1 }).success, false);
  assert.strictEqual(LLMInterpretationSchema.safeParse({ ...canonicalLLM, cashIn: -5 }).success, false);
  assert.strictEqual(LLMInterpretationSchema.safeParse(canonicalLLM).success, true);
});

// ---------------------------------------------------------------- interpretação

test('saída válida da LLM é usada (fonte llm) e o diálogo canônico fica executável', async () => {
  const llm = fakeLLM(JSON.stringify(canonicalLLM));
  const res = await interpretVoiceCommandWithLLM(CANONICAL, emptyContext('u'), { llm });
  assert.strictEqual(res.interpretation?.source, 'llm');
  assert.strictEqual(res.requiresConfirmation, false, JSON.stringify(res.ambiguities));
  assert.strictEqual(res.itemInValue, 15000);
  assert.strictEqual(llm.calls.length, 1);
  assert.ok(llm.calls[0].jsonSchema, 'Structured Output com schema real');
});

test('saída inválida → exatamente um reparo; reparo válido é aceito', async () => {
  const llm = fakeLLM('{"intent":"create_trade"}', JSON.stringify(canonicalLLM));
  const res = await interpretVoiceCommandWithLLM(CANONICAL, emptyContext('u'), { llm });
  assert.strictEqual(llm.calls.length, 2);
  assert.strictEqual(res.interpretation?.repairAttempted, true);
  assert.strictEqual(res.requiresConfirmation, false);
});

test('saída inválida duas vezes → pede reformulação e nunca executa', async () => {
  const llm = fakeLLM('não é json', '{"intent":"create_sale","totalValue":"mil"}');
  const res = await interpretVoiceCommandWithLLM('Vendi a moto pro Carlos por 5 mil', emptyContext('u'), { llm });
  assert.strictEqual(llm.calls.length, 2);
  assert.strictEqual(res.intent, 'clarify_ambiguity');
  assert.strictEqual(res.requiresConfirmation, true);
  assert.ok((res.interpretation?.validationErrors?.length ?? 0) > 0);
});

test('provedor indisponível → fallback determinístico (auto) / sem fallback (llm_required)', async () => {
  const down = fakeLLM(new LLMProviderError('timeout', 'timeout'));
  const auto = await interpretVoiceCommandWithLLM('Vendi o Titan 160 pro João por 1500 em dinheiro vivo.', emptyContext('u'), { llm: down });
  assert.strictEqual(auto.interpretation?.source, 'rules_fallback');
  assert.strictEqual(auto.intent, 'create_sale');

  const strict = await interpretVoiceCommandWithLLM('Vendi o Titan 160 pro João por 1500.', emptyContext('u'), { llm: down, mode: 'llm_required' });
  assert.strictEqual(strict.requiresConfirmation, true);
  assert.notStrictEqual(strict.interpretation?.source, 'rules_fallback');
});

test('guardrail destrutivo responde antes da LLM (sem custo)', async () => {
  const llm = fakeLLM(JSON.stringify(canonicalLLM));
  const res = await interpretVoiceCommandWithLLM('Apaga tudo do sistema.', emptyContext('u'), { llm });
  assert.strictEqual(llm.calls.length, 0);
  assert.strictEqual(res.intent, 'clarify_ambiguity');
  assert.strictEqual(res.requiresConfirmation, true);
});

test('grounding: valor inventado pela LLM bloqueia a execução', async () => {
  const invented = llmOutput({ intent: 'create_sale', customerName: 'Carlos', item: 'moto', totalValue: 5000, cashIn: 4200, paymentMethod: 'pix' });
  const res = await interpretVoiceCommandWithLLM('Vendi a moto pro Carlos por 5 mil no Pix', emptyContext('u'), { llm: fakeLLM(JSON.stringify(invented)) });
  assert.strictEqual(res.requiresConfirmation, true);
  assert.ok(res.interpretation?.validationErrors?.some((e) => e.includes('cashIn')));
});

test('grounding: cliente inventado / trocado pelo do contexto bloqueia', async () => {
  const ctx: ConversationContext = { ...emptyContext('u'), lastCustomer: { id: 'c1', name: 'Carlos' } };
  const swapped = llmOutput({ intent: 'register_payment', customerName: 'Carlos', amount: 500, paymentScope: 'amount' });
  const res = await interpretVoiceCommandWithLLM('Joana pagou 500', ctx, { llm: fakeLLM(JSON.stringify(swapped)) });
  assert.strictEqual(res.requiresConfirmation, true, 'Joana nunca vira Carlos');

  const pronoun = await interpretVoiceCommandWithLLM('Ele pagou 500', ctx, { llm: fakeLLM(JSON.stringify(swapped)) });
  assert.strictEqual(pronoun.requiresConfirmation, false, 'pronome usa o cliente do contexto');
});

test('LLM sem valor de pagamento e sem quitação → pergunta o valor', async () => {
  const res = await interpretVoiceCommandWithLLM('O Carlos pagou', emptyContext('u'), {
    llm: fakeLLM(JSON.stringify(llmOutput({ intent: 'register_payment', customerName: 'Carlos' }))),
  });
  assert.strictEqual(res.requiresConfirmation, true);
  assert.strictEqual(res.missingInformation[0]?.type, 'payment_breakdown');
});

// ---------------------------------------------------------------- builder

function interpreted(partial: Partial<InterpretedVoiceCommand>): InterpretedVoiceCommand {
  return { intent: 'create_sale', requiresConfirmation: false, missingInformation: [], ambiguities: [], rawText: '', normalizedText: '', ...partial };
}

test('builder: troca canônica fecha 26000 = 15000 + 3000 + 8000', () => {
  const built = buildDealCommand(interpreted({
    intent: 'create_trade', counterparty: { name: 'Carlos' }, itemOut: 'XRE', itemIn: 'Bros', totalValue: 26000, itemInValue: 15000,
    direction: 'inflow', tradeBalance: 11000, cashIn: 3000, paymentMethod: 'pix', receivable: 8000, installmentsCount: 4, installmentAmount: 2000, dueDay: 15,
    scheduleRule: { type: 'monthly_day', firstDueDate: '2026-10-15', dayOfMonth: 15 },
  }));
  assert.strictEqual(built.status, 'ok');
  if (built.status !== 'ok') return;
  assert.strictEqual(built.command.itemsIn[0].negotiatedValue, 15000);
  assert.strictEqual(built.command.receivables[0].installments?.count, 4);
  assert.strictEqual(built.command.cashIn[0].method, 'pix');
});

test('builder: troca sem valor dos itens pergunta em vez de inventar', () => {
  const built = buildDealCommand(interpreted({ intent: 'create_trade', itemOut: 'iPhone 13', itemIn: 'S23 Ultra', direction: 'inflow', tradeBalance: 1000 }));
  assert.strictEqual(built.status, 'needs_input');
});

test('builder: venda sem forma de pagamento usa "other", nunca inventa Pix', () => {
  const built = buildDealCommand(interpreted({ item: 'moto', totalValue: 5000, cashIn: 5000, counterparty: { name: 'Ana' } }));
  assert.strictEqual(built.status, 'ok');
  if (built.status === 'ok') assert.strictEqual(built.command.cashIn[0].method, 'other');
});

test('builder: parcelas que não fecham com o valor a receber perguntam', () => {
  const built = buildDealCommand(interpreted({ item: 'moto', totalValue: 5000, cashIn: 1000, receivable: 4000, installmentsCount: 3, installmentAmount: 1000 }));
  assert.strictEqual(built.status, 'needs_input');
});

// ---------------------------------------------------------------- resolvers

test('homônimos: "João" com Silva e Santos é ambíguo; nome exato resolve', () => {
  const rows = [{ id: '1', name: 'João Silva' }, { id: '2', name: 'João Santos' }];
  assert.strictEqual(pickCandidates('João', rows).status, 'ambiguous');
  assert.strictEqual(pickCandidates('joao santos', rows).matches[0]?.id, '2');
  assert.strictEqual(pickCandidates('Maria', rows).status, 'not_found');
});

test('itens: "iPhone 13" é ambíguo entre Preto e Azul; "13" não casa com "130"', () => {
  const rows = [{ id: 'p', name: 'iPhone 13 Preto' }, { id: 'a', name: 'iPhone 13 Azul' }, { id: 't', name: 'Titan 130' }];
  const r = pickCandidates('iPhone 13', rows);
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.matches.length, 2);
  assert.strictEqual(pickCandidates('titan 13', rows).status, 'not_found');
});

test('resposta à desambiguação: nome, token distintivo e ordinal', () => {
  const c = [{ id: 'p', name: 'iPhone 13 Preto' }, { id: 'a', name: 'iPhone 13 Azul' }];
  assert.strictEqual(matchCandidateAnswer('o azul', c)?.id, 'a');
  assert.strictEqual(matchCandidateAnswer('o primeiro', c)?.id, 'p');
  assert.strictEqual(matchCandidateAnswer('sei lá', c), null);
});

test('parcela alvo: "primeira" é a nº 1; parcela já paga não é escolhida silenciosamente', () => {
  const insts: OpenInstallment[] = [1, 2, 3].map((n) => ({
    id: `i${n}`, number: n, totalInstallments: 3, originalValue: 100, balance: n === 1 ? 0 : 100, dueDate: `2026-1${n}-15`, status: n === 1 ? 'paid' : 'pending',
  }));
  assert.ok(pickInstallment(insts, 'first').error, 'primeira já paga → pergunta');
  assert.strictEqual(pickInstallment(insts, 'next').installment?.id, 'i2');
  assert.strictEqual(pickInstallment(insts, 3).installment?.id, 'i3');
  assert.strictEqual(pickInstallment(insts, undefined).installment, undefined);
});

// ---------------------------------------------------------------- utilitários

test('números falados em português', () => {
  assert.deepStrictEqual(extractSpokenNumbers('vinte e seis mil'), [26000]);
  assert.deepStrictEqual(extractSpokenNumbers('dois mil e quinhentos'), [2500]);
  assert.deepStrictEqual(extractSpokenNumbers('mandou três no pix e quatro de dois'), [3, 4, 2]);
  assert.deepStrictEqual(extractSpokenNumbers('R$ 1.500,00 e 3 mil'), [1500, 3000]);
});

test('mentionsOtherName ignora início de frase comum e detecta outro nome', () => {
  assert.strictEqual(mentionsOtherName('Ele quitou o resto.', 'Carlos'), false);
  assert.strictEqual(mentionsOtherName('Quitou o resto.', 'Carlos'), false);
  assert.strictEqual(mentionsOtherName('A Joana pagou 500', 'Carlos'), true);
});

test('novo vencimento: dia 10 do mês que vem / próxima ocorrência / fim de mês', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  assert.strictEqual(computeNewDueDate({ dueDay: 10, dueMonthOffset: 1 }, now), '2026-10-10');
  assert.strictEqual(computeNewDueDate({ dueDay: 25 }, now), '2026-09-25');
  assert.strictEqual(computeNewDueDate({ dueDay: 5 }, now), '2026-10-05');
  assert.strictEqual(computeNewDueDate({ dueDay: 31, dueMonthOffset: 2 }, now), '2026-11-30');
  assert.strictEqual(computeNewDueDate({}, now), null);
});

test('retomada: resposta numérica preenche o campo pendente (convenção de milhares)', () => {
  const draft = interpreted({
    intent: 'create_trade', itemOut: 'XRE', itemIn: 'Bros', totalValue: 26000, direction: 'inflow', tradeBalance: 11000,
  });
  const resumed = resumePending('15 mil', {
    kind: 'missing_info', originalTranscript: 'x', promptAsked: '?', draft: draft as unknown as Record<string, unknown>, field: 'itemInValue', timestamp: 0,
  });
  assert.strictEqual(resumed?.itemInValue, 15000);
  const short = resumePending('quinze', {
    kind: 'missing_info', originalTranscript: 'x', promptAsked: '?', draft: draft as unknown as Record<string, unknown>, field: 'itemInValue', timestamp: 0,
  });
  assert.strictEqual(short?.itemInValue, 15000);
  assert.strictEqual(resumePending('vendi outra moto pro Carlos por 20 mil em 4 vezes', {
    kind: 'missing_info', originalTranscript: 'x', promptAsked: '?', draft: draft as unknown as Record<string, unknown>, field: 'itemInValue', timestamp: 0,
  }), null, 'fala longa é comando novo');
});

test('retomada: comando novo completo nunca é absorvido como resposta', () => {
  const draft = interpreted({ intent: 'register_payment', counterparty: { name: 'Carlos' } });
  const pend = (field: string) => ({
    kind: 'missing_info' as const, originalTranscript: 'x', promptAsked: '?', draft: draft as unknown as Record<string, unknown>, field, timestamp: 0,
  });
  assert.strictEqual(resumePending('O João pagou 500 no Pix.', pend('amount')), null);
  assert.strictEqual(resumePending('O João pagou 500 no Pix.', pend('customer')), null);
  assert.strictEqual(resumePending('foi 500 reais', pend('amount'))?.amount, 500);
  assert.strictEqual(resumePending('pro Carlos Souza', pend('customer'))?.counterparty?.name, 'Carlos Souza');
});

test('consistência: volta paga registrada como dinheiro recebido e mesmo item nos dois lados bloqueiam', async () => {
  const paidAsReceived = llmOutput({
    intent: 'create_trade', customerName: 'Lucas', itemOut: 'Fan 160', itemIn: 'Moto G84', cashIn: 9600, tradeBalance: 9600, direction: 'outflow',
  });
  const text = 'Peguei a Moto G84 do Lucas, dei minha Fan 160 e completei 9600 em dinheiro.';
  const r1 = await interpretVoiceCommandWithLLM(text, emptyContext('u'), { llm: fakeLLM(JSON.stringify(paidAsReceived)) });
  assert.strictEqual(r1.requiresConfirmation, true);

  const sameItem = llmOutput({ intent: 'create_trade', customerName: 'Carlos', itemOut: 'Bros', itemIn: 'Bros', direction: 'even', tradeBalance: 0 });
  const r2 = await interpretVoiceCommandWithLLM(CANONICAL, emptyContext('u'), { llm: fakeLLM(JSON.stringify(sameItem)) });
  assert.strictEqual(r2.requiresConfirmation, true);
});

test('"iPhone 13 pro Pedro": "pro" antes do cliente é preposição', async () => {
  const out = llmOutput({ intent: 'create_sale', customerName: 'Pedro', item: 'iPhone 13 pro', totalValue: 3000, cashIn: 3000, paymentMethod: 'pix' });
  const r = await interpretVoiceCommandWithLLM('Vendi o iPhone 13 pro Pedro por 3000 no Pix.', emptyContext('u'), { llm: fakeLLM(JSON.stringify(out)) });
  assert.strictEqual(r.item, 'iPhone 13');
});

test('escrita sem cliente (nem na fala nem no contexto) pede o cliente', async () => {
  const noCustomer = llmOutput({ intent: 'register_partial_payment', amount: 1800, paymentScope: 'amount' });
  const text = 'João só conseguiu me pagar 1800 daquela parcela de mil.';
  const r = await interpretVoiceCommandWithLLM(text, emptyContext('u'), { llm: fakeLLM(JSON.stringify(noCustomer)) });
  assert.strictEqual(r.requiresConfirmation, true);
  assert.ok(r.missingInformation.some((m) => m.type === 'customer_reference'));
});

test('venda 3000, entrada 1000, 10 parcelas: deriva 2000 e pergunta vencimento', async () => {
  const speech = 'Vendi uma moto por 3000, entrada de 1000 e o restante em 10 vezes de 200.';
  const llm = llmOutput({ intent: 'create_sale', item: 'moto', totalValue: 3000, cashIn: 1000,
    receivable: 2000, installmentsCount: 10, installmentAmount: 200 });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(llm)), now: new Date('2026-09-27T12:00:00Z') });
  assert.deepStrictEqual(checkGrounding(result, speech), []);
  assert.strictEqual(result.requiresConfirmation, true);
  assert.ok(result.missingInformation.some((item) => item.type === 'installment_due_date'));
  const built = buildDealCommand(result);
  assert.strictEqual(built.status, 'needs_input');
  if (built.status === 'needs_input') assert.strictEqual(built.field, 'installment_schedule');
  assert.ok(checkGrounding({ ...result, cashIn: 1200 }, speech).some((item) => item.field === 'cashIn'));
});

test('data inventada pela LLM não entra no cronograma', async () => {
  const speech = 'Vendi uma moto por 3000, entrada 1000 e 10 parcelas de 200.';
  const llm = llmOutput({ intent: 'create_sale', item: 'moto', totalValue: 3000, cashIn: 1000,
    receivable: 2000, installmentsCount: 10, installmentAmount: 200,
    firstDueDate: '2026-10-31', scheduleType: 'monthly_day', recurrenceDay: 31,
    explicitDueDates: ['2026-10-31'] });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(llm)), now: new Date('2026-09-27T12:00:00Z') });
  assert.strictEqual(result.scheduleRule, undefined);
  assert.strictEqual(result.firstDueDate, undefined);
  assert.strictEqual(result.requiresConfirmation, true);
});

test('recebível sem contagem usa uma parcela e respeita vencimento dito', async () => {
  const speech = 'Vendi uma moto por 3000, entrou 1000 e o restante vence amanhã.';
  const llm = llmOutput({ intent: 'create_sale', item: 'moto', totalValue: 3000, cashIn: 1000, receivable: 2000 });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(llm)), now: new Date('2026-09-27T12:00:00Z') });
  assert.strictEqual(result.installmentsCount, 1);
  assert.strictEqual(result.requiresConfirmation, false);
  const built = buildDealCommand(result);
  assert.strictEqual(built.status, 'ok');
  if (built.status === 'ok') assert.deepStrictEqual(built.command.receivables[0].installments?.manualInstallments?.map((i) => i.dueDate), ['2026-09-28']);
  const missingDate = interpreted({ item: 'moto', totalValue: 3000, cashIn: 1000, receivable: 2000,
    missingInformation: [{ type: 'installment_due_date', description: 'Quando vence?', promptQuestion: 'Quando vence?' }] });
  const resumed = resumePending('Amanhã', { kind: 'missing_info', originalTranscript: speech, promptAsked: 'Quando vence?',
    draft: missingDate as unknown as Record<string, unknown>, field: 'installment_schedule', timestamp: 0 }, new Date('2026-09-27T12:00:00Z'));
  assert.strictEqual(resumed?.requiresConfirmation, false);
  assert.deepStrictEqual(resumed?.explicitDueDates, ['2026-09-28']);
});

test('data da venda não vira vencimento e dia por extenso vira recorrência', async () => {
  const speech = 'Vendi em 20/09/2026 por 3000 em 3 vezes todo dia dez.';
  const llm = llmOutput({ intent: 'create_sale', totalValue: 3000, receivable: 3000, installmentsCount: 3, installmentAmount: 1000,
    dueDay: 10, firstDueDate: '2026-09-20', explicitDueDates: ['2026-09-20'], scheduleType: 'monthly_day', recurrenceDay: 10 });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(llm)), now: new Date('2026-09-27T12:00:00Z') });
  assert.strictEqual(result.scheduleRule?.type, 'monthly_day');
  assert.deepStrictEqual(result.explicitDueDates, ['2026-10-10']);
  const built = buildDealCommand(result);
  assert.strictEqual(built.status, 'ok');
  if (built.status === 'ok') assert.deepStrictEqual(built.command.receivables[0].installments?.manualInstallments?.map((i) => i.dueDate),
    ['2026-10-10', '2026-11-10', '2026-12-10']);
});

test('troca deriva volta e saldo parcelado apenas dos valores financeiros relacionados', () => {
  const speech = 'Troquei minha moto de 5000 na de 3000 do Pedro, ele deu 500 de entrada e o resto em 5 vezes.';
  const cmd = interpreted({ intent: 'create_trade', counterparty: { name: 'Pedro' }, itemOut: 'moto', itemIn: 'moto',
    totalValue: 5000, itemInValue: 3000, tradeBalance: 2000, direction: 'inflow', cashIn: 500,
    receivable: 1500, installmentsCount: 5, installmentAmount: 300 });
  assert.deepStrictEqual(checkGrounding(cmd, speech), []);
  assert.ok(checkGrounding({ ...cmd, receivable: 1700 }, speech).some((item) => item.field === 'receivable'));
});

test('resposta curta com primeira data preserva negócio e pede recorrência', () => {
  const draft = interpreted({ item: 'moto', totalValue: 3000, cashIn: 1000, installmentsCount: 10,
    missingInformation: [{ type: 'installment_due_date', description: 'Quando vencem?', promptQuestion: 'Quando vencem?' }] });
  const pending = { kind: 'missing_info' as const, originalTranscript: 'Vendi uma moto por 3000, entrada 1000, 10 vezes',
    promptAsked: 'Quando vencem?', draft: draft as unknown as Record<string, unknown>, field: 'installment_schedule', timestamp: 0 };
  const now = new Date('2026-09-27T12:00:00Z');
  const first = resumePending('A primeira dia 28/09.', pending, now);
  assert.deepStrictEqual(first?.explicitDueDates, ['2026-09-28']);
  assert.strictEqual(first?.requiresConfirmation, true);
  assert.match(first?.confirmationPrompt ?? '', /todo dia 28/);
  const second = resumePending('Sim', { ...pending, draft: first as unknown as Record<string, unknown> }, now);
  assert.strictEqual(second?.scheduleRule?.type, 'monthly_day');
  assert.strictEqual(second?.requiresConfirmation, false);
  const built = buildDealCommand(second!);
  assert.strictEqual(built.status, 'ok');
  if (built.status === 'ok') {
    assert.strictEqual(built.command.receivables[0].totalAmount, 2000);
    assert.deepStrictEqual(built.command.receivables[0].installments?.manualInstallments?.slice(0, 2).map((i) => [i.dueDate, i.amount]),
      [['2026-09-28', 200], ['2026-10-28', 200]]);
  }
});

test('regra temporal: mensal, dias exatos, datas livres e híbrida', () => {
  assert.strictEqual(addCalendarMonthsClamped('2027-01-31', 1, 31), '2027-02-28');
  assert.strictEqual(addCalendarMonthsClamped('2027-01-31', 2, 31), '2027-03-31');
  assert.strictEqual(addExactDays('2027-01-31', 30), '2027-03-02');
  const monthly = interpretScheduleRule('Primeira 28/09 e depois todo dia 28.', 3, '2026-09-27');
  assert.deepStrictEqual(buildInstallmentSchedule({ total: 100, count: 3, rule: monthly.rule! }).map((i) => i.dueDate),
    ['2026-09-28', '2026-10-28', '2026-11-28']);
  const exact = interpretScheduleRule('Primeira 31/01/2027, depois a cada 30 dias.', 3, '2026-09-27');
  assert.deepStrictEqual(buildInstallmentSchedule({ total: 100, count: 3, rule: exact.rule! }).map((i) => i.dueDate),
    ['2027-01-31', '2027-03-02', '2027-04-01']);
  const spokenInterval = interpretScheduleRule('Primeira 31/01/2027, depois a cada trinta dias.', 2, '2026-09-27');
  assert.deepStrictEqual(buildInstallmentSchedule({ total: 10, count: 2, rule: spokenInterval.rule! }).map((i) => i.dueDate),
    ['2027-01-31', '2027-03-02']);
  const custom = interpretScheduleRule('28/09, 10/10 e 20/11.', 3, '2026-09-27');
  assert.deepStrictEqual(buildInstallmentSchedule({ total: 100, count: 3, rule: custom.rule! }).map((i) => i.dueDate),
    ['2026-09-28', '2026-10-10', '2026-11-20']);
  assert.strictEqual(buildInstallmentSchedule({ total: 1, count: 3, rule: custom.rule! }).reduce((sum, i) => sum + Math.round(i.amount * 100), 0), 100);
  const hybrid = interpretScheduleRule('Primeira 28/09, segunda 15/10 e depois todo dia 15.', 4, '2026-09-27');
  assert.deepStrictEqual(buildInstallmentSchedule({ total: 100, count: 4, rule: hybrid.rule! }).map((i) => i.dueDate),
    ['2026-09-28', '2026-10-15', '2026-11-15', '2026-12-15']);
  assert.deepStrictEqual(interpretScheduleRule('dia 10 do mês que vem', 2, '2026-09-27').explicitDates, ['2026-10-10']);
  assert.deepStrictEqual(interpretScheduleRule('primeira 20/09', 2, '2026-09-27').explicitDates, ['2027-09-20']);
  const outOfOrder = interpretScheduleRule('primeira 28/09, segunda 10/09', 2, '2026-09-27');
  assert.throws(() => buildInstallmentSchedule({ total: 10, count: 2, rule: outOfOrder.rule! }));
  assert.throws(() => buildInstallmentSchedule({ total: 10, count: 2, rule: { type: 'custom_dates', dates: ['2026-10-10', '2026-10-01'] } }));
});

test('empréstimo por voz aceita cronograma explícito no plano financeiro', () => {
  const rule = interpretScheduleRule('Primeira 31/01/2027 e as outras todo dia 31.', 3, '2026-09-27').rule!;
  const plan = planLoan({ principal: 100, interestType: 'fixed_amount', interestAmount: 0, installmentsCount: 3,
    scheduleRule: rule, startDate: '2026-09-27' });
  assert.strictEqual(plan.ok, true);
  if (plan.ok) assert.deepStrictEqual(plan.schedule.map((i) => i.dueDate), ['2027-01-31', '2027-02-28', '2027-03-31']);
});

test('direção de dívida explícita reconhece credor e devedor, sem adivinhar frases vagas', () => {
  const inflow = ['Ele ficou me devendo 20 mil.', 'Pedro me deve 20 da troca.',
    'Ficaram 20 pra ele me pagar.', 'Ele ficou de me pagar vinte mil.',
    'Ele ficou devendo 20 pra mim.', 'Ele me ficou devendo vinte.'];
  const outflow = ['Eu ainda devo 20 pra ele.', 'Fiquei de pagar 20 pro Pedro.',
    'Ficaram 20 pra eu pagar.', 'Faltaram vinte que eu vou pagar.', 'Eu fiquei com 20 pra pagar.'];
  for (const phrase of inflow) assert.deepStrictEqual(inferTradeBalanceDirection(phrase),
    { direction: 'inflow', confidence: 'explicit', amount: 20000 }, phrase);
  for (const phrase of outflow) assert.deepStrictEqual(inferTradeBalanceDirection(phrase),
    { direction: 'outflow', confidence: 'explicit', amount: 20000 }, phrase);
  for (const phrase of ['ficaram 20', 'sobrou 20', 'teve uma diferença de 20', 'deu 20 de volta', 'faltaram 20']) {
    assert.strictEqual(inferTradeBalanceDirection(phrase).confidence, 'unknown', phrase);
  }
  assert.deepStrictEqual(inferTradeBalanceDirection('Pedro ficou me devendo. Vence dia 10.'),
    { direction: 'inflow', confidence: 'explicit', amount: undefined });
});

test('Jetta/Hilux: LLM sem direção é corrigida; dívida não vira caixa e só pergunta vencimento', async () => {
  const speech = 'Troquei um Jetta no Hilux e o Pedro ficou me devendo 20 mil.';
  const incomplete = llmOutput({ intent: 'create_trade', customerName: 'Pedro', itemOut: 'Jetta', itemIn: 'Hilux',
    tradeBalance: 20000, receivable: 20000, direction: null });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(incomplete)) });
  assert.strictEqual(result.intent, 'create_trade');
  assert.strictEqual(result.counterparty?.name, 'Pedro');
  assert.strictEqual(result.itemOut, 'Jetta');
  assert.strictEqual(result.itemIn, 'Hilux');
  assert.strictEqual(result.tradeBalance, 20000);
  assert.strictEqual(result.direction, 'inflow');
  assert.strictEqual(result.receivable, 20000);
  assert.strictEqual(result.cashIn, undefined);
  assert.strictEqual(result.installmentsCount, 1);
  assert.ok(result.missingInformation.some((m) => m.type === 'installment_due_date' && /Quando vence essa parcela/.test(m.promptQuestion)));
  assert.ok(!result.missingInformation.some((m) => m.type === 'trade_balance_direction'));
  assert.ok(!result.ambiguities.some((a) => a.field === 'direction'));
  const fallback = interpretVoiceCommand(speech, emptyContext('u'));
  assert.strictEqual(fallback.direction, 'inflow');
  assert.strictEqual(fallback.receivable, 20000);
  assert.strictEqual(fallback.cashIn, undefined);
});

test('Jetta/Hilux: resposta do vencimento preserva recebível e segue para avaliação dos itens', async () => {
  const speech = 'Troquei um Jetta no Hilux e o Pedro ficou me devendo 20 mil.';
  const parsed = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { now: new Date('2026-09-28T12:00:00Z'),
    llm: fakeLLM(JSON.stringify(llmOutput({ intent: 'create_trade', customerName: 'Pedro', itemOut: 'Jetta',
      itemIn: 'Hilux', tradeBalance: 20000, receivable: 20000 }))) });
  const due = parsed.missingInformation.find((m) => m.type === 'installment_due_date');
  assert.match(due?.promptQuestion ?? '', /Quando vence essa parcela de R\$ 20\.000/);
  const resumed = resumePending('Dia 10 de outubro.', { kind: 'missing_info', originalTranscript: speech,
    promptAsked: due!.promptQuestion, draft: parsed as unknown as Record<string, unknown>,
    field: 'installment_schedule', timestamp: 0 }, new Date('2026-09-28T12:00:00Z'));
  assert.strictEqual(resumed?.direction, 'inflow');
  assert.strictEqual(resumed?.receivable, 20000);
  assert.strictEqual(resumed?.cashIn, undefined);
  assert.deepStrictEqual(resumed?.explicitDueDates, ['2026-10-10']);
  const built = buildDealCommand(resumed!);
  assert.strictEqual(built.status, 'needs_input');
  if (built.status === 'needs_input') assert.strictEqual(built.field, 'itemInValue');
  const valued = buildDealCommand({ ...resumed!, itemInValue: 100000, totalValue: 120000 });
  assert.strictEqual(valued.status, 'ok');
  if (valued.status === 'ok') {
    assert.strictEqual(valued.command.cashIn.length, 0);
    assert.strictEqual(valued.command.receivables[0].totalAmount, 20000);
    assert.deepStrictEqual(valued.command.receivables[0].installments?.manualInstallments?.map((i) => i.dueDate), ['2026-10-10']);
  }
});

test('troca inversa gera payable sem cashOut; direção contraditória ou caixa inventado bloqueia', async () => {
  const speech = 'Troquei meu Jetta na Hilux e fiquei devendo 20 mil pro Pedro.';
  const incomplete = llmOutput({ intent: 'create_trade', customerName: 'Pedro', itemOut: 'Jetta', itemIn: 'Hilux',
    tradeBalance: 20000, payable: 20000, direction: null });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(incomplete)) });
  assert.strictEqual(result.direction, 'outflow');
  assert.strictEqual(result.payable, 20000);
  assert.strictEqual(result.cashOut, undefined);
  assert.ok(!result.missingInformation.some((m) => m.type === 'trade_balance_direction'));
  const fallback = interpretVoiceCommand(speech, emptyContext('u'));
  assert.strictEqual(fallback.direction, 'outflow');
  assert.strictEqual(fallback.payable, 20000);
  assert.strictEqual(fallback.cashOut, undefined);
  const scheduled = buildDealCommand({ ...result, totalValue: 100000, itemInValue: 120000,
    scheduleRule: { type: 'custom_dates', dates: ['2026-10-10'] }, explicitDueDates: ['2026-10-10'],
    firstDueDate: '2026-10-10' });
  assert.strictEqual(scheduled.status, 'ok');
  if (scheduled.status === 'ok') {
    assert.strictEqual(scheduled.command.cashOut.length, 0);
    assert.strictEqual(scheduled.command.payables[0].totalAmount, 20000);
    assert.deepStrictEqual(scheduled.command.payables[0].installments?.manualInstallments?.map((i) => i.dueDate), ['2026-10-10']);
  }
  const wrong = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify({ ...incomplete, direction: 'inflow', cashIn: 20000 })) });
  assert.strictEqual(wrong.requiresConfirmation, true);
  assert.ok(wrong.ambiguities.some((a) => a.field === 'direction'));
  const short = await interpretVoiceCommandWithLLM('Troquei o Jetta na Hilux e eu ainda devo 20 pra ele.', emptyContext('u'), {
    llm: fakeLLM(JSON.stringify({ ...incomplete, customerName: null, tradeBalance: 20, payable: 20 })),
  });
  assert.strictEqual(short.tradeBalance, 20000);
  assert.strictEqual(short.payable, 20000);
  assert.ok(!short.ambiguities.some((a) => a.field === 'direction'));
});

test('pagamentos imediatos continuam caixa; diferença sem sujeito continua ambígua', () => {
  for (const [speech, direction, cash] of [
    ['Troquei o Jetta na Hilux e ele me voltou 5 mil.', 'inflow', 'cashIn'],
    ['Troquei o Jetta na Hilux e ele me deu 5 mil.', 'inflow', 'cashIn'],
    ['Troquei o Jetta na Hilux e eu completei 5 mil.', 'outflow', 'cashOut'],
  ] as const) {
    const result = interpretVoiceCommand(speech, emptyContext('u'));
    assert.strictEqual(result.direction, direction, speech);
    assert.strictEqual(result[cash], 5000, speech);
  }
  const even = interpretVoiceCommand('Troquei o Jetta na Hilux pau a pau.', emptyContext('u'));
  assert.strictEqual(even.direction, 'even');
  const vague = interpretVoiceCommand('Troquei o Jetta na Hilux e teve uma diferença de 5 mil.', emptyContext('u'));
  assert.strictEqual(vague.direction, undefined);
  assert.ok(vague.missingInformation.some((m) => m.type === 'trade_balance_direction'));
  const goods = interpretVoiceCommand('Troquei minha Fan 160 na Hilux e dei a moto para o Pedro.', emptyContext('u'));
  assert.strictEqual(goods.cashOut, undefined);
  assert.strictEqual(goods.tradeBalance, undefined);
  assert.strictEqual(goods.requiresConfirmation, true);
});

test('backend não aceita direção inventada pela LLM para diferença sem sujeito', async () => {
  const speech = 'Troquei o Jetta na Hilux e teve uma diferença de 5 mil.';
  const guessed = llmOutput({ intent: 'create_trade', itemOut: 'Jetta', itemIn: 'Hilux',
    direction: 'inflow', tradeBalance: 5000, receivable: 5000 });
  const result = await interpretVoiceCommandWithLLM(speech, emptyContext('u'), { llm: fakeLLM(JSON.stringify(guessed)) });
  assert.strictEqual(result.direction, undefined);
  assert.strictEqual(result.requiresConfirmation, true);
  assert.ok(result.missingInformation.some((m) => m.type === 'trade_balance_direction'));
  assert.match(result.confirmationPrompt ?? '', /receber ou pagar/);
});

(async () => {
  let failed = 0;
  console.log('\nTESTES UNITÁRIOS DO PIPELINE DE IA\n──────────────────────────────────');
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
