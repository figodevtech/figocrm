type Payload = Record<string, unknown>;
const object = (value: unknown): Payload => value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {};
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

export interface BillingReferences {
  checkoutId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  externalReference: string | null;
}

/** Reads the original verified Asaas payload without trusting it to activate a plan. */
export function billingReferences(payload: unknown): BillingReferences {
  const body = object(payload);
  const payment = object(body.payment);
  const checkout = object(body.checkout);
  const subscription = object(body.subscription);
  return {
    checkoutId: string(checkout.id) || string(payment.checkoutSession) || string(body.checkout),
    subscriptionId: string(payment.subscription) || string(subscription.id) || string(body.subscription),
    customerId: string(payment.customer) || string(subscription.customer) || string(checkout.customer),
    externalReference: string(payment.externalReference) || string(checkout.externalReference) || string(subscription.externalReference),
  };
}

export function mayTerminallyIgnore(error: string | null, receivedAt: string, now = Date.now()): boolean {
  return error === 'subscription_not_found'
    && Number.isFinite(Date.parse(receivedAt))
    && Date.parse(receivedAt) <= now - 24 * 60 * 60 * 1000;
}

export function compareAsaasSubscription(
  local: { status: string; provider_subscription_id: string | null; provider_customer_id: string | null; price_cents: number },
  remote: { providerSubscriptionId: string; providerCustomerId: string; status: string; cancelAtPeriodEnd: boolean; priceCents?: number } | null
): string[] {
  if (!local.provider_subscription_id) return ['subscription_id_missing'];
  if (!remote || remote.providerSubscriptionId !== local.provider_subscription_id) return ['subscription_id_mismatch'];
  const findings: string[] = [];
  if (remote.status === 'active' && local.status === 'canceled' && !remote.cancelAtPeriodEnd)
    findings.push('asaas_active_figo_canceled');
  if (remote.status !== 'active' && local.status === 'active') findings.push('asaas_inactive_figo_active');
  if (remote.priceCents !== undefined && remote.priceCents !== local.price_cents) findings.push('price_mismatch');
  if (remote.providerCustomerId && local.provider_customer_id && remote.providerCustomerId !== local.provider_customer_id)
    findings.push('customer_id_mismatch');
  return findings;
}
