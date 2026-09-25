'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Atualiza a tela quando o webhook financeiro confirmar o pagamento. */
export function BillingStatusRefresh() {
  const router = useRouter();

  useEffect(() => {
    let checks = 0;
    const timer = window.setInterval(async () => {
      checks += 1;
      if (checks >= 20) window.clearInterval(timer);
      try {
        const response = await fetch('/api/billing/status', { cache: 'no-store' });
        if (!response.ok) return;
        const status = await response.json();
        if (status.status === 'active' && (status.effectivePlan === 'pro' || status.effectivePlan === 'pro_plus')) {
          window.clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Uma falha transitória de rede não altera o plano; a próxima consulta tenta de novo.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
