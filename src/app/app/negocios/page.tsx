import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { listDeals } from '@/lib/domain/app-data';
import { DealsList } from '@/components/app/deals-list';
import { EmptyState, PageHeader } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Negócios' };

export default async function DealsPage() {
  const { supabase, user } = await requireSession();
  const deals = await listDeals(supabase, user.id);
  return (
    <div>
      <PageHeader title="Negócios" back="/app" />
      {deals.length === 0 ? (
        <EmptyState title="Nenhum negócio ainda." text="Registre uma venda ou troca, ou fale:" example="Vendi o iPhone 13 pro João por 3 mil no Pix.">
          <ButtonLink href="/app/vendas/nova">Nova venda</ButtonLink>
          <ButtonLink href="/app/trocas/nova" variant="secondary">
            Nova troca
          </ButtonLink>
          <VoiceButton />
        </EmptyState>
      ) : (
        <DealsList deals={deals} />
      )}
    </div>
  );
}
