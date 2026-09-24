// src/app/actions/loans.ts
// Empréstimo manual: o formulário monta a entrada e o domínio calcula, confere e grava
// pela RPC atômica create_loan_contract — o mesmo caminho do "emprestei ..." por voz.
'use server';

import { actionSession, NOT_AUTHENTICATED } from '@/lib/auth/session';
import { createLoanContract, CreateLoanInput } from '@/lib/domain/loans';

export type CreateLoanFormInput = Omit<CreateLoanInput, 'source'>;

export async function createLoanAction(
  input: CreateLoanFormInput
): Promise<{ ok: true; loanContractId: string; alreadyExecuted: boolean } | { ok: false; error: string }> {
  const session = await actionSession();
  if (!session) return { ok: false, error: NOT_AUTHENTICATED };
  const res = await createLoanContract(session.supabase, { ...input, source: 'manual' });
  if (!res.success || !res.loanContractId) return { ok: false, error: res.error ?? 'Não consegui salvar o empréstimo.' };
  return { ok: true, loanContractId: res.loanContractId, alreadyExecuted: !!res.alreadyExecuted };
}
