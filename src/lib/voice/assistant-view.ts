// src/lib/voice/assistant-view.ts
// Tradução pura do contrato AssistantResponse para o que a tela mostra. O front decide só por `status`
// e nunca exibe termos técnicos (STT, LLM, RPC...).

import type { AssistantResponse } from '@/lib/api/assistant-response';

export type VoicePhase = 'idle' | 'recording' | 'uploading' | 'transcribing' | 'understanding' | 'executing' | 'done' | 'error';

export const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Toque e fale',
  recording: 'Ouvindo...',
  uploading: 'Enviando...',
  transcribing: 'Entendendo...',
  understanding: 'Entendendo...',
  executing: 'Registrando...',
  done: 'Pronto',
  error: 'Não deu certo',
};

export function isBusyPhase(phase: VoicePhase): boolean {
  return phase === 'uploading' || phase === 'transcribing' || phase === 'understanding' || phase === 'executing';
}

export interface AssistantChoice {
  label: string;
  /** Texto enviado como se fosse falado ao tocar no botão. */
  say: string;
  detail?: string;
}

export interface AssistantView {
  tone: 'success' | 'info' | 'question' | 'error';
  title: string;
  message: string;
  undoOperationId?: string;
  choices: AssistantChoice[];
  retry: boolean;
  subscriptionCta: boolean;
  /** Espera resposta do usuário (pergunta pendente). */
  awaitingAnswer: boolean;
  /** A tela deve recarregar os dados (algo foi gravado). */
  refresh: boolean;
}

const stripPronto = (message: string) => message.replace(/^Pronto[.!]\s*/i, '').trim() || message;

export function assistantView(res: AssistantResponse | null | undefined): AssistantView {
  if (!res || typeof res !== 'object' || !('status' in res)) {
    return {
      tone: 'error',
      title: 'Não deu certo',
      message: 'Não consegui falar com o assistente. Tenta de novo.',
      choices: [],
      retry: true,
      subscriptionCta: false,
      awaitingAnswer: false,
      refresh: false,
    };
  }

  switch (res.status) {
    case 'executed':
      return {
        tone: 'success',
        title: 'Pronto',
        message: stripPronto(res.message),
        undoOperationId: res.undoAvailable && res.operationId ? res.operationId : undefined,
        choices: [],
        retry: false,
        subscriptionCta: false,
        awaitingAnswer: false,
        refresh: true,
      };
    case 'answered':
      return { tone: 'info', title: 'Resposta', message: res.message, choices: [], retry: false, subscriptionCta: false, awaitingAnswer: false, refresh: false };
    case 'needs_input': {
      const confirmation = res.field === 'confirmation';
      const choices: AssistantChoice[] = confirmation
        ? [
            { label: 'Sim, pode lançar', say: 'sim' },
            { label: 'Não', say: 'não' },
          ]
        : (res.candidates ?? []).map((c) => ({ label: c.label, say: c.label, detail: c.detail }));
      return {
        tone: 'question',
        title: confirmation ? 'Confere?' : 'Preciso saber',
        message: res.message,
        choices,
        retry: false,
        subscriptionCta: false,
        awaitingAnswer: true,
        refresh: false,
      };
    }
    case 'error':
      return {
        tone: 'error',
        title: res.code === 'subscription_required' ? 'Teste encerrado' : 'Não deu certo',
        message: res.message,
        choices: [],
        retry: res.retryable,
        subscriptionCta: res.code === 'subscription_required',
        awaitingAnswer: false,
        refresh: false,
      };
    default:
      return assistantView(null);
  }
}
