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
    amount: number;
    deal_id: string;
    allocations: RpcAllocation[];
    obligation_balance: number;
    obligation_status: string;
  };

  return {
    success: true,
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
