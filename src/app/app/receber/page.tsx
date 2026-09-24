import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { listCustomerOptions, listOpenDebts } from '@/lib/domain/app-data';
import { todayISO } from '@/lib/domain/loan-plan';
import { ReceiveFlow } from '@/components/app/receive-flow';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Receber pagamento' };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ cliente?: string; divida?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ cliente, divida }, customers] = await Promise.all([searchParams, listCustomerOptions(supabase, user.id)]);
  const customer = cliente ? customers.find((c) => c.id === cliente) ?? null : null;
  const debts = customer ? await listOpenDebts(supabase, user.id, customer.id) : [];

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Receber pagamento" back={customer ? `/app/clientes/${customer.id}` : '/app'} />
      {/* key: trocar de cliente reinicia o fluxo */}
      <ReceiveFlow
        key={`${customer?.id ?? 'none'}:${divida ?? ''}`}
        customers={customers}
        customer={customer ? { id: customer.id, name: customer.name } : null}
        debts={debts}
        initialDebtId={divida}
        today={todayISO()}
      />
    </div>
  );
}
