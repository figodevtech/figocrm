// src/app/api/voice/transcribe/route.ts
// Endpoint Seguro de Transcrição e Processamento de Áudio (STT) — Fase 28 & Fase G do FigoCRM
// Garante: autenticação prévia obrigatória, verificação de assinatura, limite de áudio e observabilidade de custos/latência.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { processVoiceCommand } from '@/lib/ai/orchestrator';

const ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mpeg',
  'audio/mp3',
];

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB (aprox 90-120 segundos)

export async function POST(request: Request) {
  const requestStartTime = Date.now();

  try {
    // 1. Validação Obrigatória de Autenticação ANTES de qualquer consumo de IA
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Acesso não autorizado. Você precisa estar autenticado para utilizar a voz.' },
        { status: 401 }
      );
    }

    // 2. Validação de Assinatura / Trial Ativo
    try {
      await assertWritePermission(user.id);
    } catch (subErr: unknown) {
      const msg = subErr instanceof Error ? subErr.message : 'Assinatura inativa ou expirada.';
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const autoProcess = formData.get('autoProcess') !== 'false';

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Nenhum arquivo de áudio foi enviado no formulário (campo: "audio").' },
        { status: 400 }
      );
    }

    // 3. Validação de Tamanho
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'O áudio enviado excede o limite máximo permitido de 15MB.' },
        { status: 413 }
      );
    }

    // 4. Validação de Formato MIME
    const mimeType = audioFile.type.toLowerCase().split(';')[0];
    const isAllowed = ALLOWED_MIME_TYPES.some((allowed) => allowed.startsWith(mimeType));

    if (!isAllowed && mimeType !== 'application/octet-stream') {
      return NextResponse.json(
        { error: `Formato de áudio '${audioFile.type}' não suportado. Formatos aceitos: webm, m4a, mp4, wav, ogg, mp3.` },
        { status: 415 }
      );
    }

    // 5. Transcrição (Whisper OpenAI ou Google Gemini STT)
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let transcribedText = '';
    let sttProvider = 'none';
    const sttStartTime = Date.now();

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (openaiApiKey) {
      sttProvider = 'openai_whisper';
      const whisperFormData = new FormData();
      const blob = new Blob([buffer], { type: audioFile.type || 'audio/webm' });
      whisperFormData.append('file', blob, audioFile.name || 'recording.webm');
      whisperFormData.append('model', 'whisper-1');
      whisperFormData.append('language', 'pt');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: whisperFormData,
      });

      if (response.ok) {
        const data = await response.json();
        transcribedText = data.text || '';
      } else {
        console.error('Falha na API Whisper:', await response.text());
      }
    } else if (geminiApiKey) {
      sttProvider = 'gemini_stt';
      try {
        const base64Audio = buffer.toString('base64');
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: 'Transcreva com exatidão o áudio em português brasileiro. Retorne apenas o texto transcrito, sem introduções ou explicações.',
                    },
                    {
                      inlineData: {
                        mimeType: audioFile.type || 'audio/webm',
                        data: base64Audio,
                      },
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          transcribedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
      } catch (geminiErr) {
        console.error('Falha no Gemini STT:', geminiErr);
      }
    }

    const sttLatencyMs = Date.now() - sttStartTime;

    // Fallback de desenvolvimento local
    if (!transcribedText) {
      const fallbackText = formData.get('fallbackText') as string | null;
      if (fallbackText) {
        transcribedText = fallbackText;
        sttProvider = 'client_fallback';
      } else {
        return NextResponse.json(
          {
            error: 'Serviço de transcrição requer OPENAI_API_KEY ou GEMINI_API_KEY configurada no ambiente.',
            transcriptionAvailable: false,
          },
          { status: 503 }
        );
      }
    }

    // 6. Processamento via Orquestrador se solicitado
    let processResult = null;
    let orchestratorLatencyMs = 0;

    if (autoProcess && transcribedText) {
      const orchStart = Date.now();
      processResult = await processVoiceCommand(transcribedText);
      orchestratorLatencyMs = Date.now() - orchStart;
    }

    const totalLatencyMs = Date.now() - requestStartTime;

    // Observabilidade Segura (sem chaves de API nem persistência de áudio bruto)
    console.log(`[STT Observability] user=${user.id} provider=${sttProvider} size=${audioFile.size}B sttLatency=${sttLatencyMs}ms orchLatency=${orchestratorLatencyMs}ms total=${totalLatencyMs}ms`);

    return NextResponse.json({
      success: true,
      transcribedText,
      processResult,
      metrics: {
        provider: sttProvider,
        audioSizeBytes: audioFile.size,
        sttLatencyMs,
        totalLatencyMs,
      },
    });
  } catch (error) {
    console.error('Erro na transcrição de áudio:', error);
    return NextResponse.json(
      { error: 'Falha interna ao processar áudio.' },
      { status: 500 }
    );
  }
}
