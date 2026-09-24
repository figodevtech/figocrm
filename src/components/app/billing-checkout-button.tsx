'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/layout';

export function BillingCheckoutButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-4 space-y-2">
    {error ? <Alert>{error}</Alert> : null}
    <Button className="w-full" loading={pending} onClick={() => startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const body = await response.json();
        if (!response.ok || !body.url) return setError(body.message || 'Não consegui abrir o pagamento.');
        window.location.assign(body.url);
      } catch {
        setError('Sem conexão com o pagamento. Tente de novo.');
      }
    })}>Assinar Pro por R$ 24,50/mês</Button>
  </div>;
}
