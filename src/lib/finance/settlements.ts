// src/lib/finance/settlements.ts
// Quitações, pagamentos parciais e alocação sequencial com tratamento estrito de excesso — Fases 26.5 e 26.6

import { subtractCents, toCents, toReais } from './money';

export interface SettlementInputItem {
  id: string;
  originalValueCents: number;
  paidValueCents: number;
  balanceCents: number;
  dueDate: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue';
}

export interface SettlementResultItem {
  installmentId: string;
  previousBalanceCents: number;
  effectivePaidCents: number;
  newPaidValueCents: number;
  newBalanceCents: number;
  newStatus: 'pending' | 'partially_paid' | 'paid' | 'overdue';
}

export interface PaymentSettlementResult {
  updatedInstallment: SettlementResultItem;
  effectivePaidCents: number;
  excessCents: number;
  isFullySettled: boolean;
}

export interface DistributedSettlementResult {
  updatedInstallments: SettlementResultItem[];
  totalEffectivePaidCents: number;
  unallocatedCents: number;
  fullyPaidCount: number;
  partiallyPaidCount: number;
}

/**
 * Processa o pagamento de uma parcela individual.
 * Regra obrigatória: Se o pagamento exceder o saldo, o excedente é retornado separadamente (excessCents)
 * e NUNCA é incorporado silenciosamente ou ignorado.
 */
export function processInstallmentPaymentCents(
  installment: SettlementInputItem,
  paymentAmountCents: number
): PaymentSettlementResult {
  if (paymentAmountCents <= 0) {
    throw new Error('Valor do pagamento deve ser maior que zero.');
  }

  const remainingBalanceCents = installment.balanceCents;
  const effectivePaidCents = Math.min(paymentAmountCents, remainingBalanceCents);
  const excessCents = subtractCents(paymentAmountCents, effectivePaidCents);

  const newPaidValueCents = installment.paidValueCents + effectivePaidCents;
  const newBalanceCents = subtractCents(installment.originalValueCents, newPaidValueCents);

  const isFullySettled = newBalanceCents <= 0;
  const newStatus = isFullySettled ? 'paid' : 'partially_paid';

  return {
    updatedInstallment: {
      installmentId: installment.id,
      previousBalanceCents: remainingBalanceCents,
      effectivePaidCents,
      newPaidValueCents,
      newBalanceCents: Math.max(0, newBalanceCents),
      newStatus,
    },
    effectivePaidCents,
    excessCents,
    isFullySettled,
  };
}

/**
 * Aloca pagamento distribuído sequencialmente entre múltiplas parcelas.
 * Prioridade: parcelas vencidas e mais antigas (ordem cronológica de due_date).
 */
export function allocateDistributedPaymentCents(
  installments: SettlementInputItem[],
  totalPaymentCents: number
): DistributedSettlementResult {
  if (totalPaymentCents <= 0) {
    throw new Error('Valor total a ser distribuído deve ser positivo.');
  }

  // Ordena por vencimento ascendente (mais antigas primeiro)
  const eligible = installments
    .filter((inst) => inst.status !== 'paid' && inst.balanceCents > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  let remainingPaymentCents = totalPaymentCents;
  const updatedList: SettlementResultItem[] = [];
  let totalEffectivePaidCents = 0;
  let fullyPaidCount = 0;
  let partiallyPaidCount = 0;

  for (const inst of eligible) {
    if (remainingPaymentCents <= 0) break;

    const res = processInstallmentPaymentCents(inst, remainingPaymentCents);
    updatedList.push(res.updatedInstallment);

    remainingPaymentCents = subtractCents(remainingPaymentCents, res.effectivePaidCents);
    totalEffectivePaidCents += res.effectivePaidCents;

    if (res.isFullySettled) {
      fullyPaidCount++;
    } else {
      partiallyPaidCount++;
    }
  }

  return {
    updatedInstallments: updatedList,
    totalEffectivePaidCents,
    unallocatedCents: remainingPaymentCents,
    fullyPaidCount,
    partiallyPaidCount,
  };
}
