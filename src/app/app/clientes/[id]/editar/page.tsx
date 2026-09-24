import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { CustomerForm } from '@/components/app/customer-form';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Editar cliente' };

export default async function EditCustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmar?: string }> }) {
  const [{ id }, { confirmar }] = await Promise.all([params, searchParams]);
  const { supabase, user } = await requireSession();
  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, phone, document, address, notes, is_provisional')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!customer) notFound();
  const confirm = confirmar === '1' && customer.is_provisional;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={confirm ? 'Transformar em cliente' : 'Editar cliente'} back={`/app/clientes/${id}`} subtitle={confirm ? 'Confira o nome e complete o que souber.' : undefined} />
      <CustomerForm initial={customer} confirmProvisional={confirm} />
    </div>
  );
}
