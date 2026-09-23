// src/app/api/voice/transcribe/route.ts
// Endpoint de Transcrição e Processamento de Áudio Real (Speech-to-Text) — Fase 28
// Recebe multipart/form-data com blob de áudio, valida formato/tamanho, transcreve em pt-BR e descarta o áudio.

import { NextResponse } from 'next/server';
import { processVoiceCommand } from '@/lib/ai/orchestrator';

// Formatos de áudio permitidos
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

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB (aprox 90-120 segundos de áudio comprimido)

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const autoProcess = formData.get('autoProcess') !== 'false'; // default: processa diretamente pelo orquestrador

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Nenhum arquivo de áudio foi enviado no formulário (campo: "audio").' },
        { status: 400 }
      );
    }

    // 1. Validação de Tamanho
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'O áudio enviado excede o limite máximo permitido de 15MB (máximo de 90 segundos).' },
        { status: 413 }
      );
    }

    // 2. Validação de Formato MIME
    const mimeType = audioFile.type.toLowerCase().split(';')[0];
    const isAllowed = ALLOWED_MIME_TYPES.some((allowed) => allowed.startsWith(mimeType));

    if (!isAllowed && mimeType !== 'application/octet-stream') {
      return NextResponse.json(
        { error: `Formato de áudio '${audioFile.type}' não suportado. Formatos aceitos: webm, m4a, mp4, wav, ogg, mp3.` },
        { status: 415 }
      );
    }

    // 3. Transcrição (Whisper / OpenAI ou Google Gemini STT)
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let transcribedText = '';

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (openaiApiKey) {
      // Chamada para OpenAI Whisper API
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
      // Suporte a Gemini STT se configurado
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

    // Se nenhuma chave de provedor estiver configurada ou se falhar na chamada externa,
    // verifica se o cliente enviou um texto simulado/fallback ou sinaliza que chaves são necessárias
    if (!transcribedText) {
      const fallbackText = formData.get('fallbackText') as string | null;
      if (fallbackText) {
        transcribedText = fallbackText;
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

    // 4. Se autoProcess estiver ativo, encaminha diretamente para o orquestrador seguro
    let processResult = null;
    if (autoProcess && transcribedText) {
      processResult = await processVoiceCommand(transcribedText);
    }

    // O áudio é mantido apenas em memória e descartado após a resposta (não é persistido)
    return NextResponse.json({
      success: true,
      transcribedText,
      processResult,
    });
  } catch (error) {
    console.error('Erro na transcrição de áudio:', error);
    return NextResponse.json(
      { error: 'Falha interna ao processar áudio.' },
      { status: 500 }
    );
  }
}
