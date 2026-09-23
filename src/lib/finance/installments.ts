// src/lib/finance/installments.ts
// Geração e gestão determinística de cronogramas de parcelamento — Fase 26.4
// Assegura estritamente que a soma de todas as parcelas é idêntica ao montante total (zero dízima residual).

import { addCents, subtractCents, toReais } from './money';

export interface InstallmentScheduleOptions {
  totalAmountCents: number;
  count: number;
  startDate?: Date | string;
  /** Primeira data de vencimento explícita (YYYY-MM-DD); as demais seguem mensalmente no mesmo dia. */
  firstDueDate?: string;
  firstInstallmentAmountCents?: number;
  dueDayOfMonth?: number;
  intervalDays?: number;
  isPromissory?: boolean;
  manualInstallments?: Array<{
    number: number;
    amountCents: number;
    dueDate: string;
  }>;
}

export interface GeneratedInstallmentItem {
  installmentNumber: number;
  totalInstallments: number;
  originalValueCents: number;
  paidValueCents: number;
  balanceCents: number;
  originalValueReais: number;
  paidValueReais: number;
  balanceReais: number;
  dueDate: string;
  isPromissory: boolean;
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue';
}

function isoDateUTC(year: number, monthIndex: number, day: number): string {
  // monthIndex pode passar de 11: Date.UTC normaliza o ano; o dia é limitado ao último dia do mês
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))).toISOString().split('T')[0];
}

/**
 * Calcula a data de vencimento da parcela i (1-indexada), sempre DEPOIS da data do negócio.
 * - Com dia fixo ("todo dia 15"): primeira ocorrência do dia após a data base; depois mensal.
 *   Meses curtos usam o último dia (31 → 28/29/30) sem estourar para o mês seguinte.
 * - Sem dia fixo: regra padrão do negócio — primeira em `intervalDays` (30) dias, depois a cada intervalo.
 */
export function calculateDueDate(
  baseDate: Date,
  installmentIndex: number, // 1, 2, 3...
  dueDayOfMonth?: number,
  intervalDays: number = 30
): string {
  const y = baseDate.getUTCFullYear();
  const m = baseDate.getUTCMonth();
  const d = baseDate.getUTCDate();

  if (dueDayOfMonth && dueDayOfMonth >= 1 && dueDayOfMonth <= 31) {
    const firstMonthOffset = d < dueDayOfMonth ? 0 : 1;
    return isoDateUTC(y, m + firstMonthOffset + (installmentIndex - 1), dueDayOfMonth);
  }

  return new Date(Date.UTC(y, m, d + installmentIndex * intervalDays)).toISOString().split('T')[0];
}

/** Vencimentos a partir de uma primeira data explícita: mesmo dia nos meses seguintes. */
function dueDateFromFirst(firstDueDate: string, installmentIndex: number): string {
  const [y, m, d] = firstDueDate.split('-').map(Number);
  return isoDateUTC(y, m - 1 + (installmentIndex - 1), d);
}

/**
 * Gera o cronograma completo de parcelas com controle exato de centavos.
 */
export function generateInstallmentScheduleCents(
  options: InstallmentScheduleOptions
): GeneratedInstallmentItem[] {
  const {
    totalAmountCents,
    count,
    startDate = new Date(),
    firstInstallmentAmountCents,
    dueDayOfMonth,
    intervalDays = 30,
    isPromissory = false,
    manualInstallments,
    firstDueDate,
  } = options;

  if (count <= 0) {
    throw new Error('Quantidade de parcelas deve ser maior que zero.');
  }
  if (totalAmountCents <= 0) {
    throw new Error('Valor total das parcelas deve ser maior que zero.');
  }

  const baseDate = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const dueDateFor = (i: number) =>
    firstDueDate ? dueDateFromFirst(firstDueDate, i) : calculateDueDate(baseDate, i, dueDayOfMonth, intervalDays);

  // Cenário 1: Parcelas Manuais Fornecidas
  if (manualInstallments && manualInstallments.length > 0) {
    if (manualInstallments.length !== count) {
      throw new Error(`Quantidade de parcelas manuais (${manualInstallments.length}) difere do total estipulado (${count}).`);
    }

    const sumManual = manualInstallments.reduce((acc, curr) => addCents(acc, curr.amountCents), 0);
    if (sumManual !== totalAmountCents) {
      throw new Error(`A soma das parcelas manuais (${toReais(sumManual)}) não confere com o total acordado (${toReais(totalAmountCents)}).`);
    }

    return manualInstallments.map((inst, idx) => ({
      installmentNumber: inst.number || idx + 1,
      totalInstallments: count,
      originalValueCents: inst.amountCents,
      paidValueCents: 0,
      balanceCents: inst.amountCents,
      originalValueReais: toReais(inst.amountCents),
      paidValueReais: 0,
      balanceReais: toReais(inst.amountCents),
      dueDate: inst.dueDate,
      isPromissory,
      status: 'pending',
    }));
  }

  // Cenário 2: Primeira Parcela Diferente
  if (firstInstallmentAmountCents && count > 1) {
    if (firstInstallmentAmountCents >= totalAmountCents) {
      throw new Error('A primeira parcela não pode ser maior ou igual ao valor total quando há mais de 1 parcela.');
    }

    const remainingAmountCents = subtractCents(totalAmountCents, firstInstallmentAmountCents);
    const remainingCount = count - 1;

    const baseCents = Math.floor(remainingAmountCents / remainingCount);
    let remainder = remainingAmountCents - baseCents * remainingCount;

    const schedule: GeneratedInstallmentItem[] = [];

    // Primeira parcela
    const firstInstallmentDueDate = dueDateFor(1);
    schedule.push({
      installmentNumber: 1,
      totalInstallments: count,
      originalValueCents: firstInstallmentAmountCents,
      paidValueCents: 0,
      balanceCents: firstInstallmentAmountCents,
      originalValueReais: toReais(firstInstallmentAmountCents),
      paidValueReais: 0,
      balanceReais: toReais(firstInstallmentAmountCents),
      dueDate: firstInstallmentDueDate,
      isPromissory,
      status: 'pending',
    });

    // Parcelas restantes com distribuição de centavos
    for (let i = 2; i <= count; i++) {
      let instCents = baseCents;
      if (remainder > 0) {
        instCents += 1;
        remainder--;
      }

      const dueDate = dueDateFor(i);
      schedule.push({
        installmentNumber: i,
        totalInstallments: count,
        originalValueCents: instCents,
        paidValueCents: 0,
        balanceCents: instCents,
        originalValueReais: toReais(instCents),
        paidValueReais: 0,
        balanceReais: toReais(instCents),
        dueDate,
        isPromissory,
        status: 'pending',
      });
    }

    return schedule;
  }

  // Cenário 3: Parcelas Padrão com Distribuição de Centavos nas Primeiras
  const baseCents = Math.floor(totalAmountCents / count);
  let remainder = totalAmountCents - baseCents * count;

  const schedule: GeneratedInstallmentItem[] = [];

  for (let i = 1; i <= count; i++) {
    let instCents = baseCents;
    if (remainder > 0) {
      instCents += 1;
      remainder--;
    }

    const dueDate = dueDateFor(i);
    schedule.push({
      installmentNumber: i,
      totalInstallments: count,
      originalValueCents: instCents,
      paidValueCents: 0,
      balanceCents: instCents,
      originalValueReais: toReais(instCents),
      paidValueReais: 0,
      balanceReais: toReais(instCents),
      dueDate,
      isPromissory,
      status: 'pending',
    });
  }

  // Verificação matemática defensiva: a soma DEVE bater exatamente com o total
  const totalScheduled = schedule.reduce((acc, curr) => addCents(acc, curr.originalValueCents), 0);
  if (totalScheduled !== totalAmountCents) {
    throw new Error(`Inconsistência interna: soma gerada (${totalScheduled}) != total esperado (${totalAmountCents}).`);
  }

  return schedule;
}
