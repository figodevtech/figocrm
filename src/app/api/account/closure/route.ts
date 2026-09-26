import { createClient as createIsolatedAuthClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingProvider } from '@/lib/billing/registry';

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return Response.json({ error: 'Solicitação inválida.' }, { status: 415 });
  const body = await request.json().catch(() => null);
  if (!body || body.confirmation !== 'ENCERRAR' || typeof body.password !== 'string' || !body.password)
    return Response.json({ error: 'Digite ENCERRAR e confirme sua senha.' }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: 'Entre novamente na sua conta.' }, { status: 401 });
  const auth = createIsolatedAuthClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await auth.auth.signInWithPassword({ email: user.email, password: body.password }).catch(() => null);
  if (!verified) return Response.json({ error: 'Não foi possível verificar sua senha agora. Tente novamente.' }, { status: 503 });
  if (verified.error && verified.error.status !== 400 && verified.error.status !== 401)
    return Response.json({ error: 'Não foi possível verificar sua senha agora. Tente novamente.' }, { status: 503 });
  if (verified.error || verified.data.user?.id !== user.id)
    return Response.json({ error: 'Senha incorreta. Tente novamente.' }, { status: 403 });

  const admin = createAdminClient();
  if (!admin) return Response.json({ error: 'Não foi possível registrar o pedido agora.' }, { status: 503 });
  const { data: existing, error: lookupError } = await supabase.from('account_closure_requests')
    .select('status,scheduled_for').eq('user_id', user.id).maybeSingle();
  if (lookupError) return Response.json({ error: 'Não foi possível registrar o pedido agora.' }, { status: 503 });
  if (existing) return Response.json({ status: existing.status, scheduledFor: existing.scheduled_for });

  const { data: sub, error: subError } = await admin.from('subscriptions')
    .select('provider,provider_subscription_id,status,current_period_end,cancel_at_period_end')
    .eq('user_id', user.id).maybeSingle();
  if (subError) return Response.json({ error: 'Não foi possível verificar sua assinatura agora.' }, { status: 503 });
  const { error: insertError } = await supabase.from('account_closure_requests').insert({ user_id: user.id });
  if (insertError) return Response.json({ error: 'Não foi possível registrar o pedido agora.' }, { status: 503 });

  if (sub?.provider_subscription_id && sub.status === 'active' && !sub.cancel_at_period_end) {
    const provider = getBillingProvider();
    if (!provider || provider.name !== sub.provider || !sub.current_period_end) {
      console.error('[account/closure] cancelamento pendente', { user_id: user.id });
      return Response.json({ status: 'pending_cancellation', message: 'Pedido registrado. A equipe precisa concluir o cancelamento da renovação.' }, { status: 202 });
    }
    try {
      await provider.cancelSubscription({ providerSubscriptionId: sub.provider_subscription_id,
        atPeriodEnd: true, currentPeriodEnd: sub.current_period_end });
      const { error: cancelError } = await admin.from('subscriptions').update({
        status: 'canceled', cancel_at_period_end: true, canceled_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('provider_subscription_id', sub.provider_subscription_id);
      if (cancelError) throw cancelError;
    } catch {
      console.error('[account/closure] falha ao cancelar renovação', { user_id: user.id });
      return Response.json({ status: 'pending_cancellation', message: 'Pedido registrado. A equipe precisa concluir o cancelamento da renovação.' }, { status: 202 });
    }
  }

  const periodEnd = sub?.current_period_end ? Date.parse(sub.current_period_end) : 0;
  const scheduledFor = new Date(Math.max(Date.now() + 30 * 86_400_000, Number.isFinite(periodEnd) ? periodEnd : 0)).toISOString();
  const { error: scheduleError } = await admin.from('account_closure_requests')
    .update({ status: 'scheduled', scheduled_for: scheduledFor }).eq('user_id', user.id);
  if (scheduleError) {
    console.error('[account/closure] revisão manual necessária', { user_id: user.id });
    return Response.json({ status: 'pending_cancellation', message: 'Pedido registrado e pendente de revisão.' }, { status: 202 });
  }
  return Response.json({ status: 'scheduled', scheduledFor, message: 'Pedido registrado. A renovação foi cancelada quando aplicável.' });
}
