// src/lib/ai/context_manager.ts
// Gerenciador de Contexto Conversacional Persistente — Fase E do Hardening FigoCRM
// Armazena contexto no PostgreSQL (tabela conversation_context) com TTL de 30 minutos,
// persistindo referências anafóricas entre cold-starts e diferentes instâncias Vercel.

import { createClient } from '@/lib/supabase/server';

export interface EntityReference {
  id?: string;
  name: string;
  phone?: string;
  type?: 'customer' | 'item' | 'deal' | 'receivable' | 'installment';
}

export interface PendingQuestion {
  question: string;
  expectedField: string;
  draftCommand?: Record<string, unknown>;
  createdAt?: number;
}

export interface ConversationContext {
  userId: string;
  lastCustomer?: EntityReference;
  lastItem?: EntityReference;
  lastDealId?: string;
  lastReceivableId?: string;
  pendingQuestion?: PendingQuestion;
  pendingConfirmation?: {
    originalTranscript: string;
    draftIntent: Record<string, unknown>;
    promptAsked: string;
    timestamp: number;
  };
  expiresAt: number; // Timestamp em milissegundos
}

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutos

// Cache em memória para acesso rápido durante a mesma requisição ou testes locais
const memoryCache = new Map<string, ConversationContext>();

/**
 * Obtém o contexto conversacional ativo do usuário, buscando no Supabase e renovando o TTL.
 */
export async function getUserVoiceContext(userId: string): Promise<ConversationContext> {
  const now = Date.now();

  // Verifica cache em memória primeiro
  const cached = memoryCache.get(userId);
  if (cached && cached.expiresAt > now) {
    cached.expiresAt = now + CONTEXT_TTL_MS;
    return cached;
  }

  // Se for usuário anônimo ou de teste, retorna contexto temporário em memória
  if (!userId || userId === 'anonymous' || userId.startsWith('test_')) {
    const memContext: ConversationContext = {
      userId: userId || 'anonymous',
      expiresAt: now + CONTEXT_TTL_MS,
    };
    memoryCache.set(userId || 'anonymous', memContext);
    return memContext;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('conversation_context')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && data) {
      const expiresAt = new Date(data.expires_at).getTime();
      if (expiresAt > now) {
        const loadedContext: ConversationContext = {
          userId,
          lastCustomer: data.last_customer_name
            ? { id: data.last_customer_id || undefined, name: data.last_customer_name, type: 'customer' }
            : undefined,
          lastItem: data.last_item_name
            ? { id: data.last_item_id || undefined, name: data.last_item_name, type: 'item' }
            : undefined,
          lastDealId: data.last_deal_id || undefined,
          lastReceivableId: data.last_receivable_id || undefined,
          pendingQuestion: data.pending_question
            ? { question: data.pending_question, expectedField: 'response', draftCommand: data.pending_command || undefined }
            : undefined,
          pendingConfirmation: data.pending_confirmation || undefined,
          expiresAt: now + CONTEXT_TTL_MS,
        };

        // Renova o TTL no banco
        await supabase
          .from('conversation_context')
          .update({
            expires_at: new Date(now + CONTEXT_TTL_MS).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        memoryCache.set(userId, loadedContext);
        return loadedContext;
      }
    }
  } catch (err) {
    console.warn('Não foi possível carregar contexto do Supabase, usando memória:', err);
  }

  // Se não existir ou expirou, cria novo contexto
  const freshContext: ConversationContext = {
    userId,
    expiresAt: now + CONTEXT_TTL_MS,
  };
  memoryCache.set(userId, freshContext);
  return freshContext;
}

/**
 * Atualiza o contexto do usuário tanto no banco Supabase quanto no cache de memória.
 */
export async function updateUserVoiceContext(
  userId: string,
  updates: Partial<ConversationContext>
): Promise<ConversationContext> {
  const current = await getUserVoiceContext(userId);
  const now = Date.now();
  const expiresAt = now + CONTEXT_TTL_MS;

  const updated: ConversationContext = {
    ...current,
    ...updates,
    expiresAt,
  };
  memoryCache.set(userId, updated);

  if (userId && userId !== 'anonymous' && !userId.startsWith('test_')) {
    try {
      const supabase = await createClient();
      await supabase.from('conversation_context').upsert({
        user_id: userId,
        last_customer_id: updated.lastCustomer?.id || null,
        last_customer_name: updated.lastCustomer?.name || null,
        last_item_id: updated.lastItem?.id || null,
        last_item_name: updated.lastItem?.name || null,
        last_deal_id: updated.lastDealId || null,
        last_receivable_id: updated.lastReceivableId || null,
        pending_question: updated.pendingQuestion?.question || null,
        pending_command: updated.pendingQuestion?.draftCommand || null,
        pending_confirmation: updated.pendingConfirmation || null,
        expires_at: new Date(expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Erro ao persistir contexto conversacional no Supabase:', err);
    }
  }

  return updated;
}

/**
 * Limpa perguntas e confirmações pendentes
 */
export async function clearPendingConfirmation(userId: string): Promise<void> {
  await updateUserVoiceContext(userId, {
    pendingQuestion: undefined,
    pendingConfirmation: undefined,
  });
}

/**
 * Versão síncrona leve para ambientes sem I/O assíncrono (ex: benchmark determinístico)
 */
export function getSyncVoiceContext(userId: string): ConversationContext {
  const now = Date.now();
  const cached = memoryCache.get(userId);
  if (cached && cached.expiresAt > now) {
    cached.expiresAt = now + CONTEXT_TTL_MS;
    return cached;
  }
  const fresh: ConversationContext = {
    userId,
    expiresAt: now + CONTEXT_TTL_MS,
  };
  memoryCache.set(userId, fresh);
  return fresh;
}

export function updateSyncVoiceContext(
  userId: string,
  updates: Partial<ConversationContext>
): ConversationContext {
  const current = getSyncVoiceContext(userId);
  const updated: ConversationContext = {
    ...current,
    ...updates,
    expiresAt: Date.now() + CONTEXT_TTL_MS,
  };
  memoryCache.set(userId, updated);
  return updated;
}

/**
 * Resolve referências anafóricas e pronomes ("ele", "ela", "dele", "dela", "aquela moto")
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
  const resolvedCustomer = context.lastCustomer;
  const resolvedItem = context.lastItem;

  const t = text.toLowerCase();

  // 1. Resolução de Cliente ("ele", "ela", "dele", "com ele")
  if (/\b(ele|dele|pra ele|com ele)\b/i.test(t) && context.lastCustomer) {
    resolvedText = resolvedText.replace(/\b(ele|dele|pra ele|com ele)\b/gi, context.lastCustomer.name);
  }

  // 2. Resolução de Mercadoria ("aquela moto", "aquele carro", "o veículo", "o aparelho")
  if (/\b(aquela moto|aquele carro|aquele veiculo|o veiculo|o aparelho|aquela)\b/i.test(t) && context.lastItem) {
    resolvedText = resolvedText.replace(/\b(aquela moto|aquele carro|aquele veiculo|o veiculo|o aparelho|aquela)\b/gi, context.lastItem.name);
  }

  return {
    resolvedText,
    resolvedCustomer,
    resolvedItem,
  };
}

/**
 * Enriquece o prompt do modelo com o contexto anafórico do revendedor.
 */
export function buildContextualPrompt(spokenText: string, context: ConversationContext): string {
  let contextSnippet = '';

  if (context.lastCustomer) {
    contextSnippet += `\nÚltimo cliente referenciado: ${context.lastCustomer.name}`;
  }
  if (context.lastItem) {
    contextSnippet += `\nÚltima mercadoria referenciada: ${context.lastItem.name}`;
  }
  if (context.pendingQuestion) {
    contextSnippet += `\nHá uma pergunta em aberto feita ao usuário: "${context.pendingQuestion.question}".`;
  }

  const { resolvedText } = resolvePronounsAndAnaphora(spokenText, context);

  if (contextSnippet) {
    return `[CONTEXTO RECENTE ATIVO - TTL 30 MIN]:${contextSnippet}\n\n[FALA DO USUÁRIO]: "${resolvedText}"`;
  }

  return `[FALA DO USUÁRIO]: "${resolvedText}"`;
}
