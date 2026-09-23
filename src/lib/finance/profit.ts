// src/lib/finance/profit.ts
// Apuração determinística de Lucro — Fase 26.3
// Separa Lucro Projetado (negociação contratada) de Lucro Realizado (valores liquidados)

import { subtractCents, toCents, toReais, multiplyCents } from './money';

export interface ProfitBreakdownCents {
  projectedProfitCents: number;
  realizedProfitCents: number;
  totalNegotiatedCents: number;
  totalCollectedCents: number;
  totalCMVCents: number;
  marginPercent: number;
}

/**
 * Calcula o Lucro Projetado da negociação.
 * Lucro Projetado = Valor Negociado Total - CMV Total dos itens entregues (OUT).
 */
export function calculateProjectedProfitCents(
  totalNegotiatedCents: number,
  totalCMVCents: number
): number {
  return subtractCents(totalNegotiatedCents, totalCMVCents);
}

/**
 * Calcula o Lucro Realizado proporcional aos valores já liquidados (Cash In + Parcelas pagas).
 * Se totalCollectedCents >= totalCMVCents, o custo já foi amortizado e o excedente é lucro realizado;
 * Ou proporcionalmente à margem de lucro projetada sobre o valor total.
 * 
 * Abordagem conservadora do vendedor:
 * Método do Custo Recuperado (Cost Recovery Method):
 * Primeiro recupera-se o CMV. A partir do momento em que o recebimento supera o CMV, todo centavo adicional é lucro líquido realizado.
 * Alternativamente, método da Margem Proporcional: Realizado = Recebido * (LucroProjetado / Negociado).
 * O FigoCRM adota a Margem Proporcional por padrão, com opção para método conservador.
 */
export function calculateRealizedProfitCents(
  totalCollectedCents: number,
  totalNegotiatedCents: number,
  totalCMVCents: number,
  method: 'proportional' | 'cost_recovery' = 'proportional'
): number {
  if (totalNegotiatedCents <= 0) return 0;
  const projectedProfitCents = calculateProjectedProfitCents(totalNegotiatedCents, totalCMVCents);

  if (method === 'cost_recovery') {
    // Só é lucro o que excede o CMV
    return Math.max(0, subtractCents(totalCollectedCents, totalCMVCents));
  }

  // Método Proporcional: Lucro Realizado = totalCollected * (projectedProfit / totalNegotiated)
  const ratio = projectedProfitCents / totalNegotiatedCents;
  return multiplyCents(totalCollectedCents, ratio);
}

/**
 * Retorna o resumo completo de lucratividade
 */
export function calculateProfitSummary(
  totalNegotiatedReais: number,
  totalCMVReais: number,
  totalCollectedReais: number = 0
): {
  projectedProfit: number;
  realizedProfit: number;
  marginPercent: number;
} {
  const negotiatedCents = toCents(totalNegotiatedReais);
  const cmvCents = toCents(totalCMVReais);
  const collectedCents = toCents(totalCollectedReais);

  const projectedProfitCents = calculateProjectedProfitCents(negotiatedCents, cmvCents);
  const realizedProfitCents = calculateRealizedProfitCents(collectedCents, negotiatedCents, cmvCents);

  const marginPercent = negotiatedCents > 0
    ? Math.round((projectedProfitCents / negotiatedCents) * 10000) / 100
    : 0;

  return {
    projectedProfit: toReais(projectedProfitCents),
    realizedProfit: toReais(realizedProfitCents),
    marginPercent,
  };
}
