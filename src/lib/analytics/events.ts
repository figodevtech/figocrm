// src/lib/analytics/events.ts
// Analytics de Produto e Métricas de Ativação / Retenção (Fase 15)

export type ProductEvent =
  | 'cadastro'
  | 'primeira_operacao'
  | 'primeira_operacao_voz'
  | 'primeira_venda'
  | 'primeiro_parcelamento'
  | 'primeiro_recebimento'
  | 'primeiro_item_troca'
  | 'assinatura_iniciada'
  | 'assinatura_cancelada'
  | 'comando_desfazer_acionado';

export interface EventPayload {
  userId: string;
  event: ProductEvent;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Registra eventos de produto de forma assíncrona sem bloquear a resposta do usuário
 */
export async function trackProductEvent(userId: string, event: ProductEvent, metadata: Record<string, unknown> = {}): Promise<void> {
  const payload: EventPayload = {
    userId,
    event,
    metadata,
    timestamp: new Date().toISOString(),
  };

  // Log estruturado no console para ingestão por ferramentas de analytics (PostHog, Mixpanel, Datadog)
  console.log('[PRODUCT_ANALYTICS]', JSON.stringify(payload));
}
