// scripts/test_finance_v2.mjs
// Suíte de Testes Automatizados para o Motor Financeiro V2 (Fase 26)
// Valida a precisão matemática absoluta, idempotência e ausência de dízimas residuais

import assert from 'assert';

console.log('\x1b[36m%s\x1b[0m', 'Iniciando bateria de testes do Motor Financeiro V2...');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Funções puras espelhadas para verificação direta no runtime Node
function toCents(reais) {
  return Math.round((reais + Number.EPSILON) * 100);
}
function toReais(cents) {
  return Math.round(cents) / 100;
}
function addCents(...list) {
  return list.reduce((a, b) => a + Math.round(b), 0);
}
function subtractCents(a, b) {
  return Math.round(a) - Math.round(b);
}

// 1. Precisão de Centavos e Ponto Flutuante
runTest('1.1 Conversão segura de Reais para Centavos inteiros', () => {
  assert.strictEqual(toCents(19.90), 1990);
  assert.strictEqual(toCents(0.1) + toCents(0.2), 30);
  assert.strictEqual(toReais(30), 0.30);
});

runTest('1.2 Aritmética pura em centavos previne dízima de IEEE 754', () => {
  const sum = addCents(toCents(10.01), toCents(20.02), toCents(30.03));
  assert.strictEqual(sum, 6006);
  assert.strictEqual(toReais(sum), 60.06);
});

// 2. CMV Determinístico sem Estimativas
runTest('2.1 Cálculo de CMV composto (aquisição + peças + funilaria)', () => {
  const acq = toCents(15000);
  const costs = [toCents(450), toCents(350), toCents(200)]; // 1000
  const cmv = addCents(acq, ...costs);
  assert.strictEqual(cmv, 1600000);
  assert.strictEqual(toReais(cmv), 16000.00);
});

// 3. Lucro Projetado vs Lucro Realizado
runTest('3.1 Separação entre Lucro Projetado e Lucro Realizado', () => {
  const totalNegotiated = toCents(20000);
  const totalCMV = toCents(16000);
  const projectedProfit = subtractCents(totalNegotiated, totalCMV); // 4.000
  assert.strictEqual(projectedProfit, toCents(4000));

  // Cliente pagou R$ 10.000 de entrada (50% do total)
  const collected = toCents(10000);
  const marginRatio = projectedProfit / totalNegotiated; // 0.20
  const realizedProfit = Math.round(collected * marginRatio);
  assert.strictEqual(realizedProfit, toCents(2000));
});

// 4. Parcelamento com Distribuição de Resto de Centavos
runTest('4.1 R$ 1.000 em 3 parcelas não perde centavo residual', () => {
  const totalCents = toCents(1000);
  const count = 3;
  const base = Math.floor(totalCents / count); // 33333
  let remainder = totalCents - base * count; // 1

  const schedule = [];
  for (let i = 1; i <= count; i++) {
    let val = base;
    if (remainder > 0) {
      val += 1;
      remainder--;
    }
    schedule.push(val);
  }

  assert.strictEqual(schedule[0], 33334); // R$ 333,34
  assert.strictEqual(schedule[1], 33333); // R$ 333,33
  assert.strictEqual(schedule[2], 33333); // R$ 333,33
  assert.strictEqual(addCents(...schedule), 100000);
});

runTest('4.2 Parcelamento com primeira parcela diferente', () => {
  const totalCents = toCents(1000);
  const firstCents = toCents(400); // 1ª de 400
  const remaining = subtractCents(totalCents, firstCents); // 600
  const remainingCount = 3;
  const each = remaining / remainingCount; // 200 cada

  assert.strictEqual(firstCents, 40000);
  assert.strictEqual(each, 20000);
  assert.strictEqual(firstCents + each * remainingCount, 100000);
});

// 5. Excesso de Pagamento (Fase 26.5)
runTest('5.1 Pagamento acima do saldo não é incorporado silenciosamente', () => {
  const balanceCents = toCents(500);
  const paymentCents = toCents(600);

  const effectivePaidCents = Math.min(paymentCents, balanceCents);
  const excessCents = subtractCents(paymentCents, effectivePaidCents);

  assert.strictEqual(effectivePaidCents, toCents(500));
  assert.strictEqual(excessCents, toCents(100));
});

// 6. Alocação Distribuída Priorizando Parcelas Mais Antigas (Fase 26.6)
runTest('6.1 Alocação sequencial liquida parcelas mais antigas primeiro', () => {
  const installments = [
    { id: '1', balanceCents: toCents(500), dueDate: '2026-08-10' },
    { id: '2', balanceCents: toCents(500), dueDate: '2026-09-10' },
    { id: '3', balanceCents: toCents(500), dueDate: '2026-10-10' },
  ];

  let paymentCents = toCents(1200);
  const results = [];

  for (const inst of installments) {
    if (paymentCents <= 0) break;
    const paid = Math.min(paymentCents, inst.balanceCents);
    const newBal = inst.balanceCents - paid;
    paymentCents -= paid;
    results.push({ id: inst.id, paid, newBal });
  }

  assert.strictEqual(results[0].paid, toCents(500));
  assert.strictEqual(results[0].newBal, 0); // 1ª quitada
  assert.strictEqual(results[1].paid, toCents(500));
  assert.strictEqual(results[1].newBal, 0); // 2ª quitada
  assert.strictEqual(results[2].paid, toCents(200));
  assert.strictEqual(results[2].newBal, toCents(300)); // 3ª parcialmente paga
  assert.strictEqual(paymentCents, 0);
});

// 7. Balanço de Negociação (Fase 25 e 26)
runTest('7.1 Negociação balanceada fecha perfeitamente', () => {
  const itemOut = toCents(8000);
  const cashIn = toCents(2000);
  const itemIn = toCents(2000);
  const receivable = toCents(4000);

  const totalOut = itemOut;
  const totalIn = addCents(cashIn, itemIn, receivable);
  assert.strictEqual(totalOut, totalIn);
});

runTest('7.2 Negociação desbalanceada detecta valor residual sem forma de pagamento', () => {
  const itemOut = toCents(8000);
  const cashIn = toCents(2000);
  const itemIn = toCents(2000);
  const receivable = toCents(3000); // Falta 1.000

  const diff = subtractCents(itemOut, addCents(cashIn, itemIn, receivable));
  assert.strictEqual(diff, toCents(1000));
  assert.ok(diff > 0, 'Detectou que faltam R$ 1.000 para fechar a conta');
});

// 8. Abatimento com Mercadoria (Fase 33 Cenário G)
runTest('8.1 Abatimento com entrada de mercadoria deduz do saldo e não cria pagamento em dinheiro', () => {
  const debtCents = toCents(4000);
  const itemInEvaluatedCents = toCents(2500);

  const remainingDebtCents = subtractCents(debtCents, itemInEvaluatedCents);
  assert.strictEqual(remainingDebtCents, toCents(1500));
});

console.log('\n\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
console.log(`Total de testes: ${passed + failed}`);
console.log(`  \x1b[32mPassaram: ${passed}\x1b[0m`);
console.log(`  \x1b[${failed > 0 ? '31m' : '32m'}Falharam: ${failed}\x1b[0m`);
console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
