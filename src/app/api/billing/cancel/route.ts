import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingProvider } from '@/lib/billing/registry';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const provider = getBillingProvider();
  const admin = createAdminClient();
  if (!provider || !admin) return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  const { data: sub, error } = await supabase.from('subscriptions')
    .select('status, provider, provider_subscription_id, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id).maybeSingle();
  if (error || !sub || sub.provider !== provider.name || !sub.provider_subscription_id || sub.status !== 'active')
    return NextResponse.json({ error: 'subscription_not_active' }, { status: 409 });
  if (sub.cancel_at_period_end) return NextResponse.json({ canceled: true });
  try {
    await provider.cancelSubscription({ providerSubscriptionId: sub.provider_subscription_id, atPeriodEnd: true });
    const { error: updateError } = await admin.from('subscriptions').update({
      status: 'canceled', cancel_at_period_end: true, canceled_at: new Date().toISOString(),
    }).eq('user_id', user.id).eq('provider_subscription_id', sub.provider_subscription_id);
    if (updateError) throw updateError;
    return NextResponse.json({ canceled: true, accessUntil: sub.current_period_end });
  } catch {
    return NextResponse.json({ error: 'provider_unavailable', message: 'Não consegui cancelar agora. Tente de novo.' }, { status: 502 });
  }
}
