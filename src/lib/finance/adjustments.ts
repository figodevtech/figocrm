// src/lib/finance/adjustments.ts
// Regras e apuração de Abatimentos, Descontos e Compensações — Fases 26 e 33
// Suporta: desconto, compensação de dívida, serviço prestado e entrada de item como abatimento.

import { AdjustmentType } from '@/types/deal-command';
import { subtractCents } from './money';

export interface AdjustmentApplicationResult {
  previousBalanceCents: number;
  adjustmentAmountCents: number;
  newBalanceCents: number;
  type: AdjustmentType;
  isFullySettled: boolean;
  excessCents: number;
}

/**
 * Aplica um abatimento sobre um saldo devedor existente de forma segura.
 * Regra: Um abatimento não pode exceder o saldo devedor sem que o excedente seja explicitamente sinalizado.
 */
export function applyAdjustmentToBalanceCents(
  currentBalanceCents: number,
  adjustmentAmountCents: number,
  type: AdjustmentType
): AdjustmentApplicationResult {
  if (currentBalanceCents < 0) {
    throw new Error('Saldo devedor atual não pode ser negativo.');
  }
  if (adjustmentAmountCents <= 0) {
    throw new Error('Valor do abatimento deve ser maior que zero.');
  }

  const effectiveAdjustmentCents = Math.min(adjustmentAmountCents, currentBalanceCents);
  const excessCents = subtractCents(adjustmentAmountCents, effectiveAdjustmentCents);
  const newBalanceCents = subtractCents(currentBalanceCents, effectiveAdjustmentCents);

  return {
    previousBalanceCents: currentBalanceCents,
    adjustmentAmountCents: effectiveAdjustmentCents,
    newBalanceCents: Math.max(0, newBalanceCents),
    type,
    isFullySettled: newBalanceCents <= 0,
    excessCents,
  };
}
