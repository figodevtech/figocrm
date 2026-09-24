// src/app/api/voice/process/route.ts
// Processamento de comando de voz já transcrito (texto).
// Autenticação, assinatura e rate limit antes de qualquer chamada de LLM.

import { NextResponse } from 'next/server';
import { runVoicePipeline, toHttpPayload } from '@/lib/ai/orchestrator';
import { errorResponse } from '@/lib/api/assistant-response';
import { guardVoiceRequest } from '@/lib/voice/request-guard';
import { estimateCostUSD, recordAiTelemetry } from '@/lib/observability/telemetry';
import { parseScreenContext } from '@/lib/ai/screen-context';

const MAX_TEXT_LENGTH = 2000;

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const guard = await guardVoiceRequest();
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => null);
    const spokenText = body?.spokenText;

    if (!spokenText || typeof spokenText !== 'string' || spokenText.trim().length === 0) {
      return NextResponse.json({ assistant: errorResponse('validation', 'Não ouvi nada. Pode falar de novo?') }, { status: 400 });
    }
    if (spokenText.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ assistant: errorResponse('validation', 'Ficou muito longo. Fala uma operação por vez.') }, { status: 413 });
    }

    const result = await runVoicePipeline(spokenText.trim(), {
      supabase: guard.supabase,
      userId: guard.user.id,
      screen: parseScreenContext(body?.context),
    });

    await recordAiTelemetry(guard.supabase, {
      endpoint: 'voice/process',
      inputType: 'text',
      llmProvider: result.metrics.provider,
      llmModel: result.metrics.model,
      interpretationSource: result.metrics.interpretationSource,
      intent: result.intent,
      executionStatus: result.executionStatus,
      llmLatencyMs: result.metrics.llmLatencyMs,
      executionLatencyMs: result.metrics.executionLatencyMs,
      totalLatencyMs: Date.now() - start,
      promptTokens: result.metrics.promptTokens,
      completionTokens: result.metrics.completionTokens,
      estimatedCostUsd: estimateCostUSD({
        model: result.metrics.model,
        promptTokens: result.metrics.promptTokens,
        completionTokens: result.metrics.completionTokens,
      }),
      success: result.executionStatus !== 'error',
      errorType: result.errorType,
    });

    if (result.error) console.warn('[voice/process]', result.errorType, result.error);
    return NextResponse.json(toHttpPayload(result));
  } catch (error) {
    console.error('Erro na API de voz:', error);
    return NextResponse.json({ assistant: errorResponse('internal', 'Deu um erro aqui e nada foi gravado. Tenta de novo?') }, { status: 500 });
  }
}
