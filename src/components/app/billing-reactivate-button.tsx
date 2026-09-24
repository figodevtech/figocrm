'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';

export function BillingReactivateButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-4 space-y-2">
    {error ? <Alert>{error}</Alert> : null}
    <Button className="w-full" loading={pending} onClick={() => startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/billing/reactivate', { method: 'POST' });
        if (!response.ok) {
          const body = await response.json();
          setError(body.message || 'Não consegui reativar agora.');
          return;
        }
        router.refresh();
      } catch { setError('Sem conexão. Tente de novo.'); }
    })}>Reativar renovação do Pro</Button>
  </div>;
}
