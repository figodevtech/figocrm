// src/lib/voice/request-guard.ts
// Guarda comum dos endpoints de voz: autenticação → assinatura → rate limit distribuído,
// tudo ANTES de qualquer consumo de STT/LLM.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { consumeVoiceRateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';

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
        { error: 'Acesso não autorizado. Você precisa estar autenticado para utilizar a voz.' },
        { status: 401 }
      ),
    };
  }

  try {
    await assertWritePermission(user.id, supabase);
  } catch (subErr: unknown) {
    const msg = subErr instanceof Error ? subErr.message : 'Assinatura inativa ou expirada.';
    return { ok: false, response: NextResponse.json({ error: msg }, { status: 403 }) };
  }

  const decision = await consumeVoiceRateLimit(supabase, 'voice');
  if (!decision.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: decision.unavailable
            ? 'Serviço de voz temporariamente indisponível. Tente novamente em instantes.'
            : 'Muitos comandos de voz em sequência. Aguarde um pouco e tente de novo.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        { status: decision.unavailable ? 503 : 429, headers: rateLimitHeaders(decision) }
      ),
    };
  }

  return { ok: true, supabase, user };
}
