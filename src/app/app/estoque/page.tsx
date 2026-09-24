import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listStock } from '@/lib/domain/app-data';
import { formatBRL } from '@/lib/format';
import { StockList } from '@/components/app/stock-list';
import { EmptyState, PageHeader } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Estoque' };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const { supabase, user } = await requireSession();
  const [{ filtro }, items] = await Promise.all([searchParams, listStock(supabase, user.id)]);
  const inStock = items.filter((i) => ['disponivel', 'reservado', 'em_preparacao'].includes(i.status));
  const totalCost = inStock.reduce((acc, i) => acc + i.totalCost, 0);

  return (
    <div>
      <PageHeader
        title="Estoque"
        back="/app"
        subtitle={items.length > 0 ? `${inStock.length} em estoque · ${formatBRL(totalCost)} em mercadoria` : undefined}
        action={
          <ButtonLink href="/app/estoque/novo" size="sm">
            <Plus className="h-5 w-5" aria-hidden /> Nova
          </ButtonLink>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Nenhuma mercadoria ainda." text="Cadastre sua primeira mercadoria ou fale:" example="Comprei um iPhone 13 por dois mil.">
          <ButtonLink href="/app/estoque/novo">Cadastrar</ButtonLink>
          <VoiceButton />
        </EmptyState>
      ) : (
        <StockList items={items} initialFilter={filtro === 'revisar' ? 'revisar' : 'disponiveis'} />
      )}
    </div>
  );
}
