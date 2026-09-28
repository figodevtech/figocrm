// src/lib/domain/loan-plan.ts
// Plano do empréstimo (termos + grade de parcelas) sem banco e sem servidor: usado na prévia da tela,
// na voz e na gravação — a conta mostrada ao usuário é exatamente a que vai para o banco.

import {
  buildLoanSchedule,
  calculateLoanTerms,
  InterestType,
  LoanInstallment,
  LoanTerms,
  loanTermsFromInstallments,
} from '@/lib/finance/loans';
import type { PaymentMethod } from '@/types/domain';
import { buildInstallmentSchedule, type InstallmentScheduleRule } from '@/lib/finance/installment-schedule';

export interface LoanPlanInput {
  principal: number;
  interestType: InterestType;
  interestRate?: number;
  interestAmount?: number;
  installmentsCount: number;
  /** Alternativa ao tipo de juros: valor de cada parcela ("5 de 500"). O juro vira a diferença. */
  installmentAmount?: number;
  startDate?: string;
  firstDueDate?: string;
  dueDay?: number;
  scheduleRule?: InstallmentScheduleRule;
  paymentMethod?: PaymentMethod | 'card';
  notes?: string;
  idempotencyKey?: string;
}

export type LoanPlan =
  | { ok: true; terms: LoanTerms; schedule: LoanInstallment[]; startDate: string }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de negócio no fuso do Brasil (o servidor roda em UTC). */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function planLoan(input: LoanPlanInput, now: Date = new Date()): LoanPlan {
  const startDate = input.startDate || todayISO(now);
  if (!ISO_DATE.test(startDate)) return { ok: false, error: 'Data do empréstimo inválida.' };
  if (input.firstDueDate && !ISO_DATE.test(input.firstDueDate)) return { ok: false, error: 'Data do primeiro vencimento inválida.' };
  if (input.firstDueDate && input.firstDueDate < startDate) {
    return { ok: false, error: 'O primeiro vencimento não pode ser antes da data do empréstimo.' };
  }
  if (input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)) {
    return { ok: false, error: 'Dia de vencimento inválido.' };
  }

  const res =
    input.installmentAmount !== undefined
      ? loanTermsFromInstallments(input.principal, input.installmentsCount, input.installmentAmount)
      : calculateLoanTerms({
          principal: input.principal,
          interestType: input.interestType,
          interestRate: input.interestRate,
          interestAmount: input.interestAmount,
          installmentsCount: input.installmentsCount,
        });
  if (!res.ok) return res;

  let schedule: LoanInstallment[];
  if (input.scheduleRule) {
    try {
      const explicit = buildInstallmentSchedule({ total: res.terms.totalCents / 100, count: input.installmentsCount, rule: input.scheduleRule, minimumDate: startDate });
      const legacy = buildLoanSchedule(res.terms, { startDate, firstDueDate: input.firstDueDate, dueDay: input.dueDay });
      schedule = legacy.map((item, index) => ({ ...item, dueDate: explicit[index].dueDate }));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Cronograma de parcelas inválido.' };
    }
  } else {
    schedule = buildLoanSchedule(res.terms, { startDate, firstDueDate: input.firstDueDate, dueDay: input.dueDay });
  }
  return { ok: true, terms: res.terms, schedule, startDate };
}
