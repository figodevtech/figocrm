import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBillingProvider } from '@/lib/billing/registry';
import { getSubscriptionAccess } from '@/lib/subscription';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackProductEvent } from '@/lib/analytics/events';
import { PAID_PLANS, requestedPlanFromPayload } from '@/lib/billing/types';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'invalid_plan' }, { status: 400 }); }
  const plan = requestedPlanFromPayload(payload);
  if (!plan) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  const provider = getBillingProvider();
  if (!provider) return NextResponse.json({ error: 'billing_not_configured', message: 'A assinatura online ainda não está disponível.' }, { status: 503 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'billing_storage_unavailable' }, { status: 503 });

  const access = await getSubscriptionAccess(supabase);
  if (access.reason === 'billing_unavailable' || access.reason === 'subscription_missing') {
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  try {
    const { error: expireError } = await admin.from('billing_checkout_sessions')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'created')
      .lt('created_at', new Date(Date.now() - 60 * 60_000).toISOString());
    if (expireError) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
    const { data: subscription, error: subError } = await admin.from('subscriptions')
      .select('provider_subscription_id, status, canceled_at').eq('user_id', user.id).single();
    if (subError || !subscription) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
    // Uma recorrência encerrada em outro ambiente pode ter sido desvinculada
    // sem retirar o acesso até o fim do período. Permite contratar no Asaas atual.
    if (access.effectiveStatus === 'active' || (access.reason === 'canceled_until_period_end'
      && (subscription.status !== 'canceled' || subscription.provider_subscription_id)))
      return NextResponse.json({ error: 'already_active' }, { status: 409 });
    if (subscription.provider_subscription_id && ['trialing', 'active', 'past_due'].includes(subscription.status))
      return NextResponse.json({ error: 'subscription_already_created' }, { status: 409 });
    if (subscription.provider_subscription_id) {
      const existingProviderSub = await provider.getSubscription(subscription.provider_subscription_id);
      if (existingProviderSub?.status === 'active')
        return NextResponse.json({ error: 'subscription_already_created' }, { status: 409 });
    }
    if (access.status === 'trialing' || (subscription.status === 'canceled' && !subscription.provider_subscription_id)) {
      let paidQuery = admin.from('billing_checkout_sessions').select('id')
        .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'paid');
      if (subscription.status === 'canceled' && subscription.canceled_at)
        paidQuery = paidQuery.gt('created_at', subscription.canceled_at);
      const { data: paid, error: paidError } = await paidQuery.limit(1).maybeSingle();
      if (paidError) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
      if (paid) return NextResponse.json({
        error: 'checkout_already_paid',
        message: 'Sua assinatura já foi cadastrada. Aguarde a primeira cobrança; não é necessário assinar novamente.',
      }, { status: 409 });
    }
    const { data: existing, error: existingError } = await admin.from('billing_checkout_sessions').select('checkout_url, created_at, plan_code')
      .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'created')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingError) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
    if (existing && Date.now() - new Date(existing.created_at).getTime() < 30 * 60_000
      && existing.plan_code === PAID_PLANS[plan].code) {
      return NextResponse.json({ url: existing.checkout_url }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (existing && Date.now() - new Date(existing.created_at).getTime() < 60 * 60_000)
      return NextResponse.json({ error: 'checkout_pending', message: 'Você já tem um checkout aberto. Aguarde uma hora para escolher outro plano.' }, { status: 409 });
    const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
    if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost') throw new Error('Origem inválida.');
    const origin = appUrl.origin;
    const checkout = await provider.createCheckout({
      userId: user.id,
      email: user.email,
      plan,
      successUrl: `${origin}/app/conta?checkout=retorno`,
      cancelUrl: `${origin}/app/conta`,
      // A primeira mensalidade vence na contratação, mesmo durante o teste Pro.
      nextDueDate: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const url = new URL(checkout.url);
    if (url.protocol !== 'https:') throw new Error('URL inválida do provedor de cobrança.');
    const { error: saveError } = await admin.from('billing_checkout_sessions').insert({
      user_id: user.id, provider: provider.name, provider_checkout_id: checkout.providerSessionId,
      external_reference: checkout.externalReference || user.id, checkout_url: url.toString(),
      plan_code: PAID_PLANS[plan].code, price_cents: PAID_PLANS[plan].priceCents,
    });
    if (saveError) throw saveError;
    await trackProductEvent(user.id, 'checkout_started', { provider: provider.name });
    return NextResponse.json({ url: url.toString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'provider_unavailable', message: 'Não consegui abrir o pagamento. Tente de novo.' }, { status: 502 });
  }
}
