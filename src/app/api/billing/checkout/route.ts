import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBillingProvider } from '@/lib/billing/registry';
import { getSubscriptionAccess } from '@/lib/subscription';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackProductEvent } from '@/lib/analytics/events';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const provider = getBillingProvider();
  if (!provider) return NextResponse.json({ error: 'billing_not_configured', message: 'A assinatura online ainda não está disponível.' }, { status: 503 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'billing_storage_unavailable' }, { status: 503 });

  const access = await getSubscriptionAccess(supabase);
  if (access.effectiveStatus === 'active' && access.effectivePlan === 'pro') return NextResponse.json({ error: 'already_active' }, { status: 409 });
  if (access.reason === 'billing_unavailable' || access.reason === 'subscription_missing') {
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  try {
    if (access.status === 'trialing') {
      const { data: paid, error: paidError } = await admin.from('billing_checkout_sessions').select('id')
        .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'paid')
        .limit(1).maybeSingle();
      if (paidError) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
      if (paid) return NextResponse.json({
        error: 'checkout_already_paid',
        message: 'Sua assinatura já foi cadastrada. Aguarde a primeira cobrança; não é necessário assinar novamente.',
      }, { status: 409 });
    }
    const { data: existing } = await admin.from('billing_checkout_sessions').select('checkout_url, created_at')
      .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'created')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing && Date.now() - new Date(existing.created_at).getTime() < 30 * 60_000) {
      return NextResponse.json({ url: existing.checkout_url }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
    if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost') throw new Error('Origem inválida.');
    const origin = appUrl.origin;
    const checkout = await provider.createCheckout({
      userId: user.id,
      email: user.email,
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
    });
    if (saveError) throw saveError;
    await trackProductEvent(user.id, 'checkout_started', { provider: provider.name });
    return NextResponse.json({ url: url.toString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'provider_unavailable', message: 'Não consegui abrir o pagamento. Tente de novo.' }, { status: 502 });
  }
}
