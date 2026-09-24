import { EmptyState } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <EmptyState title="Não encontrei isso." text="Pode ter sido removido ou o link está errado.">
      <ButtonLink href="/app">Voltar ao início</ButtonLink>
    </EmptyState>
  );
}
