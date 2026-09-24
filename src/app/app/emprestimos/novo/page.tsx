import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { listCustomerOptions } from '@/lib/domain/app-data';
import { todayISO } from '@/lib/domain/loan-plan';
import { LoanForm } from '@/components/app/loan-form';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Novo empréstimo' };

export default async function NewLoanPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ cliente }, customers] = await Promise.all([searchParams, listCustomerOptions(supabase, user.id)]);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Emprestar dinheiro" back="/app" />
      <LoanForm customers={customers} today={todayISO()} initialCustomerId={cliente} />
    </div>
  );
}
