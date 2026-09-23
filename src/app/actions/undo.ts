// src/app/actions/undo.ts
// "Desfazer" a última operação — sempre por operação compensatória auditada, nunca apagando registros.
//   pagamento / abatimento → reverse_settlement (estorno idempotente, histórico preservado)
//   mudança de vencimento  → reschedule_installment de volta para a data anterior
//   negócio / renegociação → ainda sem estorno automático (avisa em vez de fingir que desfez)
'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { reverseAndDescribe } from '@/lib/ai/orchestrator';
import { rescheduleInstallment } from '@/lib/domain/financial-operations';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';

const UNDOABLE = ['REGISTER_PAYMENT', 'REGISTER_ADJUSTMENT', 'UPDATE_DUE_DATE', 'EXECUTE_DEAL_TRANSACTION_ATOMIC', 'RENEGOTIATE_INSTALLMENTS', 'REVERSE_SETTLEMENT'];

export async function undoLastAction(): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: '', error: 'Não autenticado.' };

    const access = await getSubscriptionAccess(supabase);
    if (!access.canWrite) return { success: false, message: writeDeniedMessage(access.reason) };

    const { data: lastLog } = await supabase
      .from('audit_log')
      .select('action_type, entity_name, entity_id, payload_before')
      .eq('user_id', user.id)
      .in('action_type', UNDOABLE)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastLog) return { success: false, message: 'Nenhuma ação recente para desfazer.' };

    switch (lastLog.action_type) {
      case 'REGISTER_PAYMENT':
      case 'REGISTER_ADJUSTMENT': {
        if (lastLog.entity_name !== 'settlements') {
          return { success: false, message: 'Esse lançamento é antigo e precisa ser corrigido manualmente.' };
        }
        const outcome = await reverseAndDescribe(supabase, lastLog.entity_id, undefined, 'Desfazer última ação', 'manual');
        return { success: outcome.success, message: outcome.humanResponse };
      }
      case 'UPDATE_DUE_DATE': {
        const previous = (lastLog.payload_before as { due_date?: string } | null)?.due_date;
        if (!previous) return { success: false, message: 'Não sei a data anterior desse vencimento.' };
        const res = await rescheduleInstallment(supabase, { installmentId: lastLog.entity_id, newDueDate: previous, source: 'manual', reason: 'Desfazer mudança de vencimento' });
        return res.success ? { success: true, message: 'Pronto. O vencimento voltou para a data anterior.' } : { success: false, message: 'Não consegui desfazer a mudança de vencimento.' };
      }
      case 'REVERSE_SETTLEMENT':
        return { success: false, message: 'A última ação já foi um estorno.' };
      default:
        return { success: false, message: 'Desfazer negócio ou renegociação ainda precisa ser feito manualmente.' };
    }
  } catch (err: unknown) {
    return { success: false, message: '', error: err instanceof Error ? err.message : 'Erro ao desfazer ação.' };
  }
}
