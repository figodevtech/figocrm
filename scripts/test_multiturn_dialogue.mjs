// scripts/test_multiturn_dialogue.mjs
// Teste Automatizado de Conversação Multi-Turn — Fase I do Hardening FigoCRM
// Valida o fluxo canônico de 4 turnos com anáfora, consistência contábil, abatimento em bem e quitação.

import assert from 'assert';
import { interpretVoiceCommand } from '../src/lib/ai/interpreter.ts';
import { resolvePronounsAndAnaphora } from '../src/lib/ai/context_manager.ts';
import { validateDealBalance } from '../src/lib/finance/deal-balance.ts';
import { processInstallmentPaymentCents } from '../src/lib/finance/settlements.ts';
import { applyAdjustmentToBalanceCents } from '../src/lib/finance/adjustments.ts';
import { generateInstallmentScheduleCents } from '../src/lib/finance/installments.ts';
import { toCents, formatCurrencyFromCents } from '../src/lib/finance/money.ts';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  TESTE DE CONVERSAÇÃO MULTI-TURN CANÔNICA (Fase I)           ');
console.log('═══════════════════════════════════════════════════════════════\n');

// Estado do contexto conversacional que persiste entre turnos
let context = {
  userId: 'user_test_multiturn',
  expiresAt: Date.now() + 30 * 60 * 1000,
};

// --------------------------------------------------------------------------
// TURNO 1: Negociação Inicial Complexa (Troca com volta, entrada e parcelamento)
// --------------------------------------------------------------------------
console.log('TURNO 1: Negociação Inicial');
const turn1Input = 'Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.';
console.log(`> Usuário: "${turn1Input}"`);

const turn1Result = interpretVoiceCommand(turn1Input, context);
console.log('Turn 1 Result:', turn1Result);

assert.strictEqual(turn1Result.counterparty?.name, 'Carlos', 'Contraparte deve ser Carlos');
assert.strictEqual(turn1Result.itemOut, 'XRE', 'Item de saída deve ser XRE');
assert.strictEqual(turn1Result.itemIn, 'Bros', 'Item de entrada deve ser Bros');
assert.strictEqual(turn1Result.requiresConfirmation, false, 'Não deve exigir confirmação se os dados estiverem completos');

// Validação contábil da negociação
const turn1Command = {
  intent: 'create_deal',
  counterparty: { name: 'Carlos' },
  itemsOut: [{ reference: 'XRE', negotiatedValue: 26000, direction: 'OUT' }],
  itemsIn: [{ description: 'Bros', negotiatedValue: 15000, direction: 'IN' }],
  cashIn: [{ amount: 3000, method: 'pix', direction: 'IN' }],
  cashOut: [],
  receivables: [{
    totalAmount: 8000,
    installments: {
      count: 4,
      installmentAmount: 2000,
      dueDayOfMonth: 15,
    },
  }],
  payables: [],
  adjustments: [],
  missingInformation: [],
  ambiguities: [],
};

const balanceCheck = validateDealBalance(turn1Command);
assert.strictEqual(balanceCheck.isBalanced, true, 'Balanço da negociação do Turno 1 deve fechar exatamente em R$ 26.000');
assert.strictEqual(balanceCheck.totalOutCents, 2600000, 'Total de saídas deve ser 26.000,00');
assert.strictEqual(balanceCheck.totalInCents, 2600000, 'Total de entradas deve ser 26.000,00');

console.log('✓ Turno 1 interpretado e validado com sucesso contábil.');
console.log(`  - XRE OUT: ${formatCurrencyFromCents(2600000)}`);
console.log(`  - Bros IN: ${formatCurrencyFromCents(1500000)}`);
console.log(`  - Cash IN: ${formatCurrencyFromCents(300000)}`);
console.log(`  - Recebível: ${formatCurrencyFromCents(800000)} (4x de R$ 2.000 todo dia 15)\n`);

// Atualiza o contexto conversacional com o cliente e item do turno 1
context.lastCustomer = { name: 'Carlos', type: 'customer' };
context.lastItem = { name: 'XRE', type: 'item' };

// Cronograma de parcelas gerado para o cliente
const schedule = generateInstallmentScheduleCents({
  totalAmountCents: toCents(8000),
  count: 4,
  dueDayOfMonth: 15,
});

// --------------------------------------------------------------------------
// TURNO 2: Pagamento Parcial com Resolução Anafórica ("Ele mandou 500...")
// --------------------------------------------------------------------------
console.log('TURNO 2: Pagamento Parcial');
const turn2Input = 'Ele mandou 500 daquela primeira.';
console.log(`> Usuário: "${turn2Input}"`);

// 1. Resolução Anafórica
const anaphoraTurn2 = resolvePronounsAndAnaphora(turn2Input, context);
assert.strictEqual(anaphoraTurn2.resolvedCustomer?.name, 'Carlos', 'Pronome "Ele" deve resolver para Carlos');
assert.ok(anaphoraTurn2.resolvedText.includes('Carlos'), 'Texto resolvido deve conter Carlos');

// 2. Interpretação
const turn2Result = interpretVoiceCommand(turn2Input, context);
assert.strictEqual(turn2Result.intent, 'register_partial_payment', 'Intenção deve ser register_partial_payment');
assert.strictEqual(turn2Result.counterparty?.name, 'Carlos', 'Cliente da operação deve ser Carlos');
assert.strictEqual(turn2Result.amount, 500, 'Valor pago deve ser 500');

// 3. Aplicação financeira na primeira parcela
const firstInstallment = {
  id: 'inst-1',
  originalValueCents: schedule[0].originalValueCents,
  paidValueCents: 0,
  balanceCents: schedule[0].originalValueCents,
  dueDate: schedule[0].dueDate,
  status: 'pending',
};

const partialRes = processInstallmentPaymentCents(firstInstallment, toCents(500));

assert.strictEqual(partialRes.isFullySettled, false, 'Parcela 1 ainda não foi quitada');
assert.strictEqual(partialRes.updatedInstallment.newBalanceCents, 150000, 'Saldo restante da parcela 1 deve ser R$ 1.500,00');

console.log('✓ Turno 2 interpretado com anáfora resolvida com sucesso.');
console.log(`  - Carlos: Parcela 1 (R$ 2.000) recebeu R$ 500. Saldo restante: ${formatCurrencyFromCents(partialRes.updatedInstallment.newBalanceCents)}\n`);

// --------------------------------------------------------------------------
// TURNO 3: Abatimento de Dívida ("Abate mil porque ele ficou com meu som.")
// --------------------------------------------------------------------------
console.log('TURNO 3: Abatimento de Dívida');
const turn3Input = 'Abate mil porque ele ficou com meu som.';
console.log(`> Usuário: "${turn3Input}"`);

const turn3Result = interpretVoiceCommand(turn3Input, context);
assert.strictEqual(turn3Result.intent, 'register_adjustment', 'Intenção deve ser register_adjustment');
assert.strictEqual(turn3Result.counterparty?.name, 'Carlos', 'Cliente deve ser Carlos');
assert.strictEqual(turn3Result.amount, 1000, 'Valor do abatimento deve ser 1.000');
assert.strictEqual(turn3Result.adjustmentType, 'item_offset', 'Tipo do abatimento deve ser item_offset (não dinheiro!)');

// Aplicação financeira de abatimento sobre a dívida total
// Dívida inicial: 8.000 - 500 pago = 7.500.
// Abatimento de 1.000 reduz o saldo devedor para 6.500 sem gerar movimentação de caixa!
const debtAfterTurn2Cents = toCents(7500);
const offsetRes = applyAdjustmentToBalanceCents(debtAfterTurn2Cents, toCents(1000), 'item_offset');

assert.strictEqual(offsetRes.newBalanceCents, 650000, 'Saldo devedor restante deve ser R$ 6.500,00');
console.log('✓ Turno 3 interpretado como compensação de bem (item_offset).');
console.log(`  - Abatimento: ${formatCurrencyFromCents(toCents(1000))} (Tipo: item_offset)`);
console.log(`  - Saldo devedor total restante de Carlos: ${formatCurrencyFromCents(offsetRes.newBalanceCents)}\n`);

// --------------------------------------------------------------------------
// TURNO 4: Quitação Final do Saldo Restante ("Ele quitou o resto.")
// --------------------------------------------------------------------------
console.log('TURNO 4: Quitação Final');
const turn4Input = 'Ele quitou o resto.';
console.log(`> Usuário: "${turn4Input}"`);

const turn4Result = interpretVoiceCommand(turn4Input, context);
assert.strictEqual(turn4Result.intent, 'register_payment', 'Intenção deve ser register_payment');
assert.strictEqual(turn4Result.counterparty?.name, 'Carlos', 'Cliente deve ser Carlos');

// Saldo restante de 6.500 é integralmente quitado
const finalInstallment = {
  id: 'inst-total',
  originalValueCents: offsetRes.newBalanceCents,
  paidValueCents: 0,
  balanceCents: offsetRes.newBalanceCents,
  dueDate: '2026-10-15',
  status: 'pending',
};

const finalSettlement = processInstallmentPaymentCents(finalInstallment, offsetRes.newBalanceCents);

assert.strictEqual(finalSettlement.isFullySettled, true, 'Dívida deve estar 100% quitada');
assert.strictEqual(finalSettlement.updatedInstallment.newBalanceCents, 0, 'Saldo final deve ser exatamente R$ 0,00');

console.log('✓ Turno 4 quitado com sucesso.');
console.log(`  - Saldo final da conta de Carlos: ${formatCurrencyFromCents(finalSettlement.updatedInstallment.newBalanceCents)} (QUITADO)\n`);

console.log('═══════════════════════════════════════════════════════════════');
console.log('✓ TODOS OS 4 TURNOS DO DIÁLOGO CANÔNICO PASSARAM COM SUCESSO! ');
console.log('═══════════════════════════════════════════════════════════════\n');
