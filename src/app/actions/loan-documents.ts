'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';

export async function issueLoanDocumentAction(loanId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Entre na sua conta para emitir o contrato.' };
  try {
    await assertWritePermission(user.id, supabase);
    const { data, error } = await supabase.rpc('issue_loan_document', { p_loan_id: loanId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, version: Number(data.version) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Não consegui emitir o contrato.' };
  }
}
