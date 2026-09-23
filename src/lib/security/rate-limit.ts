// src/lib/security/rate-limit.ts
// Rate limit distribuído por usuário (minuto e hora) — Fase L do hardening.
// Contadores no PostgreSQL (RPC consume_voice_rate_limit), compartilhados por todas as instâncias
// da Vercel. Falha fechada: se o limitador estiver indisponível, a requisição é recusada (503),
// para não liberar consumo de STT/LLM sem controle.
//
// Configuração (env): VOICE_RATE_LIMIT_PER_MINUTE (padrão 10), VOICE_RATE_LIMIT_PER_HOUR (padrão 120)

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RateLimitDecision {
  allowed: boolean;
  unavailable?: boolean;
  retryAfterSeconds: number;
  minuteHits?: number;
  hourHits?: number;
  limitPerMinute: number;
  limitPerHour: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function voiceRateLimitConfig() {
  return {
    perMinute: positiveInt(process.env.VOICE_RATE_LIMIT_PER_MINUTE, 10),
    perHour: positiveInt(process.env.VOICE_RATE_LIMIT_PER_HOUR, 120),
  };
}

export async function consumeVoiceRateLimit(supabase: SupabaseClient, bucket: 'voice'): Promise<RateLimitDecision> {
  const { perMinute, perHour } = voiceRateLimitConfig();
  const { data, error } = await supabase.rpc('consume_voice_rate_limit', {
    p_bucket: bucket,
    p_limit_per_minute: perMinute,
    p_limit_per_hour: perHour,
  });

  if (error || !data) {
    console.error('[rate-limit] limitador indisponível:', error?.message);
    return { allowed: false, unavailable: true, retryAfterSeconds: 30, limitPerMinute: perMinute, limitPerHour: perHour };
  }

  const res = data as { allowed: boolean; retry_after_seconds: number; minute_hits: number; hour_hits: number };
  return {
    allowed: res.allowed,
    retryAfterSeconds: res.retry_after_seconds,
    minuteHits: res.minute_hits,
    hourHits: res.hour_hits,
    limitPerMinute: perMinute,
    limitPerHour: perHour,
  };
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit-Minute': String(decision.limitPerMinute),
    'X-RateLimit-Limit-Hour': String(decision.limitPerHour),
  };
  if (!decision.allowed) headers['Retry-After'] = String(Math.max(1, decision.retryAfterSeconds));
  return headers;
}
