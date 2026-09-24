// src/lib/api/assistant-response.ts
// Contrato estável entre o backend de voz e o front. O front decide a UI só por `status`;
// `message` já vem pronta para mostrar/falar. Erros técnicos nunca aparecem aqui (ficam em log/telemetria).

export interface Candidate {
  id: string;
  label: string;
  detail?: string;
}

export type OperationType = 'deal' | 'loan' | 'payment' | 'adjustment' | 'reversal' | 'renegotiation' | 'reschedule';

export type AssistantErrorCode =
  | 'subscription_required'
  | 'plan_customer_limit'
  | 'plan_voice_limit'
  | 'voice_monthly_limit'
  | 'unauthenticated'
  | 'rate_limited'
  | 'not_found'
  | 'validation'
  | 'provider_unavailable'
  | 'internal';

export type AssistantResponse =
  | {
      status: 'executed';
      message: string;
      /** Há um "desfazer" disponível para esta operação (POST /api/operations/reverse). */
      undoAvailable: boolean;
      operationId?: string;
      operationType?: OperationType;
      dealId?: string;
    }
  | { status: 'answered'; message: string }
  | { status: 'needs_input'; message: string; field?: string; candidates?: Candidate[] }
  | { status: 'error'; message: string; retryable: boolean; code: AssistantErrorCode };

export const RETRYABLE_CODES: ReadonlySet<AssistantErrorCode> = new Set(['rate_limited', 'provider_unavailable', 'internal']);

export function errorResponse(code: AssistantErrorCode, message: string): AssistantResponse {
  return { status: 'error', code, message, retryable: RETRYABLE_CODES.has(code) };
}
