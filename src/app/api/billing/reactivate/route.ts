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
    .select('status, provider, provider_subscription_id, current_period_end')
    .eq('user_id', user.id).maybeSingle();
  if (error || !sub || sub.status !== 'canceled' || sub.provider !== provider.name || !sub.provider_subscription_id
    || !sub.current_period_end || new Date(sub.current_period_end).getTime() <= Date.now() + 60_000)
    return NextResponse.json({ error: 'subscription_not_reactivatable' }, { status: 409 });
  try {
    await provider.reactivateSubscription({ providerSubscriptionId: sub.provider_subscription_id });
    const { error: updateError } = await admin.from('subscriptions').update({
      status: 'active', cancel_at_period_end: false, canceled_at: null,
    }).eq('user_id', user.id).eq('provider_subscription_id', sub.provider_subscription_id);
    if (updateError) throw updateError;
    return NextResponse.json({ reactivated: true });
  } catch {
    return NextResponse.json({ error: 'provider_unavailable', message: 'Não consegui reativar agora. Tente de novo.' }, { status: 502 });
  }
}
