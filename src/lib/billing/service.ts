// src/lib/billing/service.ts
// Aplica eventos de cobrança já verificados à tabela subscriptions (fonte única do acesso).
// Idempotente por (provider, event_id): o mesmo evento entregue duas vezes é aplicado uma vez só.
// Executa com cliente service_role — chamado apenas pelo webhook no servidor.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedBillingEvent } from '@/lib/billing/types';
import { trackProductEvent, type ProductEvent } from '@/lib/analytics/events';

export interface ApplyEventResult {
  applied: boolean;
  duplicate: boolean;
  userId?: string;
  status?: string;
  error?: string;
}

type SubscriptionRow = {
  user_id: string;
  status: string;
  current_period_end: string | null;
  past_due_at: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
};

async function markProcessed(admin: SupabaseClient, id: string, userId?: string): Promise<string | null> {
  const { error } = await admin.from('billing_events').update({
    ...(userId ? { user_id: userId } : {}), processed_at: new Date().toISOString(), error: null,
  }).eq('id', id);
  return error?.message || null;
}

async function findUser(admin: SupabaseClient, event: NormalizedBillingEvent): Promise<SubscriptionRow | null> {
  const columns = 'user_id, status, current_period_end, past_due_at, provider_subscription_id, provider_customer_id';
  let checkoutUserId: string | undefined;
  if (event.providerCheckoutId) {
    const { data } = await admin.from('billing_checkout_sessions').select('user_id')
      .eq('provider', event.provider).eq('provider_checkout_id', event.providerCheckoutId).maybeSingle();
    if (!data && event.provider === 'asaas') return null;
    checkoutUserId = data?.user_id;
    if (checkoutUserId && event.userId && checkoutUserId !== event.userId) return null;
  }
  let bySubscription: SubscriptionRow | null = null;
  if (event.providerSubscriptionId) {
    const { data } = await admin
      .from('subscriptions')
      .select(columns)
      .eq('provider', event.provider)
      .eq('provider_subscription_id', event.providerSubscriptionId)
      .maybeSingle();
    if (data) bySubscription = data as SubscriptionRow;
  }
  let byCustomer: SubscriptionRow | null = null;
  if (event.providerCustomerId) {
    const { data } = await admin
      .from('subscriptions')
      .select(columns)
      .eq('provider', event.provider)
      .eq('provider_customer_id', event.providerCustomerId)
      .maybeSingle();
    if (data) byCustomer = data as SubscriptionRow;
  }
  const targetId = checkoutUserId || event.userId;
  if ((bySubscription && targetId && bySubscription.user_id !== targetId)
    || (byCustomer && targetId && byCustomer.user_id !== targetId)
    || (bySubscription && byCustomer && bySubscription.user_id !== byCustomer.user_id)) return null;
  if (bySubscription || byCustomer) return bySubscription || byCustomer;
  if (targetId) {
    if (event.provider === 'asaas') {
      const { data: checkout } = await admin.from('billing_checkout_sessions').select('id')
        .eq('provider', event.provider).eq('user_id', targetId).eq('external_reference', targetId)
        .in('status', ['created', 'paid']).limit(1).maybeSingle();
      if (!checkout) return null;
    }
    const { data } = await admin.from('subscriptions').select(columns).eq('user_id', targetId).maybeSingle();
    return data as SubscriptionRow | null;
  }
  return null;
}

/** Tradução pura evento → alteração (testável sem banco). */
export function subscriptionUpdateFor(
  event: NormalizedBillingEvent,
  current: Pick<SubscriptionRow, 'current_period_end' | 'past_due_at'> & { status?: string; provider_subscription_id?: string | null },
  now: Date = new Date()
): Record<string, unknown> {
  const provider = {
    provider: event.provider,
    ...(event.providerCustomerId ? { provider_customer_id: event.providerCustomerId } : {}),
    ...(event.providerSubscriptionId ? { provider_subscription_id: event.providerSubscriptionId } : {}),
  };
  // Evento atrasado nunca faz o período andar para trás
  const period =
    event.currentPeriodEnd && (!current.current_period_end || event.currentPeriodEnd >= current.current_period_end)
      ? { current_period_start: event.currentPeriodStart ?? null, current_period_end: event.currentPeriodEnd }
      : {};
  const differentSubscription = !!(event.providerSubscriptionId && current.provider_subscription_id
    && event.providerSubscriptionId !== current.provider_subscription_id);
  if (differentSubscription && ['payment.failed', 'subscription.canceled', 'subscription.expired', 'subscription.created'].includes(event.type))
    return {};

  switch (event.type) {
    case 'subscription.activated':
    case 'subscription.renewed':
    case 'subscription.reactivated':
      if (event.currentPeriodEnd && current.current_period_end && event.currentPeriodEnd <= current.current_period_end
        && current.status !== 'past_due') return {};
      return { ...provider, ...period, status: 'active', plan_code: 'figo_pro_mensal', price_cents: 2450,
        cancel_at_period_end: event.cancelAtPeriodEnd ?? false, past_due_at: null, canceled_at: null };
    case 'payment.failed':
      if (current.status === 'canceled') return {};
      return { ...provider, status: 'past_due', past_due_at: current.past_due_at ?? now.toISOString() };
    case 'subscription.canceled':
      // Continua escrevendo até o fim do período já pago (regra em subscription_access)
      return { ...provider, ...period, status: 'canceled', canceled_at: now.toISOString(), cancel_at_period_end: true };
    case 'subscription.expired':
      return { ...provider, status: 'expired' };
    case 'subscription.created':
      return { ...provider };
    case 'ignored':
      return {};
    case 'checkout.created':
    case 'checkout.paid':
    case 'checkout.canceled':
    case 'checkout.expired':
      return {};
  }
}

export async function applyBillingEvent(admin: SupabaseClient, event: NormalizedBillingEvent): Promise<ApplyEventResult> {
  if (event.type === 'ignored') return { applied: false, duplicate: false };
  const sub = await findUser(admin, event);

  const { data: inserted, error: logError } = await admin
    .from('billing_events')
    .insert({
      provider: event.provider,
      event_id: event.eventId,
      event_type: event.type,
      user_id: sub?.user_id ?? null,
      payload: event.raw ?? {},
    })
    .select('id')
    .single();

  let logged = inserted;
  if (logError) {
    if (logError.code === '23505') {
      const { data: previous, error: readError } = await admin.from('billing_events').select('id, processed_at')
        .eq('provider', event.provider).eq('event_id', event.eventId).maybeSingle();
      if (readError || !previous) return { applied: false, duplicate: false, error: readError?.message || 'event_lookup_failed' };
      if (previous.processed_at) return { applied: false, duplicate: true, userId: sub?.user_id };
      logged = previous;
    } else {
      return { applied: false, duplicate: false, error: logError.message };
    }
  }

  if (!sub) {
    if (event.type === 'subscription.created' || event.type === 'checkout.created'
      || event.type === 'checkout.canceled' || event.type === 'checkout.expired') {
      const markError = await markProcessed(admin, logged!.id);
      if (markError) return { applied: false, duplicate: false, error: markError };
      return { applied: false, duplicate: false };
    }
    await admin.from('billing_events').update({ error: 'subscription_not_found' }).eq('id', logged!.id);
    return { applied: false, duplicate: false, error: 'subscription_not_found' };
  }

  if (event.type.startsWith('checkout.')) {
    if (event.providerCheckoutId) {
      const status = event.type.slice('checkout.'.length);
      const { error } = await admin.from('billing_checkout_sessions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('provider', event.provider).eq('provider_checkout_id', event.providerCheckoutId)
        .eq('user_id', sub.user_id);
      if (error) return { applied: false, duplicate: false, userId: sub.user_id, error: error.message };
    }
    if (event.providerCustomerId && !sub.provider_customer_id) {
      const { error: customerError } = await admin.from('subscriptions')
        .update({ provider: event.provider, provider_customer_id: event.providerCustomerId })
        .eq('user_id', sub.user_id).is('provider_customer_id', null);
      if (customerError) return { applied: false, duplicate: false, userId: sub.user_id, error: customerError.message };
    }
    const markError = await markProcessed(admin, logged!.id, sub.user_id);
    if (markError) return { applied: false, duplicate: false, userId: sub.user_id, error: markError };
    const tracked = ({ 'checkout.paid': 'checkout_completed', 'checkout.canceled': 'checkout_canceled',
      'checkout.expired': 'checkout_expired' } as Partial<Record<NormalizedBillingEvent['type'], ProductEvent>>)[event.type];
    if (tracked) await trackProductEvent(sub.user_id, tracked, { provider: event.provider });
    return { applied: true, duplicate: false, userId: sub.user_id };
  }

  const update = subscriptionUpdateFor(event, sub);
  if (Object.keys(update).length === 0) {
    const markError = await markProcessed(admin, logged!.id, sub.user_id);
    if (markError) return { applied: false, duplicate: false, userId: sub.user_id, error: markError };
    return { applied: false, duplicate: false, userId: sub.user_id };
  }
  const { error: updateError } = await admin.from('subscriptions').update(update).eq('user_id', sub.user_id);
  if (updateError) {
    await admin.from('billing_events').update({ error: updateError.message }).eq('id', logged!.id);
    return { applied: false, duplicate: false, userId: sub.user_id, error: updateError.message };
  }

  const markError = await markProcessed(admin, logged!.id, sub.user_id);
  if (markError) return { applied: false, duplicate: false, userId: sub.user_id, error: markError };
  const tracked = ({ 'subscription.activated': 'subscription_activated', 'payment.failed': 'payment_failed',
    'subscription.canceled': 'subscription_canceled' } as Partial<Record<NormalizedBillingEvent['type'], ProductEvent>>)[event.type];
  if (tracked) await trackProductEvent(sub.user_id, tracked, { provider: event.provider });
  return { applied: true, duplicate: false, userId: sub.user_id, status: update.status ? String(update.status) : undefined };
}
