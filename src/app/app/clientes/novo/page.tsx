import type { Metadata } from 'next';
import { CustomerForm } from '@/components/app/customer-form';
import { PageHeader } from '@/components/ui/layout';
import { safeNextPath } from '@/lib/auth/redirects';
import { requireSession } from '@/lib/auth/session';
import { getSubscriptionAccess } from '@/lib/subscription';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const [{ voltar }, { supabase }] = await Promise.all([searchParams, requireSession()]);
  const returnTo = voltar ? safeNextPath(voltar, '') || undefined : undefined;
  const access = await getSubscriptionAccess(supabase);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Novo cliente" back={returnTo ?? '/app'} />
      {access.effectivePlan === 'free' && !access.canCreateCustomer ? <div className="space-y-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-slate-100">
        <p>Você usou os {access.customerLimit} clientes do Free, incluindo avulsos. Seus clientes atuais continuam disponíveis.</p>
        <ButtonLink href="/app/conta">Conhecer o Pro</ButtonLink>
      </div> : <CustomerForm returnTo={returnTo} />}
    </div>
  );
}
