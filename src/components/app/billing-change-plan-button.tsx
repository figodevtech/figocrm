'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/layout';
import type { PaidPlan } from '@/lib/billing/types';

export function BillingChangePlanButton({ plan, label }: { plan: PaidPlan; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div className="mt-4 space-y-2">
    {error ? <Alert>{error}</Alert> : null}
    <Button className="w-full" loading={pending} onClick={() => startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/billing/change-plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.message || 'Não consegui agendar a mudança de plano.');
        router.refresh();
      } catch { setError('Sem conexão. Tente de novo.'); }
    })}>{label}</Button>
  </div>;
}
