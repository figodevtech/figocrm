// src/lib/domain/financial-operations.ts
// Execução atômica de liquidações e reagendamentos — Fase J do hardening.
// Nenhum saldo é alterado "na mão": pagamentos geram `payments`, abatimentos geram `adjustments`
// e mudanças de vencimento geram `audit_log`, tudo dentro de uma única transação no PostgreSQL.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdjustmentType, PaymentMethodType } from '@/types/deal-command';

export type OperationSource = 'voice' | 'manual';

export interface SettlementRequest {
  kind: 'payment' | 'adjustment';
  receivableId?: string;
  payableId?: string;
  installmentId?: string;
  amount?: number;
  settleFull?: boolean;
  paymentMethod?: PaymentMethodType | 'debit_card' | 'credit_card';
  adjustmentType?: AdjustmentType | 'item_trade_in' | 'service_labor' | 'write_off';
  reason?: string;
  source: OperationSource;
}

export interface SettlementAllocation {
  installmentId: string;
  installmentNumber: number;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface SettlementResult {
  success: boolean;
  /** ID da operação (settlements.id) — usado para desfazer. */
  settlementId?: string;
  amount?: number;
  dealId?: string;
  allocations?: SettlementAllocation[];
  obligationBalance?: number;
  obligationStatus?: string;
  exceedsBalance?: boolean;
  error?: string;
}

type RpcAllocation = {
  installment_id: string;
  installment_number: number;
  amount: number;
  balance_before: number;
  balance_after: number;
};

export async function applySettlement(supabase: SupabaseClient, req: SettlementRequest): Promise<SettlementResult> {
  const { data, error } = await supabase.rpc('apply_obligation_settlement', {
    p_payload: {
      kind: req.kind,
      receivable_id: req.receivableId ?? null,
      payable_id: req.payableId ?? null,
      installment_id: req.installmentId ?? null,
      amount: req.settleFull ? null : req.amount ?? null,
      settle_full: req.settleFull ?? false,
      payment_method: req.paymentMethod ?? 'other',
      adjustment_type: req.adjustmentType ?? null,
      reason: req.reason ?? null,
      source: req.source,
    },
  });

  if (error) {
    return {
      success: false,
      exceedsBalance: error.hint === 'EXCEEDS_BALANCE',
      error: error.message,
    };
  }

  const res = data as {
    settlement_id: string;
    amount: number;
    deal_id: string;
    allocations: RpcAllocation[];
    obligation_balance: number;
    obligation_status: string;
  };

  return {
    success: true,
    settlementId: res.settlement_id,
    amount: Number(res.amount),
    dealId: res.deal_id,
    allocations: (res.allocations || []).map((a) => ({
      installmentId: a.installment_id,
      installmentNumber: a.installment_number,
      amount: Number(a.amount),
      balanceBefore: Number(a.balance_before),
      balanceAfter: Number(a.balance_after),
    })),
    obligationBalance: Number(res.obligation_balance),
    obligationStatus: res.obligation_status,
  };
}

export async function rescheduleInstallment(
  supabase: SupabaseClient,
  req: { installmentId: string; newDueDate: string; reason?: string; source: OperationSource }
): Promise<{ success: boolean; installmentNumber?: number; previousDueDate?: string; error?: string }> {
  const { data, error } = await supabase.rpc('reschedule_installment', {
    p_payload: {
      installment_id: req.installmentId,
      new_due_date: req.newDueDate,
      reason: req.reason ?? null,
      source: req.source,
    },
  });

  if (error) return { success: false, error: error.message };
  const res = data as { installment_number: number; previous_due_date: string };
  return { success: true, installmentNumber: res.installment_number, previousDueDate: res.previous_due_date };
}

export interface ReversalResult {
  success: boolean;
  alreadyReversed?: boolean;
  reversalSettlementId?: string;
  kind?: 'payment' | 'adjustment';
  amount?: number;
  obligationBalance?: number;
  obligationStatus?: string;
  installmentReplaced?: boolean;
  error?: string;
}

/** Estorna uma liquidação inteira (pagamento ou abatimento). Idempotente: estornar de novo não duplica. */
export async function reverseSettlement(
  supabase: SupabaseClient,
  req: { settlementId: string; reason?: string; source: OperationSource }
): Promise<ReversalResult> {
  const { data, error } = await supabase.rpc('reverse_settlement', {
    p_payload: { settlement_id: req.settlementId, reason: req.reason ?? null, source: req.source },
  });
  if (error) return { success: false, installmentReplaced: error.hint === 'INSTALLMENT_REPLACED', error: error.message };
  const res = data as {
    already_reversed: boolean;
    reversal_settlement_id: string;
    kind: 'payment' | 'adjustment';
    amount: number;
    obligation_balance?: number;
    obligation_status?: string;
  };
  return {
    success: true,
    alreadyReversed: res.already_reversed,
    reversalSettlementId: res.reversal_settlement_id,
    kind: res.kind,
    amount: Number(res.amount),
    obligationBalance: res.obligation_balance !== undefined ? Number(res.obligation_balance) : undefined,
    obligationStatus: res.obligation_status,
  };
}

export interface RenegotiationRequest {
  receivableId: string;
  /** Parcelas a juntar; vazio = todas as abertas da dívida. */
  installmentIds?: string[];
  newCount: number;
  newInstallmentAmount?: number;
  dueDay?: number;
  firstDueDate?: string;
  reason?: string;
  source: OperationSource;
}

export interface RenegotiationResult {
  success: boolean;
  renegotiationId?: string;
  renegotiatedAmount?: number;
  newInstallments?: Array<{ id: string; number: number; amount: number; dueDate: string }>;
  obligationBalance?: number;
  scheduleMismatch?: boolean;
  error?: string;
}

export async function renegotiateInstallments(supabase: SupabaseClient, req: RenegotiationRequest): Promise<RenegotiationResult> {
  const { data, error } = await supabase.rpc('renegotiate_installments', {
    p_payload: {
      receivable_id: req.receivableId,
      installment_ids: req.installmentIds ?? [],
      new_count: req.newCount,
      new_installment_amount: req.newInstallmentAmount ?? null,
      due_day: req.dueDay ?? null,
      first_due_date: req.firstDueDate ?? null,
      reason: req.reason ?? null,
      source: req.source,
    },
  });
  if (error) return { success: false, scheduleMismatch: error.hint === 'SCHEDULE_MISMATCH', error: error.message };
  const res = data as {
    renegotiation_id: string;
    renegotiated_amount: number;
    new_installments: Array<{ id: string; installment_number: number; amount: number; due_date: string }>;
    obligation_balance: number;
  };
  return {
    success: true,
    renegotiationId: res.renegotiation_id,
    renegotiatedAmount: Number(res.renegotiated_amount),
    newInstallments: res.new_installments.map((i) => ({ id: i.id, number: i.installment_number, amount: Number(i.amount), dueDate: i.due_date })),
    obligationBalance: Number(res.obligation_balance),
  };
}

/**
 * Plano de renegociação puro (sem banco): valida que a conta fecha antes de gravar.
 * Retorna o valor de cada parcela ou o motivo para perguntar ao usuário.
 */
export function planRenegotiation(
  totalCents: number,
  count?: number,
  installmentAmountCents?: number
): { ok: true; count: number; amountCents?: number } | { ok: false; reason: 'missing_count' | 'mismatch' | 'not_divisible' } {
  if (count && installmentAmountCents) {
    return count * installmentAmountCents === totalCents ? { ok: true, count, amountCents: installmentAmountCents } : { ok: false, reason: 'mismatch' };
  }
  if (count) return { ok: true, count };
  if (installmentAmountCents) {
    const derived = totalCents / installmentAmountCents;
    return Number.isInteger(derived) && derived > 0 ? { ok: true, count: derived, amountCents: installmentAmountCents } : { ok: false, reason: 'not_divisible' };
  }
  return { ok: false, reason: 'missing_count' };
}
