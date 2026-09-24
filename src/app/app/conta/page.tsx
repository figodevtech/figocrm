import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { getProfile } from '@/lib/domain/app-data';
import { getSubscriptionAccess, MONTHLY_SUBSCRIPTION_FEE } from '@/lib/subscription';
import { formatDate } from '@/lib/format';
import { LogoutButton, PasswordForm, ProfileForm } from '@/components/app/account-forms';
import { Badge, Card, PageHeader, Row, SectionTitle } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Conta' };

function planLabel(effective: string): { label: string; tone: 'emerald' | 'amber' | 'rose' | 'sky' } {
  switch (effective) {
    case 'trialing':
      return { label: 'Teste gratuito', tone: 'sky' };
    case 'active':
      return { label: 'Ativo', tone: 'emerald' };
    case 'past_due':
      return { label: 'Pagamento pendente', tone: 'amber' };
    case 'canceled':
      return { label: 'Cancelado (até o fim do período)', tone: 'amber' };
    default:
      return { label: 'Vencido', tone: 'rose' };
  }
}

export default async function AccountPage() {
  const { supabase, user } = await requireSession();
  const [profile, access] = await Promise.all([getProfile(supabase, user.id, user.email ?? ''), getSubscriptionAccess(supabase)]);
  const plan = planLabel(access.effectiveStatus);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Conta" back="/app" />

      <SectionTitle>Plano</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold text-white">FigoCRM · {MONTHLY_SUBSCRIPTION_FEE}</p>
          <Badge tone={plan.tone}>{plan.label}</Badge>
        </div>
        {access.effectiveStatus === 'trialing' ? (
          <Row label="Dias restantes" value={`${access.trialDaysRemaining} ${access.trialDaysRemaining === 1 ? 'dia' : 'dias'}`} strong tone="sky" />
        ) : null}
        {access.trialEndsAt && access.effectiveStatus === 'trialing' ? <Row label="Teste termina em" value={formatDate(access.trialEndsAt)} /> : null}
        {access.currentPeriodEnd && access.effectiveStatus !== 'trialing' ? <Row label="Período atual até" value={formatDate(access.currentPeriodEnd)} /> : null}
        {!access.canWrite ? (
          <p className="mt-2 text-base text-rose-200">Novos registros estão bloqueados. Seus dados continuam disponíveis para consulta.</p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">A assinatura on-line estará disponível em breve.</p>
      </Card>

      <SectionTitle>Seus dados</SectionTitle>
      <Card>
        <Row label="E-mail" value={profile.email} />
        <div className="mt-3">
          <ProfileForm fullName={profile.fullName} phone={profile.phone} businessName={profile.businessName} />
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
