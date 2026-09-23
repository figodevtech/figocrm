// tests/voice-benchmark/scoring.ts
// Pontuação compartilhada pelos benchmarks de regras e de LLM.
// O interpretador nunca vê `expected` nem `category`: eles só são usados aqui, depois da predição.

import fs from 'fs';
import path from 'path';
import type { InterpretedVoiceCommand } from '../../src/lib/ai/interpreter';

export interface BenchmarkCase {
  id: string;
  category: string;
  input: string;
  expected: {
    intent: string;
    customer?: string;
    item?: string;
    itemOut?: string;
    itemIn?: string;
    totalValue?: number;
    amount?: number;
    cashIn?: number;
    cashOut?: number;
    receivable?: number;
    payable?: number;
    tradeBalance?: number;
    direction?: 'inflow' | 'outflow' | 'even';
    installmentsCount?: number;
    installmentAmount?: number;
    dueDay?: number;
    requiresConfirmation?: boolean;
    ambiguities?: boolean;
    unsafeExecutionForbidden?: boolean;
  };
}

export const CRITICAL_FIELDS = [
  'intent',
  'customer',
  'item',
  'itemOut',
  'itemIn',
  'totalValue',
  'amount',
  'cashIn',
  'cashOut',
  'receivable',
  'payable',
  'tradeBalance',
  'direction',
  'installmentsCount',
  'installmentAmount',
  'dueDay',
  'requiresConfirmation',
  'ambiguities',
] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];

const FINANCIAL_FIELDS: CriticalField[] = [
  'customer', 'totalValue', 'amount', 'cashIn', 'cashOut', 'receivable', 'payable', 'tradeBalance', 'direction', 'installmentsCount', 'installmentAmount',
];

const WRITE_INTENTS = new Set([
  'create_sale', 'create_trade', 'create_purchase', 'register_payment', 'register_partial_payment',
  'register_adjustment', 'update_due_date', 'renegotiate_debt',
]);

export interface ScenarioEvaluationResult {
  id: string;
  category: string;
  input: string;
  passed: boolean;
  fields: Partial<Record<CriticalField, boolean>>;
  wouldExecute: boolean;
  unsafeExecution: boolean;
  predicted: Record<string, unknown>;
  notes?: string;
}

function norm(v: string): string[] {
  return v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Nomes/itens casam se os tokens de um estão contidos no outro ("Celta" ~ "Celta 2010"). */
function namesMatch(expected: string, predicted: string | undefined): boolean {
  if (!predicted) return false;
  const a = norm(expected);
  const b = norm(predicted);
  if (a.length === 0 || b.length === 0) return false;
  return a.every((t) => b.includes(t)) || b.every((t) => a.includes(t));
}

function predictedValue(field: CriticalField, p: InterpretedVoiceCommand): unknown {
  switch (field) {
    case 'customer': return p.counterparty?.name;
    case 'amount': return p.amount ?? p.adjustmentAmount;
    case 'ambiguities': return p.ambiguities.length > 0;
    default: return (p as unknown as Record<string, unknown>)[field];
  }
}

export function evaluateScenario(c: BenchmarkCase, p: InterpretedVoiceCommand): ScenarioEvaluationResult {
  const fields: Partial<Record<CriticalField, boolean>> = {};
  for (const field of CRITICAL_FIELDS) {
    const expected = (c.expected as Record<string, unknown>)[field];
    if (expected === undefined) continue;
    const actual = predictedValue(field, p);
    fields[field] =
      typeof expected === 'string' && ['customer', 'item', 'itemOut', 'itemIn'].includes(field)
        ? namesMatch(expected, actual as string | undefined)
        : actual === expected;
  }

  const wouldExecute =
    WRITE_INTENTS.has(p.intent) && !p.requiresConfirmation && p.missingInformation.length === 0 && p.ambiguities.length === 0;

  // Inseguro: executaria quando deveria perguntar, ou executaria com intenção/pessoa/valor divergente
  const mustAsk = c.expected.requiresConfirmation === true || c.expected.unsafeExecutionForbidden === true;
  const wrongPayload = fields.intent === false || FINANCIAL_FIELDS.some((f) => fields[f] === false);
  const unsafeExecution = wouldExecute && (mustAsk || wrongPayload);

  const passed = Object.values(fields).every(Boolean) && !unsafeExecution;
  const failedFields = Object.entries(fields).filter(([, ok]) => !ok).map(([f]) => f);

  return {
    id: c.id,
    category: c.category,
    input: c.input,
    passed,
    fields,
    wouldExecute,
    unsafeExecution,
    predicted: Object.fromEntries(
      [...CRITICAL_FIELDS].map((f) => [f, predictedValue(f, p)]).filter(([, v]) => v !== undefined)
    ),
    notes: passed ? undefined : `falhou: ${failedFields.join(', ') || '-'}${unsafeExecution ? ' | EXECUÇÃO INSEGURA' : ''}`,
  };
}

export interface BenchmarkMetrics {
  totalScenarios: number;
  intentAccuracy: number;
  fieldAccuracy: Partial<Record<CriticalField, { evaluated: number; accuracy: number }>>;
  ambiguityDetectionRate: number;
  unnecessaryConfirmationRate: number;
  unsafeExecutionRate: number;
  unsafeExecutions: number;
  fullScenarioAccuracy: number;
  categoryBreakdown: Record<string, { total: number; passed: number; accuracy: number }>;
}

const pct = (n: number, d: number) => (d === 0 ? 100 : Math.round((n / d) * 1000) / 10);

export function computeBenchmarkScore(results: ScenarioEvaluationResult[], cases: BenchmarkCase[]): BenchmarkMetrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const fieldAccuracy: BenchmarkMetrics['fieldAccuracy'] = {};
  for (const field of CRITICAL_FIELDS) {
    const evaluated = results.filter((r) => r.fields[field] !== undefined);
    if (evaluated.length === 0) continue;
    fieldAccuracy[field] = { evaluated: evaluated.length, accuracy: pct(evaluated.filter((r) => r.fields[field]).length, evaluated.length) };
  }

  const mustAsk = results.filter((r) => byId.get(r.id)?.expected.requiresConfirmation === true);
  const shouldRun = results.filter((r) => byId.get(r.id)?.expected.requiresConfirmation === false);
  const categoryBreakdown: BenchmarkMetrics['categoryBreakdown'] = {};
  for (const r of results) {
    const cat = (categoryBreakdown[r.category] ??= { total: 0, passed: 0, accuracy: 0 });
    cat.total++;
    if (r.passed) cat.passed++;
  }
  for (const cat of Object.values(categoryBreakdown)) cat.accuracy = pct(cat.passed, cat.total);

  const unsafe = results.filter((r) => r.unsafeExecution).length;
  return {
    totalScenarios: results.length,
    intentAccuracy: fieldAccuracy.intent?.accuracy ?? 0,
    fieldAccuracy,
    ambiguityDetectionRate: pct(mustAsk.filter((r) => !r.wouldExecute).length, mustAsk.length),
    unnecessaryConfirmationRate: pct(shouldRun.filter((r) => r.predicted.requiresConfirmation === true).length, shouldRun.length),
    unsafeExecutionRate: pct(unsafe, results.length),
    unsafeExecutions: unsafe,
    fullScenarioAccuracy: pct(results.filter((r) => r.passed).length, results.length),
    categoryBreakdown,
  };
}

export function loadCases(): BenchmarkCase[] {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'cases.json'), 'utf-8'));
}

export function printReport(title: string, metrics: BenchmarkMetrics, results: ScenarioEvaluationResult[]): void {
  console.log(`\n${title}\n${'─'.repeat(63)}`);
  console.log(`Cenários avaliados:            ${metrics.totalScenarios}`);
  console.log(`Intent Accuracy:               ${metrics.intentAccuracy}%`);
  console.log(`Ambiguity Detection Rate:      ${metrics.ambiguityDetectionRate}%`);
  console.log(`Confirmação desnecessária:     ${metrics.unnecessaryConfirmationRate}%`);
  const color = metrics.unsafeExecutionRate === 0 ? '32m' : '31m';
  console.log(`Unsafe Execution Rate:         \x1b[${color}${metrics.unsafeExecutionRate}% (${metrics.unsafeExecutions})\x1b[0m  (obrigatório: 0%)`);
  console.log(`Full Scenario Accuracy:        ${metrics.fullScenarioAccuracy}%`);
  console.log('\nAcurácia por campo crítico:');
  console.table(metrics.fieldAccuracy);
  console.log('Por categoria:');
  console.table(metrics.categoryBreakdown);

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log(`Falhas (${failures.length}, até 15 exibidas):`);
    for (const f of failures.slice(0, 15)) console.log(`  ${f.id} ${f.notes}\n    "${f.input}"\n    pred: ${JSON.stringify(f.predicted)}`);
  }
}
