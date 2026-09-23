// src/lib/ai/context_manager.ts
// Gerenciador de Contexto e Desambiguação Conversacional (Fase 10)

export interface UserVoiceContext {
  userId: string;
  lastCustomerMentioned?: {
    id: string;
    name: string;
  };
  lastItemMentioned?: {
    id: string;
    name: string;
  };
  lastDealMentioned?: {
    id: string;
    description: string;
  };
  pendingConfirmation?: {
    originalTranscript: string;
    draftIntent: Record<string, unknown>;
    promptAsked: string;
    timestamp: number;
  };
}

// Armazenamento em memória (LRU simples ou cache volátil por sessão)
const userContextStore = new Map<string, UserVoiceContext>();

export function getUserVoiceContext(userId: string): UserVoiceContext {
  if (!userContextStore.has(userId)) {
    userContextStore.set(userId, { userId });
  }
  return userContextStore.get(userId)!;
}

export function updateUserVoiceContext(userId: string, updates: Partial<UserVoiceContext>): UserVoiceContext {
  const current = getUserVoiceContext(userId);
  const updated = {
    ...current,
    ...updates,
  };
  userContextStore.set(userId, updated);
  return updated;
}

export function clearPendingConfirmation(userId: string): void {
  const current = getUserVoiceContext(userId);
  delete current.pendingConfirmation;
  userContextStore.set(userId, current);
}

/**
 * Enriquece o prompt do modelo com o contexto recente do revendedor.
 */
export function buildContextualPrompt(spokenText: string, context: UserVoiceContext): string {
  let contextSnippet = '';

  if (context.lastCustomerMentioned) {
    contextSnippet += `\nÚltimo cliente citado na conversa recente: ${context.lastCustomerMentioned.name} (ID: ${context.lastCustomerMentioned.id})`;
  }
  if (context.lastItemMentioned) {
    contextSnippet += `\nÚltima mercadoria citada recentemente: ${context.lastItemMentioned.name}`;
  }
  if (context.pendingConfirmation) {
    contextSnippet += `\nHá uma pergunta de confirmação pendente feita anteriormente ao usuário: "${context.pendingConfirmation.promptAsked}".`;
  }

  if (contextSnippet) {
    return `[CONTEXTO RECENTE DA SESSÃO]:${contextSnippet}\n\n[NOVA FALA DO USUÁRIO]: "${spokenText}"`;
  }

  return `[FALA DO USUÁRIO]: "${spokenText}"`;
}
