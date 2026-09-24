'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { issueLoanDocumentAction } from '@/app/actions/loan-documents';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/layout';

export function LoanDocumentActions({ loanId, issued, canIssue, version }: { loanId: string; issued: boolean; canIssue: boolean; version?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="space-y-2 print:hidden">
    {error ? <Alert>{error}</Alert> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={!canIssue} loading={pending} onClick={() => startTransition(async () => {
        setError(null);
        const result = await issueLoanDocumentAction(loanId);
        if (!result.ok) return setError(result.error);
        router.refresh();
      })}>{issued ? 'Reemitir após alteração' : 'Emitir contrato'}</Button>
      {issued ? <>
        <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
        <a href={`/app/emprestimos/${loanId}/contrato/pdf${version ? `?version=${version}` : ''}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-500 px-4 font-semibold text-emerald-950">Gerar PDF</a>
      </> : null}
    </div>
  </div>;
}
