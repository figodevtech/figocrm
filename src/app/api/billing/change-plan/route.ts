import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingProvider } from '@/lib/billing/registry';
import { PAID_PLANS, requestedPlanFromPayload, planForCode } from '@/lib/billing/types';

/** Agenda a tarifa para cobranças futuras; o benefício só muda após pagamento confirmado. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_plan' }, { status: 400 }); }
  const plan = requestedPlanFromPayload(body);
  if (!plan) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  const provider = getBillingProvider();
  const admin = createAdminClient();
  if (!provider || !admin) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  const { data: sub, error } = await admin.from('subscriptions')
    .select('status, provider, provider_subscription_id, plan_code, price_cents, pending_plan_code, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id).single();
  if (error || !sub || sub.status !== 'active' || sub.provider !== provider.name || !sub.provider_subscription_id
    || sub.cancel_at_period_end || !sub.current_period_end || new Date(sub.current_period_end).getTime() <= Date.now())
    return NextResponse.json({ error: 'subscription_not_active' }, { status: 409 });
  if (!planForCode(sub.plan_code) || sub.price_cents === 2450)
    return NextResponse.json({ error: 'legacy_plan_contact_support' }, { status: 409 });
  if (sub.plan_code === PAID_PLANS[plan].code) return NextResponse.json({ error: 'already_on_plan' }, { status: 409 });
  if (sub.pending_plan_code) return NextResponse.json({
    scheduled: sub.pending_plan_code === PAID_PLANS[plan].code,
    error: sub.pending_plan_code === PAID_PLANS[plan].code ? undefined : 'another_change_pending',
  }, { status: sub.pending_plan_code === PAID_PLANS[plan].code ? 200 : 409 });

  const { data: reserved, error: reserveError } = await admin.from('subscriptions')
    .update({ pending_plan_code: PAID_PLANS[plan].code, pending_price_cents: PAID_PLANS[plan].priceCents })
    .eq('user_id', user.id).eq('provider_subscription_id', sub.provider_subscription_id)
    .eq('plan_code', sub.plan_code).is('pending_plan_code', null)
    .select('user_id').maybeSingle();
  if (reserveError || !reserved) return NextResponse.json({ error: 'change_conflict' }, { status: 409 });
  try {
    await provider.changeSubscriptionPlan({ providerSubscriptionId: sub.provider_subscription_id, plan });
    return NextResponse.json({ scheduled: true, plan, effective: 'first_paid_charge_at_new_price' });
  } catch {
    try {
      const observed = await provider.getSubscription(sub.provider_subscription_id);
      if (observed?.priceCents === PAID_PLANS[plan].priceCents)
        return NextResponse.json({ scheduled: true, plan, effective: 'first_paid_charge_at_new_price' });
      if (!observed || observed.priceCents === undefined)
        return NextResponse.json({ error: 'change_unconfirmed', message: 'A mudança está em verificação. Confira seu plano antes de tentar novamente.' }, { status: 503 });
    } catch {
      return NextResponse.json({ error: 'change_unconfirmed', message: 'A mudança está em verificação. Confira seu plano antes de tentar novamente.' }, { status: 503 });
    }
    await admin.from('subscriptions').update({ pending_plan_code: null, pending_price_cents: null })
      .eq('user_id', user.id).eq('pending_plan_code', PAID_PLANS[plan].code);
    return NextResponse.json({ error: 'provider_unavailable', message: 'Não consegui agendar a mudança. Tente de novo.' }, { status: 502 });
  }
}
