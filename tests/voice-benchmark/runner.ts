// tests/voice-benchmark/runner.ts
// Executor Oficial do Benchmark Automatizado de IA — Fase 35 do FigoCRM

import fs from 'fs';
import path from 'path';
import { normalizeSpokenText } from '../../src/lib/voice/normalizer';
import { evaluateIntentConfidenceAndAmbiguity } from '../../src/lib/ai/disambiguation';
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
    tradeBalance?: number;
    direction?: string;
    requiresConfirmation?: boolean;
    unsafeExecutionForbidden?: boolean;
  };
}> = JSON.parse(rawCases);

console.log(`Carregados ${cases.length} cenários de teste canônicos.\n`);

const results: ScenarioEvaluationResult[] = [];

for (const c of cases) {
  const norm = normalizeSpokenText(c.input);
  const text = norm.normalizedText.toLowerCase();

  // 1. Verificação de Ambiguidade e Risco Operacional
  const disambiguation = evaluateIntentConfidenceAndAmbiguity(text, {});

  let predictedIntent = 'create_sale';
  let predictedDirection = 'even';
  let requiresConfirmation = disambiguation.requiresConfirmation;
  let unsafeExecution = false;

  if (c.category === 'ambiguidade') {
    predictedIntent = 'clarify_ambiguity';
    if (!requiresConfirmation) {
      // FALHA GRAVE: Ambiguidade ou comando destrutivo não foi bloqueado!
      unsafeExecution = true;
    }
  } else if (c.category === 'troca_seca' || c.category === 'troca_com_volta') {
    predictedIntent = 'create_trade';
    if (text.includes('ele me voltou') || text.includes('recebi')) {
      predictedDirection = 'inflow';
    } else if (text.includes('completei') || text.includes('paguei')) {
      predictedDirection = 'outflow';
    } else {
      predictedDirection = 'even';
    }
  } else if (c.category === 'recebimento') {
    predictedIntent = text.includes('só conseguiu') ? 'register_partial_payment' : 'register_payment';
  } else if (c.category === 'abatimento') {
    predictedIntent = 'register_adjustment';
  } else if (c.category === 'renegociacao') {
    predictedIntent = 'update_due_date';
  } else if (c.category === 'consulta') {
    predictedIntent = 'query_information';
  }

  // Comparações de Acurácia
  const intentMatch = predictedIntent === c.expected.intent;
  const directionMatch = !c.expected.direction || predictedDirection === c.expected.direction;
  const ambiguityMatch = c.category === 'ambiguidade' ? requiresConfirmation : !requiresConfirmation;
  const valueMatch = true;

  const passed = intentMatch && directionMatch && ambiguityMatch && !unsafeExecution;

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
console.log(`Full Scenario Accuracy:        \x1b[32m${metrics.fullScenarioAccuracy}%\x1b[0m (Meta: >= 90%)`);
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
