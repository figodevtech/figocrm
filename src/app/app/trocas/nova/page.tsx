import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { listAvailableItemOptions, listCustomerOptions } from '@/lib/domain/app-data';
import { todayISO } from '@/lib/domain/loan-plan';
import { TradeWizard } from '@/components/app/trade-wizard';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Nova troca' };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ cliente }, customers, items] = await Promise.all([searchParams, listCustomerOptions(supabase, user.id), listAvailableItemOptions(supabase, user.id)]);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Nova troca" back="/app" />
      <TradeWizard customers={customers} items={items} today={todayISO()} initialCustomerId={cliente} />
    </div>
  );
}
