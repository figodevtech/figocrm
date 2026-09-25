import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { getProfile } from '@/lib/domain/app-data';
import { getSubscriptionAccess, MONTHLY_SUBSCRIPTION_FEE } from '@/lib/subscription';
import { formatDate } from '@/lib/format';
import { getBillingProvider } from '@/lib/billing/registry';
import { createAdminClient } from '@/lib/supabase/admin';
import { BillingCheckoutButton } from '@/components/app/billing-checkout-button';
import { BillingCancelButton } from '@/components/app/billing-cancel-button';
import { BillingReactivateButton } from '@/components/app/billing-reactivate-button';
import { BillingStatusRefresh } from '@/components/app/billing-status-refresh';
import { LogoutButton, PasswordForm, ProfileForm } from '@/components/app/account-forms';
import { Badge, Card, PageHeader, Row, SectionTitle } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Conta' };

function planLabel(effective: string): { label: string; tone: 'emerald' | 'amber' | 'rose' | 'sky' } {
  switch (effective) {
    case 'trialing':
      return { label: 'Teste gratuito', tone: 'sky' };
    case 'active':
      return { label: 'Plano Pro', tone: 'emerald' };
    case 'past_due':
      return { label: 'Pagamento pendente', tone: 'amber' };
    case 'canceled':
      return { label: 'Cancelado (até o fim do período)', tone: 'amber' };
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
    supabase.from('subscriptions').select('provider, provider_subscription_id').eq('user_id', user.id).maybeSingle(),
  ]);
  const plan = access.effectivePlan === 'free' ? { label: 'Free', tone: 'sky' as const } : planLabel(access.effectiveStatus);
  const provider = getBillingProvider();
  const admin = createAdminClient();
  const checkoutAvailable = provider !== null && admin !== null;
  let paidCheckout = false;
  let checkoutLookupFailed = false;
  if (provider && admin && access.status === 'trialing') {
    const { data, error } = await admin.from('billing_checkout_sessions').select('id')
      .eq('user_id', user.id).eq('provider', provider.name).eq('status', 'paid')
      .limit(1).maybeSingle();
    paidCheckout = !!data;
    checkoutLookupFailed = !!error;
  }
  const managedSubscription = !!(provider && billingSub?.provider === provider.name && billingSub.provider_subscription_id);
  const canSubscribe = checkoutAvailable && !paidCheckout && !checkoutLookupFailed
    && (access.effectiveStatus === 'trialing' || (access.effectiveStatus !== 'active' && access.effectivePlan !== 'pro'));

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Conta" back="/app" />

      <SectionTitle>Plano</SectionTitle>
      <Card>
        {paidCheckout ? <p className="mb-3 rounded-xl bg-sky-400/10 p-3 text-sm text-sky-100">Assinatura cadastrada no Asaas. A primeira cobrança ainda está pendente. O Plano Pro pago começa assim que o pagamento for confirmado. Você não precisa assinar novamente.</p> : null}
        {checkout === 'retorno' && !paidCheckout && access.effectiveStatus === 'active' ? <p className="mb-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-100">Pagamento confirmado. Seu Pro está ativo.</p> : null}
        {checkout === 'retorno' && !paidCheckout && access.effectiveStatus !== 'active' ? <p className="mb-3 rounded-xl bg-sky-400/10 p-3 text-sm text-sky-100">Retorno do checkout recebido. Estamos conferindo o pagamento com o Asaas.</p> : null}
        {(checkout === 'retorno' || paidCheckout) && access.effectiveStatus !== 'active' ? <BillingStatusRefresh /> : null}
        {checkoutLookupFailed ? <p className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">Não consegui verificar sua assinatura agora. Atualize a página em instantes.</p> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold text-white">FigoCRM {access.effectivePlan === 'pro' ? 'Pro' : 'Free'}</p>
          <Badge tone={plan.tone}>{plan.label}</Badge>
        </div>
        {access.effectiveStatus === 'trialing' ? (
          <Row label="Dias restantes" value={`${access.trialDaysRemaining} ${access.trialDaysRemaining === 1 ? 'dia' : 'dias'}`} strong tone="sky" />
        ) : null}
        {access.trialEndsAt && access.effectiveStatus === 'trialing' ? <Row label="Teste termina em" value={formatDate(access.trialEndsAt)} /> : null}
        {access.effectiveStatus === 'trialing' ? <p className="mt-3 text-sm text-slate-300">{paidCheckout ? 'Quando a primeira cobrança for confirmada, o teste acaba e sua mensalidade Pro começa naquele dia.' : 'Ao assinar, a primeira mensalidade é cobrada agora e o teste acaba quando o pagamento for confirmado. Sem assinatura, você continua no Free depois do teste.'}</p> : null}
        {access.currentPeriodEnd && access.effectiveStatus !== 'trialing' ? <Row label={access.effectiveStatus === 'active' ? 'Próxima renovação' : 'Período pago até'} value={formatDate(access.currentPeriodEnd)} /> : null}
        <Row label="Clientes" value={access.customerLimit === null ? `${access.customerCount} · ilimitados` : `${access.customerCount} / ${access.customerLimit}`} />
        <Row label="Comandos de voz neste mês" value={access.effectivePlan === 'free' ? `${access.voiceUsedThisMonth} / ${access.voiceMonthlyLimit}` : `${access.voiceUsedThisMonth}`} />
        {access.effectivePlan === 'free' ? <p className="mt-3 text-sm text-slate-300">O Free continua sem prazo: até {access.customerLimit} clientes e {access.voiceMonthlyLimit} comandos de voz por mês. O Pro custa {MONTHLY_SUBSCRIPTION_FEE}, com clientes ilimitados.</p> : null}
        {access.cancelAtPeriodEnd ? <p className="mt-3 text-sm text-amber-200">A renovação foi cancelada. O Pro fica disponível até o fim do período pago; depois você continua no Free.</p> : null}
        {!access.canWrite ? (
          <p className="mt-2 text-base text-rose-200">Novos registros estão bloqueados. Seus dados continuam disponíveis para consulta.</p>
        ) : null}
        {canSubscribe ? <BillingCheckoutButton /> : null}
        {managedSubscription && access.effectiveStatus === 'active' && !access.cancelAtPeriodEnd ? <BillingCancelButton /> : null}
        {managedSubscription && access.effectiveStatus === 'canceled' && access.currentPeriodEnd ? <BillingReactivateButton /> : null}
        {!checkoutAvailable ? <p className="mt-2 text-sm text-slate-400">A assinatura online está sendo preparada. O Free continua disponível.</p> : null}
      </Card>

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
