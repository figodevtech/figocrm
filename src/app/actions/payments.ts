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
import { actionSession, NOT_AUTHENTICATED } from '@/lib/auth/session';
import { renegotiateInstallments } from '@/lib/domain/financial-operations';
import { reverseAndDescribe } from '@/lib/ai/orchestrator';
import { formatBRL } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';

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

// ------------------------------------------------------------------ telas do app (formulário)

export interface ReceivePaymentInput {
  receivableId: string;
  /** Parcela escolhida; sem ela o valor abate das parcelas mais antigas da MESMA dívida. */
  installmentId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
}

export type ReceivePaymentResult =
  | { ok: true; settlementId: string; message: string; debtBalance: number; installmentBalance: number | null }
  | { ok: false; error: string };

/** "Receber pagamento": sempre sobre UMA dívida escolhida pelo usuário, pela RPC atômica de liquidação. */
export async function receivePaymentAction(input: ReceivePaymentInput): Promise<ReceivePaymentResult> {
  const session = await actionSession();
  if (!session) return { ok: false, error: NOT_AUTHENTICATED };
  const supabase = session.supabase as unknown as SupabaseClient;

  if (!input.receivableId) return { ok: false, error: 'Escolha qual dívida ele está pagando.' };
  if (!(input.amount > 0)) return { ok: false, error: 'Informe o valor recebido.' };

  const res = await applySettlement(supabase, {
    kind: 'payment',
    receivableId: input.receivableId,
    installmentId: input.installmentId,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    reason: 'Recebimento manual',
    source: 'manual',
  });
  if (!res.success || !res.settlementId) {
    if (res.exceedsBalance) return { ok: false, error: 'O valor passa do que falta pagar. Confira o valor.' };
    if (res.error?.includes('Assinatura inativa')) return { ok: false, error: 'Seu período de teste acabou. Assine para continuar registrando.' };
    return { ok: false, error: 'Não consegui registrar o pagamento. Nada foi alterado.' };
  }

  const single = res.allocations?.length === 1 ? res.allocations[0] : undefined;
  const debtBalance = res.obligationBalance ?? 0;
  const installmentBalance = input.installmentId && single ? single.balanceAfter : null;
  const message =
    debtBalance <= 0
      ? `Recebido ${formatBRL(res.amount ?? input.amount)}. Dívida quitada.`
      : installmentBalance !== null && installmentBalance > 0
        ? `Recebido ${formatBRL(res.amount ?? input.amount)}. Faltam ${formatBRL(installmentBalance)} nessa parcela.`
        : `Recebido ${formatBRL(res.amount ?? input.amount)}. Falta ${formatBRL(debtBalance)} no total.`;
  return { ok: true, settlementId: res.settlementId, message, debtBalance, installmentBalance };
}

/** Desfazer pagamento/abatimento: estorno por lançamento negativo (nada é apagado). */
export async function undoSettlementAction(settlementId: string): Promise<{ ok: boolean; message: string }> {
  const session = await actionSession();
  if (!session) return { ok: false, message: NOT_AUTHENTICATED };
  const outcome = await reverseAndDescribe(session.supabase as unknown as SupabaseClient, settlementId, undefined, 'Desfazer pela tela', 'manual');
  return { ok: outcome.success, message: outcome.humanResponse };
}

export interface RenegotiateInput {
  receivableId: string;
  /** Parcelas a juntar; vazio = todas as abertas. */
  installmentIds?: string[];
  newCount: number;
  firstDueDate?: string;
}

/** Renegociar: parcelas antigas ficam como "renegociada" (histórico), nova grade fecha com o saldo. */
export async function renegotiateDebtAction(input: RenegotiateInput): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await actionSession();
  if (!session) return { ok: false, error: NOT_AUTHENTICATED };
  if (!Number.isInteger(input.newCount) || input.newCount < 1 || input.newCount > 120) return { ok: false, error: 'Informe em quantas parcelas fica.' };

  const res = await renegotiateInstallments(session.supabase as unknown as SupabaseClient, {
    receivableId: input.receivableId,
    installmentIds: input.installmentIds,
    newCount: input.newCount,
    firstDueDate: input.firstDueDate,
    reason: 'Renegociação pela tela',
    source: 'manual',
  });
  if (!res.success) {
    if (res.error?.includes('passado')) return { ok: false, error: 'O primeiro vencimento não pode ser no passado.' };
    if (res.error?.includes('Assinatura inativa')) return { ok: false, error: 'Seu período de teste acabou. Assine para continuar registrando.' };
    return { ok: false, error: 'Não consegui renegociar. Nada foi alterado.' };
  }
  const first = res.newInstallments?.[0];
  const same = res.newInstallments?.every((i) => i.amount === first?.amount);
  return {
    ok: true,
    message: `Renegociado: ${formatBRL(res.renegotiatedAmount ?? 0)} em ${input.newCount}${same && first ? `x de ${formatBRL(first.amount)}` : ' parcelas'}.`,
  };
}
