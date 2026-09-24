import type { Metadata } from 'next';
import { CustomerForm } from '@/components/app/customer-form';
import { PageHeader } from '@/components/ui/layout';
import { safeNextPath } from '@/lib/auth/redirects';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar } = await searchParams;
  const returnTo = voltar ? safeNextPath(voltar, '') || undefined : undefined;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Novo cliente" back={returnTo ?? '/app'} />
      <CustomerForm returnTo={returnTo} />
    </div>
  );
}
