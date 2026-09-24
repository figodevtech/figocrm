import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { listAvailableItemOptions, listCustomerOptions } from '@/lib/domain/app-data';
import { todayISO } from '@/lib/domain/loan-plan';
import { SaleWizard } from '@/components/app/sale-wizard';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Nova venda' };

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ cliente?: string; item?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ cliente, item }, customers, items] = await Promise.all([
    searchParams,
    listCustomerOptions(supabase, user.id),
    listAvailableItemOptions(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Nova venda" back="/app" />
      <SaleWizard customers={customers} items={items} today={todayISO()} initialCustomerId={cliente} initialItemId={item} />
    </div>
  );
}
