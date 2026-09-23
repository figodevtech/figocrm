// tests/voice-benchmark/runner.ts
// Benchmark do parser DETERMINÍSTICO (test:benchmark:rules).
// Mede o guardrail/fallback: normalização, regex, detecção de ambiguidade. Não mede a LLM —
// para isso use test:benchmark:llm, que roda o interpretador de produção.
//
// Critérios:
//   - dataset principal: parser puro com Unsafe = 0% e Full Scenario >= --min-accuracy (padrão 90%)
//   - fala real variada: o parser puro é só informativo (regex não entende fala livre); o critério é o
//     FALLBACK COMO RODA EM PRODUÇÃO — provedor indisponível → regras + leitura de volta — com Unsafe = 0%.
// --verbose mostra o relatório completo da fala real com o parser puro.

import { interpretVoiceCommand } from '../../src/lib/ai/interpreter';
import { interpretVoiceCommandWithLLM } from '../../src/lib/ai/interpret';
import { LLMProviderError } from '../../src/lib/ai/provider';
import { computeBenchmarkScore, evaluateScenario, loadCases, printReport } from './scoring';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const minAccuracy = Number(args['min-accuracy'] ?? 90);
const providerDown = async () => {
  throw new LLMProviderError('timeout', 'benchmark: provedor indisponível');
};

async function main() {
  const core = loadCases('core');
  const coreResults = core.map((c) => evaluateScenario(c, interpretVoiceCommand(c.input)));
  const coreMetrics = computeBenchmarkScore(coreResults, core);
  printReport('BENCHMARK DO PARSER DETERMINÍSTICO — dataset principal', coreMetrics, coreResults);

  const realworld = loadCases('realworld');
  const rawResults = realworld.map((c) => evaluateScenario(c, interpretVoiceCommand(c.input)));
  const rawMetrics = computeBenchmarkScore(rawResults, realworld);
  if (args.verbose) printReport('PARSER PURO — fala real variada (informativo)', rawMetrics, rawResults);

  const fallbackResults = [];
  for (const c of realworld) {
    fallbackResults.push(evaluateScenario(c, await interpretVoiceCommandWithLLM(c.input, undefined, { llm: providerDown })));
  }
  const fallbackMetrics = computeBenchmarkScore(fallbackResults, realworld);

  console.log(`\nFala real variada (${realworld.length} casos)`);
  console.log(`  Parser puro (informativo):        Full Scenario ${rawMetrics.fullScenarioAccuracy}% · Unsafe ${rawMetrics.unsafeExecutionRate}% (${rawMetrics.unsafeExecutions})`);
  console.log(`  Fallback de produção (confirma):  Unsafe ${fallbackMetrics.unsafeExecutionRate}% (${fallbackMetrics.unsafeExecutions})`);
  for (const r of fallbackResults.filter((x) => x.unsafeExecution).slice(0, 15)) {
    console.log(`  INSEGURO ${r.id} ${r.notes}\n    "${r.input}"\n    pred: ${JSON.stringify(r.predicted)}`);
  }

  if (coreMetrics.unsafeExecutionRate > 0 || fallbackMetrics.unsafeExecutionRate > 0) {
    console.error('\x1b[31m%s\x1b[0m', '\nREPROVADO: Unsafe Execution Rate > 0%.');
    process.exit(1);
  }
  if (coreMetrics.fullScenarioAccuracy < minAccuracy) {
    console.error('\x1b[31m%s\x1b[0m', `\nREPROVADO: Full Scenario Accuracy < ${minAccuracy}% no dataset principal.`);
    process.exit(1);
  }
  console.log('\x1b[32m%s\x1b[0m', '\n✓ Benchmark de regras aprovado.');
}

main();
