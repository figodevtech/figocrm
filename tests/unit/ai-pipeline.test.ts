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
import type { InterpretedVoiceCommand } from '../../src/lib/ai/interpreter';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function llmOutput(partial: Partial<LLMInterpretation>): LLMInterpretation {
  return {
    intent: 'unrecognized_command',
    customerName: null, item: null, itemOut: null, itemIn: null,
    totalValue: null, itemInValue: null, cashIn: null, cashOut: null, paymentMethod: null,
    tradeBalance: null, direction: null, receivable: null, payable: null,
    installmentsCount: null, installmentAmount: null, dueDay: null, dueMonthOffset: null, firstDueDate: null,
    amount: null, paymentScope: null, installmentRef: null, installmentNumber: null, debtHint: null,
    adjustmentType: null, queryType: null, missingInformation: [], ambiguities: [],
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
