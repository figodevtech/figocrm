// src/lib/billing/service.ts
// Aplica eventos de cobrança já verificados à tabela subscriptions (fonte única do acesso).
// Idempotente por (provider, event_id): o mesmo evento entregue duas vezes é aplicado uma vez só.
// Executa com cliente service_role — chamado apenas pelo webhook no servidor.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedBillingEvent } from '@/lib/billing/types';
import { PAID_PLANS, planForCode } from '@/lib/billing/types';
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
  plan_code: string;
  price_cents: number;
  pending_plan_code: string | null;
  pending_price_cents: number | null;
};

async function markProcessed(admin: SupabaseClient, id: string, userId?: string): Promise<string | null> {
  const { error } = await admin.from('billing_events').update({
    ...(userId ? { user_id: userId } : {}), processed_at: new Date().toISOString(), error: null,
  }).eq('id', id);
  return error?.message || null;
}

async function findUser(admin: SupabaseClient, event: NormalizedBillingEvent): Promise<SubscriptionRow | null> {
  const columns = 'user_id, status, current_period_end, past_due_at, provider_subscription_id, provider_customer_id, plan_code, price_cents, pending_plan_code, pending_price_cents';
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
  current: Pick<SubscriptionRow, 'current_period_end' | 'past_due_at'> & { status?: string; provider_subscription_id?: string | null; pending_plan_code?: string | null; plan_code?: string },
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
  if (differentSubscription && current.status === 'active'
    && ['subscription.activated', 'subscription.renewed', 'subscription.reactivated'].includes(event.type))
    return {};

  switch (event.type) {
    case 'subscription.activated':
    case 'subscription.renewed':
    case 'subscription.reactivated':
      if (event.planCode && current.plan_code && event.planCode !== current.plan_code
        && event.currentPeriodEnd && current.current_period_end && event.currentPeriodEnd <= current.current_period_end)
        return {};
      if (event.currentPeriodEnd && current.current_period_end && event.currentPeriodEnd <= current.current_period_end
        && current.status !== 'past_due') return {};
      if (event.cancelAtPeriodEnd === true) {
        // Uma cobrança financeira entregue após o cancelamento pode ampliar o período já pago,
        // mas não deve religar a renovação desativada no provedor.
        return { ...provider, ...period, status: 'canceled', cancel_at_period_end: true,
          ...(current.status === 'canceled' ? {} : { canceled_at: now.toISOString() }) };
      }
      return { ...provider, ...period, status: 'active', trial_ends_at: null,
        plan_code: event.planCode || 'figo_pro_mensal', price_cents: event.priceCents || 3990,
        ...(event.planCode && (!current.pending_plan_code || current.pending_plan_code === event.planCode || differentSubscription)
          ? { pending_plan_code: null, pending_price_cents: null } : {}),
        cancel_at_period_end: event.cancelAtPeriodEnd ?? false, past_due_at: null, canceled_at: null };
    case 'payment.failed':
      if (current.status === 'canceled') return {};
      if (current.status === 'active' && event.currentPeriodEnd && current.current_period_end
        && event.currentPeriodEnd <= current.current_period_end) return {};
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

/** Correlaciona a cobrança financeira ao checkout ou contrato já vinculado. */
async function resolveFinancialPlan(admin: SupabaseClient, event: NormalizedBillingEvent, sub: SubscriptionRow) {
  if (event.provider !== 'asaas') return { planCode: event.planCode || PAID_PLANS.pro.code, priceCents: event.priceCents || PAID_PLANS.pro.priceCents };
  if (!event.providerSubscriptionId || !event.paymentValueCents) return null;
  const columns = 'plan_code, price_cents, provider_subscription_id, provider_checkout_id';
  const { data: bySubscription, error } = await admin.from('billing_checkout_sessions').select(columns)
    .eq('provider', event.provider).eq('user_id', sub.user_id)
    .eq('provider_subscription_id', event.providerSubscriptionId).limit(1).maybeSingle();
  if (error) return null;
  let session = bySubscription;
  if (!session && event.providerCheckoutId) {
    const { data, error: checkoutError } = await admin.from('billing_checkout_sessions').select(columns)
      .eq('provider', event.provider).eq('user_id', sub.user_id)
      .eq('provider_checkout_id', event.providerCheckoutId).maybeSingle();
    if (checkoutError) return null;
    session = data;
  }
  if (session?.plan_code && session.price_cents && session.price_cents === event.paymentValueCents
    && planForCode(session.plan_code))
    return { planCode: session.plan_code, priceCents: session.price_cents };
  // Na primeira cobrança, a sessão escolhida prevalece sobre defaults do trial e contratos antigos.
  if (session?.plan_code && sub.status !== 'active' && sub.status !== 'past_due') return null;
  if (sub.provider_subscription_id !== event.providerSubscriptionId) return null;
  if (sub.pending_plan_code && sub.pending_price_cents === event.paymentValueCents
    && planForCode(sub.pending_plan_code))
    return { planCode: sub.pending_plan_code, priceCents: sub.pending_price_cents };
  if (sub.price_cents === event.paymentValueCents && planForCode(sub.plan_code))
    return { planCode: sub.plan_code, priceCents: sub.price_cents };
  // Contratos antigos mantêm o preço e o plano até mudança solicitada pelo cliente.
  if (sub.price_cents === event.paymentValueCents && sub.plan_code === 'figo_mensal')
    return { planCode: sub.plan_code, priceCents: sub.price_cents };
  return null;
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
    if (event.type === 'subscription.created' || event.type === 'subscription.canceled' || event.type === 'checkout.created'
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

  if (event.type === 'subscription.created' && event.providerCheckoutId && event.providerSubscriptionId) {
    const { error: linkError } = await admin.from('billing_checkout_sessions')
      .update({ provider_subscription_id: event.providerSubscriptionId })
      .eq('provider', event.provider).eq('provider_checkout_id', event.providerCheckoutId)
      .eq('user_id', sub.user_id);
    if (linkError) return { applied: false, duplicate: false, userId: sub.user_id, error: linkError.message };
  }

  if (['subscription.activated', 'subscription.renewed', 'subscription.reactivated'].includes(event.type)) {
    const resolved = await resolveFinancialPlan(admin, event, sub);
    if (!resolved) {
      await admin.from('billing_events').update({ error: 'payment_plan_mismatch' }).eq('id', logged!.id);
      return { applied: false, duplicate: false, userId: sub.user_id, error: 'payment_plan_mismatch' };
    }
    event = { ...event, ...resolved };
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
