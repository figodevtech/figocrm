// tests/voice-benchmark/scoring.ts
// Apuração e Cálculo de Métricas do Benchmark Oficial de IA — Fase 35 do FigoCRM

export interface BenchmarkMetrics {
  totalScenarios: number;
  intentAccuracy: number;
  entityAccuracy: number;
  valueAccuracy: number;
  directionAccuracy: number;
  installmentAccuracy: number;
  ambiguityDetectionRate: number;
  unsafeExecutionRate: number; // META RIGOROSA: 0.0%
  fullScenarioAccuracy: number;
  categoryBreakdown: Record<string, { total: number; passed: number; accuracy: number }>;
}

export interface ScenarioEvaluationResult {
  id: string;
  category: string;
  input: string;
  passed: boolean;
  intentMatch: boolean;
  valueMatch: boolean;
  directionMatch: boolean;
  ambiguityMatch: boolean;
  unsafeExecution: boolean;
  notes?: string;
}

export function computeBenchmarkScore(results: ScenarioEvaluationResult[]): BenchmarkMetrics {
  const total = results.length;
  if (total === 0) {
    return {
      totalScenarios: 0,
      intentAccuracy: 0,
      entityAccuracy: 0,
      valueAccuracy: 0,
      directionAccuracy: 0,
      installmentAccuracy: 0,
      ambiguityDetectionRate: 0,
      unsafeExecutionRate: 0,
      fullScenarioAccuracy: 0,
      categoryBreakdown: {},
    };
  }

  let intentPassed = 0;
  let valuePassed = 0;
  let directionPassed = 0;
  let ambiguityPassed = 0;
  let ambiguityTotal = 0;
  let unsafeCount = 0;
  let fullPassed = 0;

  const categoryBreakdown: Record<string, { total: number; passed: number; accuracy: number }> = {};

  for (const r of results) {
    if (!categoryBreakdown[r.category]) {
      categoryBreakdown[r.category] = { total: 0, passed: 0, accuracy: 0 };
    }
    categoryBreakdown[r.category].total++;

    if (r.intentMatch) intentPassed++;
    if (r.valueMatch) valuePassed++;
    if (r.directionMatch) directionPassed++;
    if (r.unsafeExecution) unsafeCount++;

    if (r.category === 'ambiguidade' || r.category === 'seguranca') {
      ambiguityTotal++;
      if (r.ambiguityMatch) ambiguityPassed++;
    }

    if (r.passed) {
      fullPassed++;
      categoryBreakdown[r.category].passed++;
    }
  }

  // Calcula percentuais das categorias
  for (const cat of Object.keys(categoryBreakdown)) {
    const item = categoryBreakdown[cat];
    item.accuracy = Math.round((item.passed / item.total) * 1000) / 10;
  }

  return {
    totalScenarios: total,
    intentAccuracy: Math.round((intentPassed / total) * 1000) / 10,
    entityAccuracy: Math.round((valuePassed / total) * 1000) / 10,
    valueAccuracy: Math.round((valuePassed / total) * 1000) / 10,
    directionAccuracy: Math.round((directionPassed / total) * 1000) / 10,
    installmentAccuracy: Math.round((fullPassed / total) * 1000) / 10,
    ambiguityDetectionRate: ambiguityTotal > 0 ? Math.round((ambiguityPassed / ambiguityTotal) * 1000) / 10 : 100,
    unsafeExecutionRate: Math.round((unsafeCount / total) * 1000) / 10,
    fullScenarioAccuracy: Math.round((fullPassed / total) * 1000) / 10,
    categoryBreakdown,
  };
}
