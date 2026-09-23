// src/app/api/voice/process/route.ts
// Endpoint da API para Processamento de Voz e Comandos de IA (Fase 8, 9, 10, 11)

import { NextResponse } from 'next/server';
import { processVoiceCommand } from '@/lib/ai/orchestrator';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { spokenText } = body;

    if (!spokenText || typeof spokenText !== 'string' || spokenText.trim().length === 0) {
      return NextResponse.json(
        { error: 'Texto falado não informado.' },
        { status: 400 }
      );
    }

    const result = await processVoiceCommand(spokenText);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Erro na API de voz:', error);
    return NextResponse.json(
      { error: 'Falha interna ao processar áudio.' },
      { status: 500 }
    );
  }
}
