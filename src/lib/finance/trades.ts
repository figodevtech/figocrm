// src/lib/finance/trades.ts
// Cálculos e regras contábeis para Trocas e Permutas — Fase 26 e Fase 33
// Suporta: troca seca, volta recebida, volta paga e voltas parceladas.

import { subtractCents } from './money';
import { generateInstallmentScheduleCents, GeneratedInstallmentItem } from './installments';

export type TradeDirection = 'even' | 'inflow' | 'outflow';

export interface TradeAnalysisResult {
  direction: TradeDirection;
  itemOutValueCents: number;
  itemInValueCents: number;
  tradeDifferenceCents: number; // itemOut - itemIn
  cashMovementRequiredCents: number;
  isEvenTrade: boolean;
  receivableSchedule?: GeneratedInstallmentItem[];
  payableSchedule?: GeneratedInstallmentItem[];
}

export interface TradeOptions {
  itemOutValueCents: number;
  itemInValueCents: number;
  immediateCashCents?: number;
  installmentsCount?: number;
  dueDayOfMonth?: number;
  startDate?: Date | string;
}

/**
 * Analisa matematicamente uma troca de mercadorias e determina a direção da volta e saldos.
 */
export function analyzeTrade(options: TradeOptions): TradeAnalysisResult {
  const {
    itemOutValueCents,
    itemInValueCents,
    immediateCashCents = 0,
    installmentsCount = 0,
    dueDayOfMonth,
    startDate = new Date(),
  } = options;

  const diffCents = subtractCents(itemOutValueCents, itemInValueCents);

  // Cenário 1: Troca Seca (Pau a pau)
  if (diffCents === 0) {
    return {
      direction: 'even',
      itemOutValueCents,
      itemInValueCents,
      tradeDifferenceCents: 0,
      cashMovementRequiredCents: 0,
      isEvenTrade: true,
    };
  }

  // Cenário 2: Volta a favor do usuário (Usuário recebe volta: diff > 0)
  if (diffCents > 0) {
    const remainingToCollectCents = subtractCents(diffCents, immediateCashCents);
    let receivableSchedule: GeneratedInstallmentItem[] | undefined = undefined;

    if (remainingToCollectCents > 0 && installmentsCount > 0) {
      receivableSchedule = generateInstallmentScheduleCents({
        totalAmountCents: remainingToCollectCents,
        count: installmentsCount,
        dueDayOfMonth,
        startDate,
      });
    }

    return {
      direction: 'inflow',
      itemOutValueCents,
      itemInValueCents,
      tradeDifferenceCents: diffCents,
      cashMovementRequiredCents: diffCents,
      isEvenTrade: false,
      receivableSchedule,
    };
  }

  // Cenário 3: Volta paga pelo usuário (Usuário completa o valor: diff < 0)
  const payableDifferenceCents = Math.abs(diffCents);
  const remainingToPayCents = subtractCents(payableDifferenceCents, immediateCashCents);
  let payableSchedule: GeneratedInstallmentItem[] | undefined = undefined;

  if (remainingToPayCents > 0 && installmentsCount > 0) {
    payableSchedule = generateInstallmentScheduleCents({
      totalAmountCents: remainingToPayCents,
      count: installmentsCount,
      dueDayOfMonth,
      startDate,
    });
  }

  return {
    direction: 'outflow',
    itemOutValueCents,
    itemInValueCents,
    tradeDifferenceCents: payableDifferenceCents,
    cashMovementRequiredCents: payableDifferenceCents,
    isEvenTrade: false,
    payableSchedule,
  };
}
