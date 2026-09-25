'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export function BillingCancelButton({ paidUntil }: { paidUntil: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/billing/cancel', { method: 'POST' });
        const body = await response.json();
        if (!response.ok || !body.canceled) {
          setError(body.message || 'Não consegui cancelar agora. Tente novamente.');
          return;
        }
        dialog.current?.close();
        router.refresh();
      } catch {
        setError('Sem conexão com o pagamento. Tente novamente.');
      }
    });
  }

  return <div className="mt-4">
    <Button variant="secondary" className="w-full" onClick={() => {
      setError(null);
      dialog.current?.showModal();
    }}>Cancelar renovação</Button>
    <dialog
      ref={dialog}
      aria-labelledby="cancel-plan-title"
      aria-describedby="cancel-plan-description"
      onCancel={(event) => { if (pending) event.preventDefault(); }}
      className="fixed inset-0 m-auto w-[min(32rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 text-slate-100 shadow-2xl backdrop:bg-slate-950/80"
    >
      <h2 id="cancel-plan-title" className="text-xl font-bold">Cancelar a renovação do Pro?</h2>
      <p id="cancel-plan-description" className="mt-3 text-base text-slate-300">
        Seu Pro continua disponível até <strong className="text-white">{formatDate(paidUntil)}</strong>.
        Depois, sua conta passa ao Free e seus dados permanecem salvos.
        Não haverá outra cobrança; a mensalidade já paga não é estornada por este cancelamento.
      </p>
      {error ? <div className="mt-4"><Alert>{error}</Alert></div> : null}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={pending} onClick={() => dialog.current?.close()}>Manter meu Pro</Button>
        <Button variant="danger" loading={pending} onClick={cancel}>Confirmar cancelamento</Button>
      </div>
    </dialog>
  </div>;
}
