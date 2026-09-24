// Layout autenticado: sessão obrigatória (o proxy já redireciona; aqui é a segunda barreira)
// e estado da assinatura para o aviso de teste/bloqueio.
import type { ReactNode } from 'react';
import { requireSession } from '@/lib/auth/session';
import { getSubscriptionAccess } from '@/lib/subscription';
import { AppShell } from '@/components/app/app-shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase } = await requireSession();
  const access = await getSubscriptionAccess(supabase);

  return (
    <AppShell
      access={{
        // Falha ao consultar a assinatura não deve assustar com banner: o banco segue fail-closed na escrita
        canWrite: access.canWrite || access.reason === 'billing_unavailable',
        trialing: access.effectiveStatus === 'trialing',
        trialDaysRemaining: access.trialDaysRemaining,
      }}
    >
      {children}
    </AppShell>
  );
}
