// src/lib/finance/loans.ts
// Cálculo determinístico de empréstimo com juros (em centavos). Sem fórmulas financeiras compostas:
//   percent_total   → juros = principal × taxa%
//   percent_monthly → juros simples = principal × taxa% × quantidade de parcelas (meses)
//   fixed_amount    → juros = valor informado
// A grade de parcelas usa o mesmo gerador das vendas parceladas (generateInstallmentScheduleCents):
// centavos que sobram na divisão vão para as primeiras parcelas e a soma fecha exatamente com o total.

import { generateInstallmentScheduleCents } from './installments';
import { toCents, toReais } from './money';

export type InterestType = 'percent_total' | 'percent_monthly' | 'fixed_amount';

export const INTEREST_TYPE_LABELS: Record<InterestType, string> = {
  percent_total: '% sobre o total',
  percent_monthly: '% ao mês',
  fixed_amount: 'Valor fixo',
};

export const MAX_LOAN_INSTALLMENTS = 120;

export interface LoanTermsInput {
  principal: number;
  interestType: InterestType;
  /** Percentual (25 = 25%). Obrigatório para percent_total / percent_monthly. */
  interestRate?: number;
  /** Valor dos juros em reais. Obrigatório para fixed_amount. */
  interestAmount?: number;
  installmentsCount: number;
}

export interface LoanTerms {
  principalCents: number;
  interestCents: number;
  totalCents: number;
  installmentsCount: number;
  interestType: InterestType;
  interestRate: number | null;
  /** Valor de cada parcela (centavos), na ordem. */
  installmentCents: number[];
}

export type LoanTermsResult = { ok: true; terms: LoanTerms } | { ok: false; error: string };

function distribute(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  let remainder = totalCents - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

export function calculateLoanTerms(input: LoanTermsInput): LoanTermsResult {
  const principalCents = toCents(input.principal);
  const count = input.installmentsCount;

  if (!(principalCents > 0)) return { ok: false, error: 'Informe o valor emprestado.' };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Informe a quantidade de parcelas.' };
  if (count > MAX_LOAN_INSTALLMENTS) return { ok: false, error: `No máximo ${MAX_LOAN_INSTALLMENTS} parcelas.` };

  let interestCents: number;
  let interestRate: number | null = null;

  if (input.interestType === 'fixed_amount') {
    const amount = input.interestAmount ?? 0;
    if (!(amount >= 0)) return { ok: false, error: 'O valor dos juros não pode ser negativo.' };
    interestCents = toCents(amount);
  } else if (input.interestType === 'percent_total' || input.interestType === 'percent_monthly') {
    const rate = input.interestRate;
    if (rate === undefined || rate === null || !(rate >= 0)) return { ok: false, error: 'Informe a taxa de juros.' };
    if (rate > 1000) return { ok: false, error: 'Taxa de juros muito alta. Confira o valor.' };
    // Taxa com até 4 casas: arredonda para evitar ruído de ponto flutuante (12.5 → 125000)
    const rateE4 = Math.round(rate * 10000);
    const months = input.interestType === 'percent_monthly' ? count : 1;
    interestCents = Math.round((principalCents * rateE4 * months) / 1_000_000);
    interestRate = rateE4 / 10000;
  } else {
    return { ok: false, error: 'Escolha o tipo de juros.' };
  }

  const totalCents = principalCents + interestCents;
  return {
    ok: true,
    terms: {
      principalCents,
      interestCents,
      totalCents,
      installmentsCount: count,
      interestType: input.interestType,
      interestRate,
      installmentCents: distribute(totalCents, count),
    },
  };
}

/**
 * "Emprestei 2 mil em 5 de 500": o juro é a diferença entre o que volta e o que saiu (valor fixo).
 * Recusa quando as parcelas somam menos que o valor emprestado.
 */
export function loanTermsFromInstallments(principal: number, count: number, installmentAmount: number): LoanTermsResult {
  const principalCents = toCents(principal);
  const totalCents = count * toCents(installmentAmount);
  if (!(principalCents > 0)) return { ok: false, error: 'Informe o valor emprestado.' };
  if (!(toCents(installmentAmount) > 0)) return { ok: false, error: 'Informe o valor de cada parcela.' };
  if (totalCents < principalCents) {
    return { ok: false, error: `${count} parcelas de ${toReais(toCents(installmentAmount))} somam menos que o valor emprestado.` };
  }
  return calculateLoanTerms({
    principal,
    interestType: 'fixed_amount',
    interestAmount: toReais(totalCents - principalCents),
    installmentsCount: count,
  });
}

export interface LoanScheduleOptions {
  /** Data do empréstimo (YYYY-MM-DD). */
  startDate: string;
  /** Primeiro vencimento (YYYY-MM-DD); as demais seguem no mesmo dia dos meses seguintes. */
  firstDueDate?: string;
  /** Dia fixo de vencimento quando não há primeira data explícita. */
  dueDay?: number;
}

export interface LoanInstallment {
  number: number;
  amountCents: number;
  dueDate: string;
}

/** Mesmo dia no mês seguinte, limitado ao fim do mês (31/01 → 28/02). */
export function sameDayNextMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export function buildLoanSchedule(terms: LoanTerms, options: LoanScheduleOptions): LoanInstallment[] {
  // Empréstimo vence sempre no mesmo dia do mês: sem data nem dia informados, a 1ª é daqui a um mês
  const firstDueDate = options.firstDueDate ?? (options.dueDay ? undefined : sameDayNextMonth(options.startDate));
  const schedule = generateInstallmentScheduleCents({
    totalAmountCents: terms.totalCents,
    count: terms.installmentsCount,
    startDate: `${options.startDate}T12:00:00Z`,
    firstDueDate,
    dueDayOfMonth: firstDueDate ? undefined : options.dueDay,
    intervalDays: 30,
  });
  return schedule.map((s) => ({ number: s.installmentNumber, amountCents: s.originalValueCents, dueDate: s.dueDate }));
}

/** Parcelas iguais? (para "5 parcelas de R$ 500" em vez de listar uma a uma) */
export function uniformInstallment(installmentCents: number[]): number | null {
  return installmentCents.every((c) => c === installmentCents[0]) ? installmentCents[0] : null;
}
