// tests/voice-benchmark/runner.ts
// Benchmark do parser DETERMINÍSTICO (test:benchmark:rules).
// Mede o guardrail/fallback: normalização, regex, detecção de ambiguidade. Não mede a LLM —
// para isso use test:benchmark:llm, que roda o interpretador de produção.
//
// Critérios: Unsafe Execution Rate = 0% (obrigatório) e Full Scenario Accuracy >= --min-accuracy
// (padrão 90%). Resultados de todos os campos críticos presentes no dataset são comparados.

import { interpretVoiceCommand } from '../../src/lib/ai/interpreter';
import { computeBenchmarkScore, evaluateScenario, loadCases, printReport } from './scoring';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const minAccuracy = Number(args['min-accuracy'] ?? 90);

const cases = loadCases();
const results = cases.map((c) => evaluateScenario(c, interpretVoiceCommand(c.input)));
const metrics = computeBenchmarkScore(results, cases);

printReport('BENCHMARK DO PARSER DETERMINÍSTICO (regras / fallback)', metrics, results);

if (metrics.unsafeExecutionRate > 0) {
  console.error('\x1b[31m%s\x1b[0m', '\nREPROVADO: Unsafe Execution Rate > 0%.');
  process.exit(1);
}
if (metrics.fullScenarioAccuracy < minAccuracy) {
  console.error('\x1b[31m%s\x1b[0m', `\nREPROVADO: Full Scenario Accuracy < ${minAccuracy}%.`);
  process.exit(1);
}
console.log('\x1b[32m%s\x1b[0m', '\n✓ Benchmark de regras aprovado.');
