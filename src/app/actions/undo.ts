// src/app/actions/undo.ts
// Ações do Sistema: Reversibilidade Operacional e Função "Desfazer" (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';

export async function undoLastAction(): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, message: '', error: 'Não autenticado.' };
    }

    // Busca a última ação no audit_log
    const { data: lastLog } = await supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', user.id)
      .neq('action_type', 'UNDO')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastLog) {
      return { success: false, message: 'Nenhuma ação recente para desfazer.' };
    }

    const { action_type, entity_name, entity_id, payload_before } = lastLog;

    switch (action_type) {
      case 'CREATE_SALE': {
        // Estorna a venda: marca o negócio como cancelado, devolve o item pro estoque e cancela parcelas
        await supabase.from('deals').update({ status: 'cancelada' }).eq('id', entity_id);

        const { data: dealItems } = await supabase.from('deal_items').select('item_id').eq('deal_id', entity_id);
        if (dealItems) {
          for (const di of dealItems) {
            await supabase.from('items').update({ status: 'disponivel' }).eq('id', di.item_id);
          }
        }

        await supabase.from('receivables').update({ status: 'canceled' }).eq('deal_id', entity_id);
        await supabase.from('cash_movements').delete().eq('deal_id', entity_id);
        break;
      }

      case 'REGISTER_PAYMENT': {
        // Liquidações da RPC apply_obligation_settlement (payload com allocations) ainda não têm
        // estorno automático: nunca responder "desfeito" sem ter desfeito nada.
        if (!lastLog.payload_after?.payment?.installment_id) {
          return { success: false, message: 'Estorno de recebimento ainda precisa ser feito manualmente.' };
        }
        // Estorna o pagamento legado: remove o pagamento e devolve o saldo da parcela
        {
          const instId = lastLog.payload_after.payment.installment_id;
          const instBefore = lastLog.payload_after.installmentBefore;

          if (instBefore) {
            await supabase
              .from('installments')
              .update({
                paid_value: instBefore.paid_value,
                balance: instBefore.balance,
                status: instBefore.status,
              })
              .eq('id', instId);
          }
          await supabase.from('payments').delete().eq('id', entity_id);
        }
        break;
      }

      case 'UPDATE_DUE_DATE': {
        if (payload_before?.due_date) {
          await supabase
            .from('installments')
            .update({
              due_date: payload_before.due_date,
              status: payload_before.status,
            })
            .eq('id', entity_id);
        }
        break;
      }

      default:
        return { success: false, message: `Ação do tipo ${action_type} requer intervenção manual.` };
    }

    // Registra o evento de Undo no audit_log
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: entity_name,
      entity_id: entity_id,
      action_type: 'UNDO',
      source: 'MANUAL_WEB',
      payload_after: { undone_action: action_type, undone_id: entity_id },
    });

    return { success: true, message: 'Operação desfeita com sucesso!' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao desfazer ação.';
    return { success: false, message: '', error: message };
  }
}
