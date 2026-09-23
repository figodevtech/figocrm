// src/lib/voice/request-guard.ts
// Guarda comum dos endpoints de voz: autenticação → rate limit distribuído, ANTES de qualquer
// consumo de STT/LLM. Assinatura não bloqueia aqui: conta com trial vencido ainda CONSULTA por voz;
// escrita é negada no orquestrador (mensagem amigável) e no banco (trigger fail-closed).

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { consumeVoiceRateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { errorResponse } from '@/lib/api/assistant-response';

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
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: decision.unavailable ? 'rate_limiter_unavailable' : 'rate_limited',
          assistant: errorResponse(
            decision.unavailable ? 'internal' : 'rate_limited',
            decision.unavailable
              ? 'A voz está indisponível agora. Tenta de novo em instantes.'
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
