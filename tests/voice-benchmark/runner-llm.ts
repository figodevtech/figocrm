// tests/voice-benchmark/runner-llm.ts
// Benchmark do interpretador de PRODUÇÃO com LLM real (test:benchmark:llm).
// Chama interpretVoiceCommandWithLLM — a mesma função do pipeline — em modo 'llm_required':
// sem fallback silencioso para regras. O interpretador não recebe categoria nem valores esperados.
//
// Custo: cada cenário é 1 chamada (2 se houver reparo). Use filtros:
//   npm run test:benchmark:llm -- --limit=50
//   npm run test:benchmark:llm -- --category=troca_com_volta --limit=10
//   npm run test:benchmark:llm -- --sample=40 --seed=7
//   --concurrency=4  --min-accuracy=90  --out=caminho.json
//
// Requer OPENAI_API_KEY ou GEMINI_API_KEY (lidas do ambiente ou de .env.local).

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { interpretVoiceCommandWithLLM } from '../../src/lib/ai/interpret';
import { isLLMConfigured } from '../../src/lib/ai/provider';
import { estimateCostUSD } from '../../src/lib/observability/telemetry';
import { BenchmarkCase, computeBenchmarkScore, evaluateScenario, loadCases, printReport, ScenarioEvaluationResult } from './scoring';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const limit = args.limit ? Number(args.limit) : undefined;
const sample = args.sample ? Number(args.sample) : undefined;
const seed = Number(args.seed ?? 42);
const concurrency = Math.max(1, Number(args.concurrency ?? 4));
const minAccuracy = Number(args['min-accuracy'] ?? 90);

if (!isLLMConfigured()) {
  console.error('LLM não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY (ambiente ou .env.local).');
  process.exit(2);
}

function seededShuffle<T>(items: T[], s: number): T[] {
  const out = [...items];
  let state = s >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let cases: BenchmarkCase[] = loadCases();
if (args.category) cases = cases.filter((c) => c.category === args.category);
if (sample) cases = seededShuffle(cases, seed).slice(0, sample);
if (limit) cases = cases.slice(0, limit);

if (cases.length === 0) {
  console.error('Nenhum cenário após os filtros.');
  process.exit(2);
}

async function main() {
  console.log(`Rodando ${cases.length} cenários contra a LLM real (concorrência ${concurrency})...`);
  const results: ScenarioEvaluationResult[] = new Array(cases.length);
  const usage = { promptTokens: 0, completionTokens: 0, latencies: [] as number[], repairs: 0, rejected: 0, model: '' };
  let cursor = 0;

  async function worker() {
    while (cursor < cases.length) {
      const index = cursor++;
      const c = cases[index];
      const predicted = await interpretVoiceCommandWithLLM(c.input, undefined, { mode: 'llm_required' });
      const meta = predicted.interpretation;
      usage.promptTokens += meta?.promptTokens ?? 0;
      usage.completionTokens += meta?.completionTokens ?? 0;
      if (meta?.latencyMs) usage.latencies.push(meta.latencyMs);
      if (meta?.repairAttempted) usage.repairs++;
      if (meta?.fallbackReason) usage.rejected++;
      if (meta?.model) usage.model = meta.model;
      results[index] = evaluateScenario(c, predicted);
      process.stdout.write(results[index].passed ? '.' : results[index].unsafeExecution ? '!' : 'x');
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('');

  const metrics = computeBenchmarkScore(results, cases);
  printReport(`BENCHMARK DA LLM REAL (${usage.model || 'modelo desconhecido'})`, metrics, results);

  const sorted = [...usage.latencies].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const cost = estimateCostUSD({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
  console.log(`\nLatência LLM: p50 ${p(0.5)}ms · p95 ${p(0.95)}ms`);
  console.log(`Tokens: ${usage.promptTokens} entrada / ${usage.completionTokens} saída · custo estimado US$ ${cost.toFixed(4)}`);
  console.log(`Reparos de schema: ${usage.repairs} · provedor indisponível: ${usage.rejected}`);

  const out = typeof args.out === 'string'
    ? args.out
    : path.resolve(__dirname, 'reports', `llm-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ model: usage.model, filters: args, metrics, usage: { ...usage, latencies: undefined, p50: p(0.5), p95: p(0.95), costUSD: cost }, results }, null, 2));
  console.log(`Relatório salvo em ${out}`);

  if (metrics.unsafeExecutionRate > 0) {
    console.error('\x1b[31m%s\x1b[0m', '\nREPROVADO: Unsafe Execution Rate > 0%.');
    process.exit(1);
  }
  if (metrics.fullScenarioAccuracy < minAccuracy) {
    console.error('\x1b[31m%s\x1b[0m', `\nREPROVADO: Full Scenario Accuracy < ${minAccuracy}%.`);
    process.exit(1);
  }
  console.log('\x1b[32m%s\x1b[0m', '\n✓ Benchmark LLM aprovado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
