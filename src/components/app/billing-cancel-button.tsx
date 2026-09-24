'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';

export function BillingCancelButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-4 space-y-2">
    {error ? <Alert>{error}</Alert> : null}
    <Button variant="secondary" className="w-full" loading={pending} onClick={() => {
      if (!window.confirm('Cancelar a renovação do Pro? Você mantém o acesso até o fim do período pago.')) return;
      startTransition(async () => {
        setError(null);
        try {
          const response = await fetch('/api/billing/cancel', { method: 'POST' });
          if (!response.ok) {
            const body = await response.json();
            setError(body.message || 'Não consegui cancelar agora.');
            return;
          }
          router.refresh();
        } catch { setError('Sem conexão. Tente de novo.'); }
      });
    }}>Cancelar renovação</Button>
  </div>;
}
