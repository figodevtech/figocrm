// src/app/actions/payments.ts
// Ações do Sistema: Recebimentos, Parciais, Abatimentos e Renegociações (Fase 7)
// Todas as alterações de saldo passam pelas RPCs atômicas (apply_obligation_settlement /
// reschedule_installment): o histórico fica em payments/adjustments/audit_log e o saldo é
// recalculado pelo banco, nunca "na mão".
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { applySettlement, rescheduleInstallment } from '@/lib/domain/financial-operations';
import { PaymentMethod, AdjustmentType } from '@/types/domain';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  await assertWritePermission(user.id, supabase);
  return { supabase, user };
}

async function installmentObligation(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, installmentId: string) {
  const { data } = await supabase
    .from('installments')
    .select('id, receivable_id, payable_id')
    .eq('id', installmentId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function registerPaymentAction(input: {
  installmentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await authenticatedClient();
    if (!auth) return { success: false, error: 'Não autenticado.' };

    if (input.amount <= 0) {
      return { success: false, error: 'O valor do pagamento deve ser maior que zero.' };
    }

    const inst = await installmentObligation(auth.supabase, auth.user.id, input.installmentId);
    if (!inst) return { success: false, error: 'Parcela não encontrada.' };

    const res = await applySettlement(auth.supabase, {
      kind: 'payment',
      receivableId: inst.receivable_id ?? undefined,
      payableId: inst.payable_id ?? undefined,
      installmentId: inst.id,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      reason: input.notes,
      source: 'manual',
    });
    return res.success ? { success: true } : { success: false, error: res.error };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao processar recebimento.' };
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
    const auth = await authenticatedClient();
    if (!auth) return { success: false, error: 'Não autenticado.' };
    const { supabase, user } = auth;

    let receivableId: string | undefined;
    let payableId: string | undefined;
    if (input.installmentId) {
      const inst = await installmentObligation(supabase, user.id, input.installmentId);
      if (!inst) return { success: false, error: 'Parcela não encontrada.' };
      receivableId = inst.receivable_id ?? undefined;
      payableId = inst.payable_id ?? undefined;
    } else if (input.dealId) {
      const { data: recs } = await supabase
        .from('receivables')
        .select('id')
        .eq('user_id', user.id)
        .eq('deal_id', input.dealId)
        .in('status', ['pending', 'partially_paid']);
      if (!recs || recs.length !== 1) {
        return { success: false, error: 'Informe a parcela: a negociação não tem exatamente uma dívida em aberto.' };
      }
      receivableId = recs[0].id;
    } else {
      return { success: false, error: 'Informe a negociação ou a parcela do abatimento.' };
    }

    // Dação em pagamento: a mercadoria recebida entra no estoque (sem movimento de caixa)
    if (input.adjustmentType === 'item_trade_in' && input.counterItem) {
      const { error: itemError } = await supabase.from('items').insert({
        user_id: user.id,
        name: input.counterItem.name,
        acquisition_cost: input.counterItem.evaluatedValue,
        status: 'disponivel',
        description: 'Item absorvido como abatimento de dívida',
      });
      if (itemError) return { success: false, error: itemError.message };
    }

    const res = await applySettlement(supabase, {
      kind: 'adjustment',
      receivableId,
      payableId,
      installmentId: input.installmentId,
      amount: input.amount,
      adjustmentType: input.adjustmentType,
      reason: input.reason,
      source: 'manual',
    });
    return res.success ? { success: true } : { success: false, error: res.error };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao registrar abatimento.' };
  }
}

export async function updateDueDateAction(input: {
  installmentId: string;
  newDueDate: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await authenticatedClient();
    if (!auth) return { success: false, error: 'Não autenticado.' };

    const res = await rescheduleInstallment(auth.supabase, {
      installmentId: input.installmentId,
      newDueDate: input.newDueDate,
      source: 'manual',
    });
    return res.success ? { success: true } : { success: false, error: res.error };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao alterar vencimento.' };
  }
}
