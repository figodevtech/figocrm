// src/app/api/voice/transcribe/route.ts
// Endpoint de transcrição (STT) + processamento do comando.
// Ordem: autenticação → assinatura → rate limit → validação do áudio → STT → pipeline de voz
// → telemetria estruturada. Áudio bruto e chaves nunca são persistidos nem logados.

import { NextResponse } from 'next/server';
import { runVoicePipeline, VoiceProcessResult } from '@/lib/ai/orchestrator';
import { guardVoiceRequest } from '@/lib/voice/request-guard';
import { estimateCostUSD, recordAiTelemetry } from '@/lib/observability/telemetry';

const ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
];

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB (aprox 90-120 segundos)
const STT_TIMEOUT_MS = 30000;

interface SttResult {
  text: string;
  provider: string;
  durationSeconds?: number;
  errorType?: string;
}

async function transcribe(buffer: Buffer, mimeType: string, fileName: string): Promise<SttResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    if (process.env.OPENAI_API_KEY) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
      form.append('model', 'whisper-1');
      form.append('language', 'pt');
      form.append('response_format', 'verbose_json');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error('[stt] Whisper HTTP', response.status);
        return { text: '', provider: 'openai_whisper', errorType: `stt_http_${response.status}` };
      }
      const data = await response.json();
      return { text: (data.text || '').trim(), provider: 'openai_whisper', durationSeconds: data.duration };
    }

    if (process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: 'Transcreva com exatidão o áudio em português brasileiro. Retorne apenas o texto transcrito.' },
                { inlineData: { mimeType, data: buffer.toString('base64') } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error('[stt] Gemini HTTP', response.status);
        return { text: '', provider: 'gemini_stt', errorType: `stt_http_${response.status}` };
      }
      const data = await response.json();
      return { text: (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), provider: 'gemini_stt' };
    }

    return { text: '', provider: 'none', errorType: 'stt_not_configured' };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    console.error('[stt] falha:', timedOut ? 'timeout' : err);
    return { text: '', provider: 'unknown', errorType: timedOut ? 'stt_timeout' : 'stt_network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const requestStart = Date.now();

  try {
    // 1-3. Autenticação, assinatura e rate limit ANTES de qualquer consumo de IA
    const guard = await guardVoiceRequest();
    if (!guard.ok) return guard.response;
    const { supabase, user } = guard;

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const autoProcess = formData.get('autoProcess') !== 'false';

    if (!audioFile) {
      return NextResponse.json({ error: 'Nenhum arquivo de áudio foi enviado no formulário (campo: "audio").' }, { status: 400 });
    }
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'O áudio enviado excede o limite máximo permitido de 15MB.' }, { status: 413 });
    }

    const mimeType = (audioFile.type || 'audio/webm').toLowerCase().split(';')[0];
    if (!ALLOWED_MIME_TYPES.includes(mimeType) && mimeType !== 'application/octet-stream') {
      return NextResponse.json(
        { error: `Formato de áudio '${audioFile.type}' não suportado. Formatos aceitos: webm, m4a, mp4, wav, ogg, mp3.` },
        { status: 415 }
      );
    }

    // 4. Transcrição
    const sttStart = Date.now();
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    let stt = await transcribe(buffer, audioFile.type || 'audio/webm', audioFile.name || 'recording.webm');
    const sttLatencyMs = Date.now() - sttStart;

    if (!stt.text) {
      const fallbackText = formData.get('fallbackText');
      if (typeof fallbackText === 'string' && fallbackText.trim()) {
        stt = { ...stt, text: fallbackText.trim().slice(0, 2000), provider: 'client_fallback' };
      } else {
        await recordAiTelemetry(supabase, {
          endpoint: 'voice/transcribe',
          inputType: 'audio',
          sttProvider: stt.provider,
          sttLatencyMs,
          totalLatencyMs: Date.now() - requestStart,
          audioSizeBytes: audioFile.size,
          success: false,
          errorType: stt.errorType || 'stt_empty',
        });
        const notConfigured = stt.errorType === 'stt_not_configured';
        return NextResponse.json(
          {
            error: notConfigured
              ? 'Serviço de transcrição requer OPENAI_API_KEY ou GEMINI_API_KEY configurada no ambiente.'
              : 'Não consegui transcrever o áudio. Tente novamente.',
            transcriptionAvailable: false,
          },
          { status: notConfigured ? 503 : 502 }
        );
      }
    }

    // 5. Pipeline de voz
    let processResult: VoiceProcessResult | null = null;
    if (autoProcess) {
      processResult = await runVoicePipeline(stt.text, { supabase, userId: user.id });
    }

    const totalLatencyMs = Date.now() - requestStart;
    const metrics = processResult?.metrics;

    // 6. Telemetria estruturada (sem áudio, sem texto, sem chaves)
    await recordAiTelemetry(supabase, {
      endpoint: 'voice/transcribe',
      inputType: 'audio',
      sttProvider: stt.provider,
      llmProvider: metrics?.provider,
      llmModel: metrics?.model,
      interpretationSource: metrics?.interpretationSource,
      intent: processResult?.intent,
      executionStatus: processResult?.executionStatus,
      sttLatencyMs,
      llmLatencyMs: metrics?.llmLatencyMs,
      executionLatencyMs: metrics?.executionLatencyMs,
      totalLatencyMs,
      audioSizeBytes: audioFile.size,
      audioDurationSeconds: stt.durationSeconds,
      promptTokens: metrics?.promptTokens,
      completionTokens: metrics?.completionTokens,
      estimatedCostUsd: estimateCostUSD({
        audioSeconds: stt.durationSeconds,
        model: metrics?.model,
        promptTokens: metrics?.promptTokens,
        completionTokens: metrics?.completionTokens,
      }),
      success: !processResult || processResult.executionStatus !== 'error',
      errorType: processResult?.errorType,
    });

    return NextResponse.json({
      success: true,
      transcribedText: stt.text,
      processResult,
      metrics: {
        provider: stt.provider,
        audioSizeBytes: audioFile.size,
        sttLatencyMs,
        totalLatencyMs,
      },
    });
  } catch (error) {
    console.error('Erro na transcrição de áudio:', error);
    return NextResponse.json({ error: 'Falha interna ao processar áudio.' }, { status: 500 });
  }
}
