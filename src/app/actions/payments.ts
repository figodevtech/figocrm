// src/app/actions/payments.ts
// Ações do Sistema: Recebimentos, Parciais, Abatimentos e Renegociações (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { PaymentMethod, AdjustmentType } from '@/types/domain';

export async function registerPaymentAction(input: {
  installmentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Não autenticado.' };
    }

    await assertWritePermission(user.id);

    if (input.amount <= 0) {
      return { success: false, error: 'O valor do pagamento deve ser maior que zero.' };
    }

    // Busca a parcela e valida ownership
    const { data: installment, error: instError } = await supabase
      .from('installments')
      .select('*, receivables(*)')
      .eq('id', input.installmentId)
      .eq('user_id', user.id)
      .single();

    if (instError || !installment) {
      return { success: false, error: 'Parcela não encontrada.' };
    }

    if (installment.status === 'paid') {
      return { success: false, error: 'Esta parcela já se encontra integralmente quitada.' };
    }

    // Registra pagamento (o trigger no PostgreSQL concilia saldo automaticamente)
    const { data: payment, error: payError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        installment_id: installment.id,
        amount: input.amount,
        payment_method: input.paymentMethod,
        notes: input.notes || null,
        payment_date: new Date().toISOString().split('T')[0],
      })
      .select('*')
      .single();

    if (payError || !payment) {
      return { success: false, error: payError?.message || 'Erro ao registrar pagamento.' };
    }

    // Registra fluxo de caixa imediato
    await supabase.from('cash_movements').insert({
      user_id: user.id,
      deal_id: installment.receivables?.deal_id || null,
      direction: 'IN',
      amount: input.amount,
      payment_method: input.paymentMethod,
      description: `Recebimento da parcela ${installment.installment_number}/${installment.total_installments}`,
    });

    // Auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'payments',
      entity_id: payment.id,
      action_type: 'REGISTER_PAYMENT',
      source: 'MANUAL_WEB',
      payload_after: { payment, installmentBefore: installment },
    });

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar recebimento.';
    return { success: false, error: message };
  }
}

export async function registerAdjustmentAction(input: {
  dealId?: string;
  installmentId?: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  counterItem?: {
    name: string;
    evaluatedValue: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Não autenticado.' };
    }

    await assertWritePermission(user.id);

    let counterItemId = null;
    // Se o abatimento for mediante entrega de mercadoria (dação em pagamento)
    if (input.adjustmentType === 'item_trade_in' && input.counterItem) {
      const { data: newItem } = await supabase
        .from('items')
        .insert({
          user_id: user.id,
          name: input.counterItem.name,
          acquisition_cost: input.counterItem.evaluatedValue,
          status: 'disponivel',
          description: `Item absorvido como abatimento de dívida`,
        })
        .select('id')
        .single();

      if (newItem) {
        counterItemId = newItem.id;
      }
    }

    const { data: adjustment, error } = await supabase
      .from('adjustments')
      .insert({
        user_id: user.id,
        deal_id: input.dealId || null,
        installment_id: input.installmentId || null,
        counter_item_id: counterItemId,
        adjustment_type: input.adjustmentType,
        amount: input.amount,
        reason: input.reason,
      })
      .select('*')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Se estiver atrelado a uma parcela, abate o saldo sem transitar caixa
    if (input.installmentId) {
      const { data: inst } = await supabase.from('installments').select('*').eq('id', input.installmentId).single();
      if (inst) {
        const newBalance = Math.max(0, inst.balance - input.amount);
        await supabase
          .from('installments')
          .update({
            balance: newBalance,
            status: newBalance === 0 ? 'paid' : 'partially_paid',
            updated_at: new Date().toISOString(),
          })
          .eq('id', inst.id);
      }
    }

    // Auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'adjustments',
      entity_id: adjustment.id,
      action_type: 'REGISTER_ADJUSTMENT',
      source: 'MANUAL_WEB',
      payload_after: adjustment,
    });

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar abatimento.';
    return { success: false, error: message };
  }
}

export async function updateDueDateAction(input: {
  installmentId: string;
  newDueDate: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Não autenticado.' };
    }

    await assertWritePermission(user.id);

    const { data: inst } = await supabase
      .from('installments')
      .select('*')
      .eq('id', input.installmentId)
      .eq('user_id', user.id)
      .single();

    if (!inst) {
      return { success: false, error: 'Parcela não encontrada.' };
    }

    const isFuture = new Date(input.newDueDate) >= new Date();
    const newStatus = isFuture && inst.status === 'overdue' ? 'pending' : inst.status;

    await supabase
      .from('installments')
      .update({
        due_date: input.newDueDate,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inst.id);

    // Auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'installments',
      entity_id: inst.id,
      action_type: 'UPDATE_DUE_DATE',
      source: 'MANUAL_WEB',
      payload_before: { due_date: inst.due_date, status: inst.status },
      payload_after: { due_date: input.newDueDate, status: newStatus },
    });

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao alterar vencimento.';
    return { success: false, error: message };
  }
}
