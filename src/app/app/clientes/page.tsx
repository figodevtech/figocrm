import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listCustomers } from '@/lib/domain/app-data';
import { CustomerList } from '@/components/app/customer-list';
import { EmptyState, PageHeader } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Clientes' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ filtro }, customers] = await Promise.all([searchParams, listCustomers(supabase, user.id)]);
  const initialFilter = filtro === 'atrasados' ? 'atrasados' : filtro === 'devendo' ? 'devendo' : 'todos';

  return (
    <div>
      <PageHeader
        title="Clientes"
        back="/app"
        action={
          <ButtonLink href="/app/clientes/novo" size="sm">
            <Plus className="h-5 w-5" aria-hidden /> Novo
          </ButtonLink>
        }
      />
      {customers.length === 0 ? (
        <EmptyState title="Nenhum cliente ainda." text="Cadastre seu primeiro cliente ou fale:" example="Vendi o iPhone 13 pro Carlos por 3 mil.">
          <ButtonLink href="/app/clientes/novo">Cadastrar</ButtonLink>
          <VoiceButton />
        </EmptyState>
      ) : (
        <CustomerList customers={customers} initialFilter={initialFilter} />
      )}
    </div>
  );
}
