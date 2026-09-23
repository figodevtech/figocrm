// src/lib/financial_engine.ts
// Motor Financeiro Determinístico do SaaS Voice-First
// Cálculos puros e livres de alucinação para precisão contábil das negociações

import {
  Installment,
  InstallmentStatus,
  Item,
  ItemCost,
  DashboardIndicators,
  Deal,
} from '../types/domain';

/**
 * Arredonda valor para 2 casas decimais de forma precisa (evita problemas de ponto flutuante do IEEE 754)
 */
export function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 1. Cálculo de CMV (Custo das Mercadorias Vendidas)
 * Soma o valor de compra original com todos os custos atribuíveis adicionais (reformas, peças, despachante, guincho).
 */
export function calculateCMV(acquisitionCost: number, additionalCosts: ItemCost[] = []): number {
  const sumAdditional = additionalCosts.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  return roundToTwoDecimals(acquisitionCost + sumAdditional);
}

/**
 * 2. Cálculo do Lucro Bruto da Negociação
 * Lucro = Valor Negociado Total - Soma dos CMVs de todos os itens entregues (OUT).
 */
export function calculateGrossProfit(dealTotalValue: number, itemsOutCMV: number[]): number {
  const totalCMV = itemsOutCMV.reduce((acc, curr) => acc + curr, 0);
  return roundToTwoDecimals(dealTotalValue - totalCMV);
}

/**
 * 3. Geração de Cronograma de Parcelas com Distribuição Precisa de Centavos
 * Assegura estritamente que a soma de todas as parcelas é idêntica ao montante total.
 */
export interface ScheduleOptions {
  totalAmount: number;
  installmentsCount: number;
  startDate: Date;
  intervalDays?: number;
  dueDayOfMonth?: number;
  isPromissory?: boolean;
}

export function generateInstallmentSchedule(options: ScheduleOptions): Array<{
  installmentNumber: number;
  totalInstallments: number;
  originalValue: number;
  paidValue: number;
  balance: number;
  dueDate: string;
  status: InstallmentStatus;
  isPromissory: boolean;
}> {
  const { totalAmount, installmentsCount, startDate, intervalDays = 30, dueDayOfMonth, isPromissory = false } = options;

  if (installmentsCount <= 0) {
    throw new Error('Quantidade de parcelas deve ser maior que zero.');
  }
  if (totalAmount <= 0) {
    throw new Error('Valor total deve ser maior que zero.');
  }

  const baseInstallment = Math.floor((totalAmount / installmentsCount) * 100) / 100;
  let remainingCents = Math.round((totalAmount - baseInstallment * installmentsCount) * 100);

  const schedule = [];
  const currentDate = new Date(startDate);

  for (let i = 1; i <= installmentsCount; i++) {
    let installmentValue = baseInstallment;

    // Distribui os centavos residuais nas primeiras parcelas
    if (remainingCents > 0) {
      installmentValue = roundToTwoDecimals(installmentValue + 0.01);
      remainingCents--;
    }

    // Cálculo da data de vencimento
    const dueDate = new Date(currentDate);
    if (dueDayOfMonth) {
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      dueDate.setDate(dueDayOfMonth);
    } else {
      dueDate.setDate(dueDate.getDate() + (i - 1) * intervalDays);
    }

    schedule.push({
      installmentNumber: i,
      totalInstallments: installmentsCount,
      originalValue: installmentValue,
      paidValue: 0,
      balance: installmentValue,
      dueDate: dueDate.toISOString().split('T')[0],
      status: 'pending' as InstallmentStatus,
      isPromissory,
    });
  }

  return schedule;
}

/**
 * 4. Processamento de Pagamento em Parcela Individual
 * Atualiza saldo, valor pago e status sem marcar como quitada prematuramente.
 */
export function processInstallmentPayment(
  installment: Installment,
  amountPaid: number
): {
  updatedInstallment: Installment;
  effectivePaid: number;
  excessAmount: number;
} {
  if (amountPaid <= 0) {
    throw new Error('Valor do pagamento deve ser positivo.');
  }

  const remainingBalance = installment.balance;
  const effectivePaid = Math.min(amountPaid, remainingBalance);
  const excessAmount = roundToTwoDecimals(amountPaid - effectivePaid);

  const newPaidValue = roundToTwoDecimals(installment.paidValue + effectivePaid);
  const newBalance = roundToTwoDecimals(installment.originalValue - newPaidValue);

  let newStatus: InstallmentStatus = installment.status;
  if (newBalance <= 0) {
    newStatus = 'paid';
  } else {
    newStatus = 'partially_paid';
  }

  return {
    updatedInstallment: {
      ...installment,
      paidValue: newPaidValue,
      balance: newBalance,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    },
    effectivePaid,
    excessAmount,
  };
}

/**
 * 5. Alocação Sequencial de Pagamento (Prioriza Parcelas Mais Antigas / Vencidas)
 */
export function allocatePaymentAcrossInstallments(
  installments: Installment[],
  totalPayment: number
): {
  updatedInstallments: Installment[];
  unallocatedAmount: number;
} {
  let remainingPayment = totalPayment;
  // Ordena por data de vencimento ascendente (mais antigas primeiro)
  const sorted = [...installments].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const updatedInstallments = sorted.map((inst) => {
    if (remainingPayment <= 0 || inst.status === 'paid') {
      return inst;
    }

    const { updatedInstallment, effectivePaid } = processInstallmentPayment(inst, remainingPayment);
    remainingPayment = roundToTwoDecimals(remainingPayment - effectivePaid);
    return updatedInstallment;
  });

  return {
    updatedInstallments,
    unallocatedAmount: remainingPayment,
  };
}

/**
 * 6. Apuração dos 4 Indicadores da Home
 */
export function calculateDashboardIndicators(
  allInstallments: Installment[],
  allStockItems: Item[],
  completedDealsThisMonth: Deal[],
  referenceDate: Date = new Date()
): DashboardIndicators {
  const refDateStr = referenceDate.toISOString().split('T')[0];

  let naRua = 0;
  let atrasado = 0;

  for (const inst of allInstallments) {
    if (inst.status !== 'paid' && inst.status !== 'canceled') {
      naRua += inst.balance;
      if (inst.dueDate < refDateStr) {
        atrasado += inst.balance;
      }
    }
  }

  let emMercadoria = 0;
  for (const item of allStockItems) {
    if (item.status === 'disponivel' || item.status === 'em_preparacao' || item.status === 'reservado') {
      emMercadoria += item.totalCMV ?? item.acquisitionCost;
    }
  }

  let quantoGanhouMes = 0;
  for (const deal of completedDealsThisMonth) {
    quantoGanhouMes += deal.recognizedProfit;
  }

  return {
    naRua: roundToTwoDecimals(naRua),
    atrasado: roundToTwoDecimals(atrasado),
    emMercadoria: roundToTwoDecimals(emMercadoria),
    quantoGanhouMes: roundToTwoDecimals(quantoGanhouMes),
  };
}
