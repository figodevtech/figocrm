// src/lib/billing/types.ts
// Contrato de cobrança compartilhado pelo adaptador Asaas e pelos testes.

export const PLAN = {
  code: 'figo_pro_mensal',
  name: 'FigoCRM Pro',
  priceCents: 2450,
  currency: 'BRL',
  interval: 'month',
  trialDays: 7,
} as const;

export type BillingEventType =
  | 'subscription.activated'
  | 'subscription.renewed'
  | 'subscription.reactivated'
  | 'payment.failed'
  | 'subscription.canceled'
  | 'subscription.expired'
  | 'subscription.created'
  | 'ignored'
  | 'checkout.created'
  | 'checkout.paid'
  | 'checkout.canceled'
  | 'checkout.expired';

/** Evento já autenticado e traduzido do formato do provedor. */
export interface NormalizedBillingEvent {
  provider: string;
  /** ID único do evento no provedor — base da idempotência. */
  eventId: string;
  type: BillingEventType;
  userId?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerCheckoutId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  occurredAt: string;
  raw: unknown;
}

export interface CheckoutSession {
  url: string;
  providerSessionId: string;
  externalReference?: string;
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: 'active' | 'past_due' | 'canceled' | 'expired' | 'trialing';
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export interface BillingProvider {
  readonly name: string;
  createCustomer(input: { userId: string; email: string; name?: string }): Promise<{ providerCustomerId: string }>;
  createSubscription(input: { userId: string; providerCustomerId: string }): Promise<ProviderSubscription>;
  createCheckout(input: { userId: string; email: string; successUrl: string; cancelUrl: string; nextDueDate?: string }): Promise<CheckoutSession>;
  cancelSubscription(input: { providerSubscriptionId: string; atPeriodEnd: boolean; currentPeriodEnd: string }): Promise<void>;
  reactivateSubscription(input: { providerSubscriptionId: string }): Promise<void>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;
  /**
   * Verifica a autenticação do webhook sobre o corpo bruto e traduz o evento.
   * Retorna null se a assinatura não confere (nunca confiar em redirect do navegador).
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<NormalizedBillingEvent | null>;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Nenhum provedor de cobrança configurado.');
    this.name = 'BillingNotConfiguredError';
  }
}
