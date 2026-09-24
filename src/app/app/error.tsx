'use client';
// Falha ao carregar uma tela: mensagem simples e tentar de novo (nada foi gravado por uma leitura).
import { EmptyState } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="Não consegui carregar esta tela." text="Verifique a internet e tente de novo.">
      <Button onClick={reset}>Tentar de novo</Button>
      <ButtonLink href="/app" variant="secondary">
        Início
      </ButtonLink>
    </EmptyState>
  );
}
