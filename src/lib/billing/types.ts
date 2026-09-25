// src/lib/billing/types.ts
// Contrato de cobrança compartilhado pelo adaptador Asaas e pelos testes.

export const PAID_PLANS = {
  pro: { code: 'figo_pro_mensal', name: 'FigoCRM Pro', priceCents: 3990, voiceMonthlyLimit: 300 },
  pro_plus: { code: 'figo_pro_plus_mensal', name: 'FigoCRM Pro Mais', priceCents: 8990, voiceMonthlyLimit: 1000 },
} as const;
export type PaidPlan = keyof typeof PAID_PLANS;
export type PlanCode = (typeof PAID_PLANS)[PaidPlan]['code'];
export function isPaidPlan(value: unknown): value is PaidPlan { return value === 'pro' || value === 'pro_plus'; }
export function requestedPlanFromPayload(value: unknown): PaidPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length === 1 && entries[0][0] === 'plan' && isPaidPlan(entries[0][1]) ? entries[0][1] : null;
}
export function planForCode(code: string): PaidPlan | null {
  if (code === PAID_PLANS.pro.code) return 'pro';
  if (code === PAID_PLANS.pro_plus.code) return 'pro_plus';
  return null;
}
export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

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
  /** Valor da cobrança confirmada, não o valor atual da recorrência. */
  paymentValueCents?: number;
  planCode?: string;
  priceCents?: number;
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
  priceCents?: number;
}

export interface BillingProvider {
  readonly name: string;
  createCustomer(input: { userId: string; email: string; name?: string }): Promise<{ providerCustomerId: string }>;
  createSubscription(input: { userId: string; providerCustomerId: string }): Promise<ProviderSubscription>;
  createCheckout(input: { userId: string; email: string; plan: PaidPlan; successUrl: string; cancelUrl: string; nextDueDate?: string }): Promise<CheckoutSession>;
  changeSubscriptionPlan(input: { providerSubscriptionId: string; plan: PaidPlan }): Promise<void>;
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
