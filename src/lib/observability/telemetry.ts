// src/lib/observability/telemetry.ts
// Observabilidade e custo de IA — Fase K do hardening.
// Registro estruturado na tabela ai_telemetry via RPC record_ai_telemetry (RLS sem policies:
// só o backend grava, sempre em nome de auth.uid()). Nunca registra áudio, transcrição ou chaves.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

// Preços de referência (USD). Estimativa operacional — conferir tabela vigente dos provedores.
const COST_PER_AUDIO_MINUTE_USD = 0.006; // whisper-1
const LLM_PRICES_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
};
const DEFAULT_LLM_PRICE = { input: 0.15, output: 0.6 };

// Guarda de uso mensal para manter sustentabilidade do plano Pro.
export const MONTHLY_AUDIO_SECONDS_QUOTA = 3600;
export const MONTHLY_OPERATIONS_QUOTA = 1500;

export function estimateCostUSD(input: {
  audioSeconds?: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}): number {
  // LLM_PRICE_INPUT_PER_1M / LLM_PRICE_OUTPUT_PER_1M sobrescrevem a tabela (ex.: modelo sem preço cadastrado)
  const envInput = Number(process.env.LLM_PRICE_INPUT_PER_1M);
  const envOutput = Number(process.env.LLM_PRICE_OUTPUT_PER_1M);
  const price =
    envInput > 0 && envOutput > 0
      ? { input: envInput, output: envOutput }
      : (input.model && LLM_PRICES_PER_1M[input.model]) || DEFAULT_LLM_PRICE;
  const audio = ((input.audioSeconds ?? 0) / 60) * COST_PER_AUDIO_MINUTE_USD;
  const tokens =
    ((input.promptTokens ?? 0) / 1_000_000) * price.input + ((input.completionTokens ?? 0) / 1_000_000) * price.output;
  return Math.round((audio + tokens) * 1_000_000) / 1_000_000;
}

/**
 * Calcula o custo estimado de uma requisição de voz e LLM
 */
export function calculateOperationCost(durationSeconds: number, promptTokens: number, completionTokens: number): LLMUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUSD: estimateCostUSD({ audioSeconds: durationSeconds, promptTokens, completionTokens }),
  };
}

/**
 * Verifica se o usuário excedeu a cota mensal preventiva
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

export interface AiTelemetryEvent {
  endpoint: 'voice/transcribe' | 'voice/process';
  inputType: 'audio' | 'text';
  sttProvider?: string;
  llmProvider?: string;
  llmModel?: string;
  interpretationSource?: string;
  intent?: string;
  executionStatus?: string;
  sttLatencyMs?: number;
  llmLatencyMs?: number;
  executionLatencyMs?: number;
  totalLatencyMs?: number;
  audioSizeBytes?: number;
  audioDurationSeconds?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  success: boolean;
  errorType?: string;
}

/** Registra o evento; falhas de telemetria nunca derrubam a requisição. */
export async function recordAiTelemetry(supabase: SupabaseClient, event: AiTelemetryEvent): Promise<void> {
  const payload = {
    endpoint: event.endpoint,
    input_type: event.inputType,
    stt_provider: event.sttProvider,
    llm_provider: event.llmProvider,
    llm_model: event.llmModel,
    interpretation_source: event.interpretationSource,
    intent: event.intent,
    execution_status: event.executionStatus,
    stt_latency_ms: event.sttLatencyMs,
    llm_latency_ms: event.llmLatencyMs,
    execution_latency_ms: event.executionLatencyMs,
    total_latency_ms: event.totalLatencyMs,
    audio_size_bytes: event.audioSizeBytes,
    audio_duration_seconds: event.audioDurationSeconds,
    prompt_tokens: event.promptTokens,
    completion_tokens: event.completionTokens,
    estimated_cost_usd: event.estimatedCostUsd,
    success: event.success,
    error_type: event.errorType,
  };

  try {
    const { error } = await supabase.rpc('record_ai_telemetry', { p_payload: payload });
    if (error) console.warn('[telemetry] falha ao registrar:', error.message);
  } catch (err) {
    console.warn('[telemetry] falha ao registrar:', err);
  }
  // Linha estruturada para os logs da Vercel (sem conteúdo do usuário)
  console.log(JSON.stringify({ type: 'ai_telemetry', ...payload }));
}
