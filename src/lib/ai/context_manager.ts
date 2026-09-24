// src/lib/ai/context_manager.ts
// Contexto conversacional persistente — Fase E do hardening.
// Fonte de verdade: tabela conversation_context (TTL de 30 minutos). Sem cache em memória:
// na Vercel cada requisição pode cair numa instância diferente e um cache local serviria contexto velho.
// Referências são guardadas com o ID real da entidade resolvida; o nome serve apenas para exibição
// e para resolver pronomes no texto.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityCandidate } from '@/lib/domain/entity-resolver';

export interface EntityReference {
  id?: string;
  name: string;
  phone?: string;
  type?: 'customer' | 'item' | 'deal' | 'receivable' | 'installment';
}

export type PendingKind = 'entity_choice' | 'missing_info' | 'confirm_execution';

export interface PendingConfirmation {
  kind: PendingKind;
  originalTranscript: string;
  promptAsked: string;
  /** Comando interpretado que aguarda a resposta (InterpretedVoiceCommand serializado). */
  draft?: Record<string, unknown>;
  /** Campo que a resposta preenche: 'customer' | 'item' | 'debt' | 'installment' | campo numérico do draft. */
  field?: string;
  candidates?: EntityCandidate[];
  timestamp: number;
}

export interface ConversationContext {
  userId: string;
  lastCustomer?: EntityReference;
  lastItem?: EntityReference;
  lastDealId?: string;
  lastReceivableId?: string;
  pendingConfirmation?: PendingConfirmation;
  /** Tela em que o usuário está ("cliente Carlos"); transitório, nunca persistido. */
  screenLabel?: string;
  /** Cliente da tela atual (conferido contra o usuário); transitório. */
  screenCustomerId?: string;
  expiresAt: number;
}

/** null limpa o campo; undefined mantém o valor atual. */
export type ContextPatch = {
  [K in 'lastCustomer' | 'lastItem' | 'lastDealId' | 'lastReceivableId' | 'pendingConfirmation']?: ConversationContext[K] | null;
};

export const CONTEXT_TTL_MS = 30 * 60 * 1000;

export function emptyContext(userId: string): ConversationContext {
  return { userId, expiresAt: Date.now() + CONTEXT_TTL_MS };
}

export async function loadVoiceContext(supabase: SupabaseClient, userId: string): Promise<ConversationContext> {
  const { data, error } = await supabase
    .from('conversation_context')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[context] falha ao carregar contexto:', error.message);
    return emptyContext(userId);
  }
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) {
    return emptyContext(userId);
  }

  return {
    userId,
    lastCustomer: data.last_customer_name
      ? { id: data.last_customer_id || undefined, name: data.last_customer_name, type: 'customer' }
      : undefined,
    lastItem: data.last_item_name
      ? { id: data.last_item_id || undefined, name: data.last_item_name, type: 'item' }
      : undefined,
    lastDealId: data.last_deal_id || undefined,
    lastReceivableId: data.last_receivable_id || undefined,
    pendingConfirmation: (data.pending_confirmation as PendingConfirmation | null) || undefined,
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

export function applyContextPatch(current: ConversationContext, patch: ContextPatch): ConversationContext {
  const next: ConversationContext = { ...current, expiresAt: Date.now() + CONTEXT_TTL_MS };
  for (const [key, value] of Object.entries(patch) as Array<[keyof ContextPatch, unknown]>) {
    if (value === undefined) continue;
    (next as unknown as Record<string, unknown>)[key] = value === null ? undefined : value;
  }
  return next;
}

export async function saveVoiceContext(
  supabase: SupabaseClient,
  current: ConversationContext,
  patch: ContextPatch
): Promise<ConversationContext> {
  const updated = applyContextPatch(current, patch);

  const { error } = await supabase.from('conversation_context').upsert({
    user_id: updated.userId,
    last_customer_id: updated.lastCustomer?.id || null,
    last_customer_name: updated.lastCustomer?.name || null,
    last_item_id: updated.lastItem?.id || null,
    last_item_name: updated.lastItem?.name || null,
    last_deal_id: updated.lastDealId || null,
    last_receivable_id: updated.lastReceivableId || null,
    pending_question: updated.pendingConfirmation?.promptAsked || null,
    pending_command: updated.pendingConfirmation?.draft || null,
    pending_confirmation: updated.pendingConfirmation || null,
    expires_at: new Date(updated.expiresAt).toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn('[context] falha ao persistir contexto:', error.message);
  }
  return updated;
}

/**
 * Resolve referências anafóricas ("ele", "dele", "aquela moto") usando o contexto.
 * Usado pelo parser determinístico; a LLM recebe o contexto explicitamente no prompt.
 */
export function resolvePronounsAndAnaphora(
  text: string,
  context: ConversationContext
): {
  resolvedText: string;
  resolvedCustomer?: EntityReference;
  resolvedItem?: EntityReference;
} {
  let resolvedText = text;
  const t = text.toLowerCase();

  if (/\b(ele|dele|pra ele|com ele)\b/i.test(t) && context.lastCustomer) {
    resolvedText = resolvedText.replace(/\b(ele|dele|pra ele|com ele)\b/gi, context.lastCustomer.name);
  }

  if (/\b(aquela moto|aquele carro|aquele veiculo|o veiculo|o aparelho|aquela)\b/i.test(t) && context.lastItem) {
    resolvedText = resolvedText.replace(/\b(aquela moto|aquele carro|aquele veiculo|o veiculo|o aparelho|aquela)\b/gi, context.lastItem.name);
  }

  return {
    resolvedText,
    resolvedCustomer: context.lastCustomer,
    resolvedItem: context.lastItem,
  };
}
