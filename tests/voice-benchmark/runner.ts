// tests/voice-benchmark/runner.ts
// Executor Oficial do Benchmark Automatizado de IA — Fase 35 & Fase H do FigoCRM
// O benchmark NÃO conhece previamente a categoria, intenção ou valores esperados.
// Ele executa o interpretador puro de produção `interpretVoiceCommand` e afere acurácia real.

import fs from 'fs';
import path from 'path';
import { interpretVoiceCommand } from '../../src/lib/ai/interpreter';
import { computeBenchmarkScore, ScenarioEvaluationResult } from './scoring';

const datasetPath = path.resolve(__dirname, 'cases.json');

console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
console.log('\x1b[36m%s\x1b[0m', '  INICIANDO BENCHMARK OFICIAL DE IA (Fase 35 - FigoCRM)       ');
console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════\n');

if (!fs.existsSync(datasetPath)) {
  console.error(`Dataset não encontrado em: ${datasetPath}`);
  process.exit(1);
}

const rawCases = fs.readFileSync(datasetPath, 'utf-8');
const cases: Array<{
  id: string;
  category: string;
  input: string;
  expected: {
    intent: string;
    customer?: string;
    item?: string;
    totalValue?: number;
    amount?: number;
    cashIn?: number;
    cashOut?: number;
    tradeBalance?: number;
    direction?: 'inflow' | 'outflow' | 'even';
    requiresConfirmation?: boolean;
    unsafeExecutionForbidden?: boolean;
  };
}> = JSON.parse(rawCases);

console.log(`Carregados ${cases.length} cenários de teste canônicos.\n`);

const results: ScenarioEvaluationResult[] = [];

for (const c of cases) {
  // Executa o interpretador puro de produção SEM qualquer dica de categoria ou valores
  const predicted = interpretVoiceCommand(c.input);

  // 1. Verificação de Risco de Execução Insegura (Zero Tolerância)
  let unsafeExecution = false;
  if (c.expected.unsafeExecutionForbidden || c.category === 'ambiguidade') {
    if (!predicted.requiresConfirmation) {
      unsafeExecution = true;
    }
  }

  // 2. Aferição de Intenção
  const intentMatch = predicted.intent === c.expected.intent;

  // 3. Aferição de Direção (Trocas e Movimentações)
  let directionMatch = true;
  if (c.expected.direction) {
    directionMatch = predicted.direction === c.expected.direction;
  }

  // 4. Aferição de Valores Numéricos (Validação Real, NÃO hardcoded!)
  let valueMatch = true;
  if (c.expected.totalValue !== undefined) {
    valueMatch = valueMatch && predicted.totalValue === c.expected.totalValue;
  }
  if (c.expected.amount !== undefined) {
    const actAmount = predicted.amount ?? predicted.adjustmentAmount;
    valueMatch = valueMatch && actAmount === c.expected.amount;
  }
  if (c.expected.tradeBalance !== undefined) {
    valueMatch = valueMatch && predicted.tradeBalance === c.expected.tradeBalance;
  }
  if (c.expected.cashIn !== undefined) {
    valueMatch = valueMatch && predicted.cashIn === c.expected.cashIn;
  }

  // 5. Aferição de Detecção de Ambiguidade
  let ambiguityMatch = true;
  if (c.expected.requiresConfirmation !== undefined) {
    ambiguityMatch = predicted.requiresConfirmation === c.expected.requiresConfirmation;
  }

  const passed = intentMatch && directionMatch && valueMatch && ambiguityMatch && !unsafeExecution;

  results.push({
    id: c.id,
    category: c.category,
    input: c.input,
    passed,
    intentMatch,
    valueMatch,
    directionMatch,
    ambiguityMatch,
    unsafeExecution,
    notes: !passed
      ? `Falha: intent(${intentMatch}) dir(${directionMatch}) val(${valueMatch}) amb(${ambiguityMatch}) unsafe(${unsafeExecution}) | pred: ${JSON.stringify(predicted.intent)} exp: ${JSON.stringify(c.expected.intent)}`
      : undefined,
  });
}

// Apuração das métricas
const metrics = computeBenchmarkScore(results);

console.log('MÉTRICAS OFICIAIS APURADAS:');
console.log('---------------------------------------------------------------');
console.log(`Total de Cenários Avaliados:   ${metrics.totalScenarios}`);
console.log(`Intent Accuracy:               ${metrics.intentAccuracy}%  (Meta: >= 97%)`);
console.log(`Direction Accuracy:            ${metrics.directionAccuracy}% (Meta: >= 99%)`);
console.log(`Ambiguity Detection Rate:      ${metrics.ambiguityDetectionRate}% (Meta: >= 95%)`);
console.log(`Unsafe Execution Rate:         \x1b[${metrics.unsafeExecutionRate === 0 ? '32m' : '31m'}${metrics.unsafeExecutionRate}%\x1b[0m  (MANDATÓRIO: 0.0%)`);
console.log(`Full Scenario Accuracy:        \x1b[${metrics.fullScenarioAccuracy >= 90 ? '32m' : '31m'}${metrics.fullScenarioAccuracy}%\x1b[0m (Meta: >= 90%)`);
console.log('---------------------------------------------------------------\n');

console.log('DESEMPENHO POR CATEGORIA:');
console.table(metrics.categoryBreakdown);

if (metrics.unsafeExecutionRate > 0) {
  console.error('\x1b[31m%s\x1b[0m', '\nCRITÉRIO DE ACEITE NÃO ATENDIDO: Unsafe Execution Rate > 0%.');
  process.exit(1);
}

if (metrics.fullScenarioAccuracy < 90) {
  console.error('\x1b[31m%s\x1b[0m', '\nCRITÉRIO DE ACEITE NÃO ATENDIDO: Full Scenario Accuracy < 90%.');
  process.exit(1);
}

console.log('\x1b[32m%s\x1b[0m', '\n✓ CRITÉRIO DE ACEITE ATENDIDO COM SUCESSO: BENCHMARK APROVADO!');
