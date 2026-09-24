// src/lib/voice/request-guard.ts
// Guarda comum dos endpoints de voz: autenticação → cota mensal e rate limit no banco,
// antes de qualquer consumo de STT/LLM. Trial vencido usa a cota Free.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { consumeVoiceRateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { errorResponse } from '@/lib/api/assistant-response';
import { trackProductEvent } from '@/lib/analytics/events';

export type VoiceGuardResult =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: NextResponse };

export async function guardVoiceRequest(): Promise<VoiceGuardResult> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'unauthenticated', assistant: errorResponse('unauthenticated', 'Você precisa entrar na sua conta.') },
        { status: 401 }
      ),
    };
  }

  const decision = await consumeVoiceRateLimit(supabase, 'voice');
  if (!decision.allowed) {
    if (decision.reason === 'monthly_limit') await trackProductEvent(user.id, 'voice_monthly_limit_reached', { plan: decision.effectivePlan });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: decision.unavailable ? 'rate_limiter_unavailable' : decision.reason === 'monthly_limit' ? 'voice_monthly_limit' : 'rate_limited',
          assistant: errorResponse(
            decision.unavailable ? 'internal'
              : decision.reason === 'monthly_limit'
                ? decision.effectivePlan === 'free' ? 'plan_voice_limit' : 'voice_monthly_limit'
                : 'rate_limited',
            decision.unavailable
              ? 'A voz está indisponível agora. Tenta de novo em instantes.'
              : decision.reason === 'monthly_limit'
                ? decision.effectivePlan === 'free'
                  ? 'Você usou os comandos de voz deste mês no plano grátis. Pode continuar usando o CRM manualmente ou liberar mais voz com o Pro.'
                  : 'Você usou os comandos de voz deste mês. Pode continuar usando o CRM manualmente.'
                : 'Muitos comandos seguidos. Espera um pouquinho e fala de novo.'
          ),
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        { status: decision.unavailable ? 503 : 429, headers: rateLimitHeaders(decision) }
      ),
    };
  }

  return { ok: true, supabase, user };
}
