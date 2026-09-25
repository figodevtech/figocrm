import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { getProfile } from '@/lib/domain/app-data';
import { getSubscriptionAccess } from '@/lib/subscription';
import { PAID_PLANS, formatPrice } from '@/lib/billing/types';
import { formatDate } from '@/lib/format';
import { getBillingProvider } from '@/lib/billing/registry';
import { createAdminClient } from '@/lib/supabase/admin';
import { BillingCheckoutButton } from '@/components/app/billing-checkout-button';
import { BillingChangePlanButton } from '@/components/app/billing-change-plan-button';
import { BillingCancelButton } from '@/components/app/billing-cancel-button';
import { BillingReactivateButton } from '@/components/app/billing-reactivate-button';
import { BillingStatusRefresh } from '@/components/app/billing-status-refresh';
import { LogoutButton, PasswordForm, ProfileForm } from '@/components/app/account-forms';
import { Alert, Badge, Card, PageHeader, Row, SectionTitle } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Conta' };

function planLabel(effective: string, name: string): { label: string; tone: 'emerald' | 'amber' | 'rose' | 'sky' } {
  switch (effective) {
    case 'trialing':
      return { label: 'Teste gratuito', tone: 'sky' };
    case 'active':
      return { label: `Plano ${name}`, tone: 'emerald' };
    case 'past_due':
      return { label: 'Pagamento pendente', tone: 'amber' };
    case 'canceled':
      return { label: `${name} até o fim do período`, tone: 'amber' };
    default:
      return { label: 'Vencido', tone: 'rose' };
  }
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ checkout }, profile, access, { data: billingSub }] = await Promise.all([
    searchParams,
    getProfile(supabase, user.id, user.email ?? ''),
    getSubscriptionAccess(supabase),
    supabase.from('subscriptions').select('provider, provider_subscription_id, plan_code, price_cents, pending_plan_code, cancel_at_period_end, canceled_at').eq('user_id', user.id).maybeSingle(),
  ]);
  const activeName = access.effectivePlan === 'pro_plus' ? 'Pro Mais' : 'Pro';
  const plan = access.effectivePlan === 'free' ? { label: 'Free', tone: 'sky' as const } : planLabel(access.effectiveStatus, activeName);
  const provider = getBillingProvider();
  const admin = createAdminClient();
  const checkoutAvailable = provider !== null && admin !== null;
  let paidCheckout = false;
  let paidCheckoutName = 'Pro';
  let checkoutLookupFailed = false;
  const detachedCanceledSubscription = !!billingSub && !!provider && billingSub.provider === provider.name
    && billingSub.provider_subscription_id === null && access.reason === 'canceled_until_period_end';
  if (provider && admin && (access.status === 'trialing' || detachedCanceledSubscription)) {
    let paidQuery = admin.from('billing_checkout_sessions').select('id, plan_code')
      .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'paid');
    if (detachedCanceledSubscription && billingSub?.canceled_at)
      paidQuery = paidQuery.gt('created_at', billingSub.canceled_at);
    const { data, error } = await paidQuery.limit(1).maybeSingle();
    paidCheckout = !!data;
    if (data?.plan_code === PAID_PLANS.pro_plus.code) paidCheckoutName = 'Pro Mais';
    checkoutLookupFailed = !!error;
  }
  const managedSubscription = !!(provider && billingSub?.provider === provider.name && billingSub.provider_subscription_id);
  const canSubscribe = checkoutAvailable && !paidCheckout && !checkoutLookupFailed
    && (access.effectiveStatus === 'trialing' || access.effectivePlan === 'free' || detachedCanceledSubscription)
    && !(billingSub?.provider_subscription_id && access.effectiveStatus === 'trialing');
  const voicePercentage = access.voiceMonthlyLimit > 0
    ? Math.min(100, Math.round(access.voiceUsedThisMonth / access.voiceMonthlyLimit * 100)) : 0;
  const canChange = managedSubscription && access.effectiveStatus === 'active'
    && !access.cancelAtPeriodEnd && !billingSub?.pending_plan_code;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Conta" back="/app" />

      <SectionTitle>Plano</SectionTitle>
      <Card>
        {paidCheckout ? <p className="mb-3 rounded-xl bg-sky-400/10 p-3 text-sm text-sky-100">Assinatura cadastrada no Asaas. A primeira cobrança ainda está pendente. O Plano {paidCheckoutName} pago começa assim que o pagamento for confirmado. Você não precisa assinar novamente.</p> : null}
        {checkout === 'retorno' && !paidCheckout && access.effectiveStatus === 'active' ? <p className="mb-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-100">Pagamento confirmado. Seu plano {activeName} está ativo.</p> : null}
        {checkout === 'retorno' && !paidCheckout && access.effectiveStatus !== 'active' ? <p className="mb-3 rounded-xl bg-sky-400/10 p-3 text-sm text-sky-100">Retorno do checkout recebido. Estamos conferindo o pagamento com o Asaas.</p> : null}
        {(checkout === 'retorno' || paidCheckout) && access.effectiveStatus !== 'active' ? <BillingStatusRefresh /> : null}
        {checkoutLookupFailed ? <p className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">Não consegui verificar sua assinatura agora. Atualize a página em instantes.</p> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold text-white">FigoCRM {access.effectivePlan === 'pro_plus' ? 'Pro Mais' : access.effectivePlan === 'pro' ? 'Pro' : 'Free'}</p>
          <Badge tone={plan.tone}>{plan.label}</Badge>
        </div>
        {access.effectiveStatus === 'trialing' ? (
          <Row label="Dias restantes" value={`${access.trialDaysRemaining} ${access.trialDaysRemaining === 1 ? 'dia' : 'dias'}`} strong tone="sky" />
        ) : null}
        {access.trialEndsAt && access.effectiveStatus === 'trialing' ? <Row label="Teste termina em" value={formatDate(access.trialEndsAt)} /> : null}
        {access.effectiveStatus === 'trialing' ? <p className="mt-3 text-sm text-slate-300">{paidCheckout ? 'Quando a primeira cobrança for confirmada, o teste acaba e sua mensalidade Pro começa naquele dia.' : 'Ao assinar, a primeira mensalidade é cobrada agora e o teste acaba quando o pagamento for confirmado. Sem assinatura, você continua no Free depois do teste.'}</p> : null}
        {access.currentPeriodEnd && access.effectiveStatus !== 'trialing' ? <Row label={access.effectiveStatus === 'active' ? 'Próxima renovação' : 'Período pago até'} value={formatDate(access.currentPeriodEnd)} /> : null}
        <Row label="Clientes" value={access.customerLimit === null ? `${access.customerCount} · ilimitados` : `${access.customerCount} / ${access.customerLimit}`} />
        <Row label="Comandos de voz neste mês" value={`${access.voiceUsedThisMonth} / ${access.voiceMonthlyLimit}`} />
        {access.voiceMonthlyLimit > 0 ? <div className="mt-2" role="progressbar" aria-label="Uso de comandos de voz" aria-valuemin={0} aria-valuemax={access.voiceMonthlyLimit} aria-valuenow={Math.min(access.voiceUsedThisMonth, access.voiceMonthlyLimit)}>
          <div className="h-2 overflow-hidden rounded-full bg-slate-700"><div className={`h-full rounded-full ${voicePercentage >= 100 ? 'bg-rose-400' : voicePercentage >= 80 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${voicePercentage}%` }} /></div>
          <p className="mt-2 text-sm text-slate-300">Você usou {access.voiceUsedThisMonth} de {access.voiceMonthlyLimit} comandos de voz neste mês. Restam {access.voiceRemainingThisMonth}.</p>
        </div> : null}
        {voicePercentage >= 100 ? <div className="mt-3"><Alert tone="info">Você chegou ao limite do seu plano. Digite a operação ou faça upgrade para continuar usando comandos de voz.</Alert></div>
          : voicePercentage >= 80 ? <p className="mt-2 text-sm text-amber-200">Você está perto do limite mensal de comandos de voz.</p> : null}
        {voicePercentage >= 80 && canChange && access.effectivePlan === 'pro' && billingSub?.price_cents !== 2450
          ? <BillingChangePlanButton plan="pro_plus" label="Fazer upgrade para Pro Mais" /> : null}
        {access.effectivePlan === 'free' ? <p className="mt-3 text-sm text-slate-300">O Free continua sem prazo. Seus dados permanecem disponíveis mesmo depois do teste.</p> : null}
        {billingSub?.pending_plan_code ? <div className="mt-3"><Alert tone="info">Mudança para {billingSub.pending_plan_code === PAID_PLANS.pro_plus.code ? 'Pro Mais' : 'Pro'} agendada. Seu plano atual continua até a confirmação da primeira cobrança com o novo valor.</Alert></div> : null}
        {billingSub?.provider_subscription_id && billingSub.price_cents === 2450 && access.effectivePlan === 'pro' ? <p className="mt-2 text-sm text-slate-300">Sua assinatura anterior mantém o preço contratado de {formatPrice(2450)}/mês.</p> : null}
        {access.cancelAtPeriodEnd && access.reason === 'canceled_until_period_end' ? <div className="mt-3"><Alert tone="success">Renovação cancelada. Seu plano {activeName} continua até {formatDate(access.currentPeriodEnd)}. Depois, você continua no Free, sem perder seus dados nem receber outra cobrança.</Alert></div> : null}
        {detachedCanceledSubscription ? <div className="mt-3"><Alert tone="info">Sua assinatura de teste foi encerrada. Você pode contratar um plano com cobrança real agora; o novo plano começa quando o pagamento for confirmado.</Alert></div> : null}
        {access.status === 'canceled' && access.effectivePlan === 'free' ? <div className="mt-3"><Alert tone="info">Sua assinatura Pro terminou. Você está no Free e seus dados permanecem salvos.</Alert></div> : null}
        {!access.canWrite ? (
          <p className="mt-2 text-base text-rose-200">Novos registros estão bloqueados. Seus dados continuam disponíveis para consulta.</p>
        ) : null}
        {managedSubscription && access.effectiveStatus === 'active' && !access.cancelAtPeriodEnd && access.currentPeriodEnd ? <BillingCancelButton paidUntil={access.currentPeriodEnd} planName={activeName} /> : null}
        {managedSubscription && access.reason === 'canceled_until_period_end' && access.currentPeriodEnd ? <BillingReactivateButton planName={activeName} /> : null}
        {!checkoutAvailable ? <p className="mt-2 text-sm text-slate-400">A assinatura online está sendo preparada. O Free continua disponível.</p> : null}
      </Card>

      <SectionTitle>Escolha seu plano</SectionTitle>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><h2 className="text-xl font-semibold text-white">Free</h2><p className="mt-2 text-2xl font-bold text-white">R$ 0</p><p className="mt-3 text-sm text-slate-300">10 clientes · 20 comandos de voz/mês</p><p className="mt-2 text-sm text-slate-400">Disponível por tempo indeterminado.</p></Card>
        <Card><Badge tone="emerald">Mais recomendado</Badge><h2 className="mt-3 text-xl font-semibold text-white">Pro</h2><p className="mt-2 text-2xl font-bold text-white">{formatPrice(PAID_PLANS.pro.priceCents)}<span className="text-sm font-normal">/mês</span></p><p className="mt-3 text-sm text-slate-300">Clientes ilimitados · 300 comandos de voz/mês</p>
          {canSubscribe ? <BillingCheckoutButton plan="pro" label="Assinar Pro" /> : null}
          {canChange && access.effectivePlan === 'pro_plus' ? <BillingChangePlanButton plan="pro" label="Agendar mudança para Pro" /> : null}
        </Card>
        <Card><h2 className="text-xl font-semibold text-white">Pro Mais</h2><p className="mt-2 text-2xl font-bold text-white">{formatPrice(PAID_PLANS.pro_plus.priceCents)}<span className="text-sm font-normal">/mês</span></p><p className="mt-3 text-sm text-slate-300">Clientes ilimitados · 1.000 comandos de voz/mês</p><p className="mt-2 text-sm text-slate-400">Para uso intenso dos comandos de voz.</p>
          {canSubscribe ? <BillingCheckoutButton plan="pro_plus" label="Assinar Pro Mais" /> : null}
          {canChange && access.effectivePlan === 'pro' && billingSub?.price_cents !== 2450 && voicePercentage < 80 ? <BillingChangePlanButton plan="pro_plus" label="Fazer upgrade para Pro Mais" /> : null}
        </Card>
      </div>

      <SectionTitle>Seus dados</SectionTitle>
      <Card>
        <Row label="E-mail" value={profile.email} />
        <div className="mt-3">
          <ProfileForm fullName={profile.fullName} phone={profile.phone} businessName={profile.businessName} document={profile.document} address={profile.address} />
        </div>
      </Card>

      <SectionTitle>Alterar senha</SectionTitle>
      <Card>
        <PasswordForm />
      </Card>

      <div className="mt-8">
        <LogoutButton />
      </div>
    </div>
  );
}
