// src/lib/billing/service.ts
// Aplica eventos de cobrança já verificados à tabela subscriptions (fonte única do acesso).
// Idempotente por (provider, event_id): o mesmo evento entregue duas vezes é aplicado uma vez só.
// Executa com cliente service_role — chamado apenas pelo webhook no servidor.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedBillingEvent } from '@/lib/billing/types';

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
};

async function findUser(admin: SupabaseClient, event: NormalizedBillingEvent): Promise<SubscriptionRow | null> {
  const columns = 'user_id, status, current_period_end, past_due_at';
  if (event.userId) {
    const { data } = await admin.from('subscriptions').select(columns).eq('user_id', event.userId).maybeSingle();
    if (data) return data as SubscriptionRow;
  }
  if (event.providerSubscriptionId) {
    const { data } = await admin
      .from('subscriptions')
      .select(columns)
      .eq('provider', event.provider)
      .eq('provider_subscription_id', event.providerSubscriptionId)
      .maybeSingle();
    if (data) return data as SubscriptionRow;
  }
  if (event.providerCustomerId) {
    const { data } = await admin
      .from('subscriptions')
      .select(columns)
      .eq('provider', event.provider)
      .eq('provider_customer_id', event.providerCustomerId)
      .maybeSingle();
    if (data) return data as SubscriptionRow;
  }
  return null;
}

/** Tradução pura evento → alteração (testável sem banco). */
export function subscriptionUpdateFor(
  event: NormalizedBillingEvent,
  current: Pick<SubscriptionRow, 'current_period_end' | 'past_due_at'>,
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

  switch (event.type) {
    case 'subscription.activated':
    case 'subscription.renewed':
    case 'subscription.reactivated':
      return { ...provider, ...period, status: 'active', cancel_at_period_end: event.cancelAtPeriodEnd ?? false, past_due_at: null, canceled_at: null };
    case 'payment.failed':
      return { ...provider, status: 'past_due', past_due_at: current.past_due_at ?? now.toISOString() };
    case 'subscription.canceled':
      // Continua escrevendo até o fim do período já pago (regra em subscription_access)
      return { ...provider, ...period, status: 'canceled', canceled_at: now.toISOString(), cancel_at_period_end: true };
    case 'subscription.expired':
      return { ...provider, status: 'expired' };
  }
}

export async function applyBillingEvent(admin: SupabaseClient, event: NormalizedBillingEvent): Promise<ApplyEventResult> {
  const sub = await findUser(admin, event);

  const { data: logged, error: logError } = await admin
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

  if (logError) {
    if (logError.code === '23505') return { applied: false, duplicate: true, userId: sub?.user_id };
    return { applied: false, duplicate: false, error: logError.message };
  }

  if (!sub) {
    await admin.from('billing_events').update({ error: 'subscription_not_found' }).eq('id', logged.id);
    return { applied: false, duplicate: false, error: 'subscription_not_found' };
  }

  const update = subscriptionUpdateFor(event, sub);
  const { error: updateError } = await admin.from('subscriptions').update(update).eq('user_id', sub.user_id);
  if (updateError) {
    await admin.from('billing_events').update({ error: updateError.message }).eq('id', logged.id);
    return { applied: false, duplicate: false, userId: sub.user_id, error: updateError.message };
  }

  await admin.from('billing_events').update({ processed_at: new Date().toISOString() }).eq('id', logged.id);
  return { applied: true, duplicate: false, userId: sub.user_id, status: String(update.status) };
}
