import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { CustomerForm } from '@/components/app/customer-form';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Editar cliente' };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireSession();
  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, phone, document, address, notes')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Editar cliente" back={`/app/clientes/${id}`} />
      <CustomerForm initial={customer} />
    </div>
  );
}
