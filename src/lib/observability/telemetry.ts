// src/lib/observability/telemetry.ts
// Observabilidade, Telemetria e Gestão de Custos de IA (Fase 14)

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

export interface VoiceMetric {
  userId: string;
  durationSeconds: number;
  latencyMs: number;
  tokens: LLMUsage;
  status: 'success' | 'stt_error' | 'llm_error' | 'validation_error';
  timestamp: string;
}

// Tabela de preços de referência (ex: Whisper + Llama 3 / Gemini Flash)
const COST_PER_AUDIO_MINUTE_USD = 0.006; // ~$0.006/min
const COST_PER_1M_INPUT_TOKENS_USD = 0.15; // ~$0.15 / 1M tokens
const COST_PER_1M_OUTPUT_TOKENS_USD = 0.60; // ~$0.60 / 1M tokens

// Cota mensal máxima para manter sustentabilidade do plano de R$ 24,90/mês
export const MONTHLY_AUDIO_SECONDS_QUOTA = 3600; // 60 minutos de áudio falado por mês
export const MONTHLY_OPERATIONS_QUOTA = 1500; // 1.500 operações por mês

/**
 * Calcula o custo estimado de uma requisição de voz e LLM
 */
export function calculateOperationCost(durationSeconds: number, promptTokens: number, completionTokens: number): LLMUsage {
  const audioCost = (durationSeconds / 60) * COST_PER_AUDIO_MINUTE_USD;
  const tokenCost = (promptTokens / 1_000_000) * COST_PER_1M_INPUT_TOKENS_USD +
                    (completionTokens / 1_000_000) * COST_PER_1M_OUTPUT_TOKENS_USD;

  const totalCost = audioCost + tokenCost;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUSD: Math.round(totalCost * 100000) / 100000,
  };
}

/**
 * Verifica se o usuário excedeu o rate limit operacional preventivo
 */
export function checkUserUsageQuota(currentMonthSeconds: number, currentMonthOperations: number): {
  isWithinQuota: boolean;
  remainingSeconds: number;
  remainingOperations: number;
} {
  const remainingSeconds = Math.max(0, MONTHLY_AUDIO_SECONDS_QUOTA - currentMonthSeconds);
  const remainingOperations = Math.max(0, MONTHLY_OPERATIONS_QUOTA - currentMonthOperations);

  return {
    isWithinQuota: remainingSeconds > 0 && remainingOperations > 0,
    remainingSeconds,
    remainingOperations,
  };
}
