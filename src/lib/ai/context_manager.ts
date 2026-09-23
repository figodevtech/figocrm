// src/lib/ai/context_manager.ts
// Gerenciador de Contexto Conversacional e Resolução de Entidades — Fase 30 do FigoCRM
// Suporta persistência com TTL de 30 minutos, resolução anafórica ("ele", "aquela moto") e desambiguação de homônimos.

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
  createdAt: number;
}

export interface ConversationContext {
  userId: string;
  lastCustomer?: EntityReference;
  lastItem?: EntityReference;
  lastDeal?: EntityReference;
  lastReceivable?: EntityReference;
  pendingQuestion?: PendingQuestion;
  pendingConfirmation?: {
    originalTranscript: string;
    draftIntent: Record<string, unknown>;
    promptAsked: string;
    timestamp: number;
  };
  expiresAt: number; // Timestamp em milissegundos
}

// Armazenamento em memória com controle de TTL (30 minutos)
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutos
const contextStore = new Map<string, ConversationContext>();

/**
 * Obtém o contexto de conversação do usuário, descartando sessões expiradas.
 */
export function getUserVoiceContext(userId: string): ConversationContext {
  const now = Date.now();
  const existing = contextStore.get(userId);

  if (existing) {
    if (existing.expiresAt > now) {
      // Renova o TTL a cada nova interação ativa
      existing.expiresAt = now + CONTEXT_TTL_MS;
      return existing;
    } else {
      // Expirou
      contextStore.delete(userId);
    }
  }

  const newContext: ConversationContext = {
    userId,
    expiresAt: now + CONTEXT_TTL_MS,
  };
  contextStore.set(userId, newContext);
  return newContext;
}

/**
 * Atualiza o contexto conversacional com renovação de TTL.
 */
export function updateUserVoiceContext(
  userId: string,
  updates: Partial<ConversationContext>
): ConversationContext {
  const current = getUserVoiceContext(userId);
  const updated: ConversationContext = {
    ...current,
    ...updates,
    expiresAt: Date.now() + CONTEXT_TTL_MS,
  };
  contextStore.set(userId, updated);
  return updated;
}

/**
 * Limpa perguntas e confirmações pendentes
 */
export function clearPendingConfirmation(userId: string): void {
  const current = getUserVoiceContext(userId);
  delete current.pendingQuestion;
  delete current.pendingConfirmation;
  contextStore.set(userId, current);
}

/**
 * Resolve referências anafóricas e pronomes ("ele", "ela", "dele", "dela", "aquele carro")
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
  let resolvedCustomer = context.lastCustomer;
  let resolvedItem = context.lastItem;

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
