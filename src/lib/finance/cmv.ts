// src/lib/finance/cmv.ts
// Apuração determinística do Custo das Mercadorias Vendidas (CMV) — Fase 26.2
// CMV = Aquisição + Peças + Reparos + Estética + Transporte + Documentação + Outros
// Regra: Zero estimativas. Nenhum valor deve ser presumido ou inferido por percentuais.

import { addCents, toCents, toReais } from './money';

export interface AttributableCost {
  category?: string;
  description?: string;
  amountCents: number;
}

/**
 * Calcula o CMV de um item individual a partir do custo de aquisição e dos custos agregados comprovados.
 */
export function calculateItemCMVCents(
  acquisitionCostCents: number,
  additionalCosts: AttributableCost[] = []
): number {
  if (acquisitionCostCents < 0) {
    throw new Error('Custo de aquisição não pode ser negativo.');
  }

  const additionalSumCents = additionalCosts.reduce((acc, curr) => {
    if (curr.amountCents < 0) {
      throw new Error('Custo adicional não pode ser negativo.');
    }
    return acc + curr.amountCents;
  }, 0);

  return addCents(acquisitionCostCents, additionalSumCents);
}

/**
 * Sobrecarga em Reais para conveniência das interfaces existentes
 */
export function calculateItemCMVReais(
  acquisitionCostReais: number,
  additionalCostsReais: Array<{ amount: number; description?: string }> = []
): number {
  const acqCents = toCents(acquisitionCostReais);
  const costsCents: AttributableCost[] = additionalCostsReais.map((c) => ({
    amountCents: toCents(c.amount),
    description: c.description,
  }));
  return toReais(calculateItemCMVCents(acqCents, costsCents));
}

/**
 * Calcula o CMV Total de uma negociação somando o CMV de todos os itens entregues (OUT).
 */
export function calculateDealTotalCMVCents(itemsOutCMVCents: number[]): number {
  return itemsOutCMVCents.reduce((acc, curr) => addCents(acc, curr), 0);
}
