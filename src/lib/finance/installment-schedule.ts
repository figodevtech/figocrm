import { toCents, toReais } from './money';

export type InstallmentScheduleRule =
  | { type: 'monthly_day'; firstDueDate: string; dayOfMonth: number }
  | { type: 'interval_days'; firstDueDate: string; intervalDays: number }
  | { type: 'custom_dates'; dates: string[] }
  | { type: 'hybrid'; explicitDates: string[]; remainingRule: { type: 'monthly_day'; dayOfMonth: number } | { type: 'interval_days'; intervalDays: number } };

export type ExplicitInstallment = { number: number; dueDate: string; amount: number };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validISODate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

function requireDate(value: string): Date {
  if (!validISODate(value)) throw new Error('Data de vencimento inválida.');
  return new Date(`${value}T00:00:00.000Z`);
}

export function addCalendarMonthsClamped(date: string, months: number, preferredDay: number): string {
  const base = requireDate(date);
  if (!Number.isInteger(months) || months < 0 || !Number.isInteger(preferredDay) || preferredDay < 1 || preferredDay > 31) {
    throw new Error('Regra mensal inválida.');
  }
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(preferredDay, lastDay))).toISOString().slice(0, 10);
}

export function addExactDays(date: string, days: number): string {
  const base = requireDate(date);
  if (!Number.isInteger(days) || days < 0 || days > 36500) throw new Error('Intervalo de dias inválido.');
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function distributeAmountAcrossInstallments(total: number, count: number): number[] {
  const cents = toCents(total);
  if (!Number.isInteger(count) || count < 1 || count > 360 || cents < count) throw new Error('Valor ou quantidade de parcelas inválidos.');
  const base = Math.floor(cents / count);
  const extra = cents % count;
  return Array.from({ length: count }, (_, index) => toReais(base + (index < extra ? 1 : 0)));
}

export function buildInstallmentSchedule(input: { total: number; count: number; rule: InstallmentScheduleRule; minimumDate?: string }): ExplicitInstallment[] {
  const { total, count, rule } = input;
  const amounts = distributeAmountAcrossInstallments(total, count);
  let dates: string[];
  if (rule.type === 'monthly_day') {
    if (Number(rule.firstDueDate.slice(8)) !== Math.min(rule.dayOfMonth, new Date(Date.UTC(Number(rule.firstDueDate.slice(0, 4)), Number(rule.firstDueDate.slice(5, 7)), 0)).getUTCDate())) {
      throw new Error('Primeira data não corresponde ao dia mensal informado.');
    }
    dates = Array.from({ length: count }, (_, index) => addCalendarMonthsClamped(rule.firstDueDate, index, rule.dayOfMonth));
  } else if (rule.type === 'interval_days') {
    if (!Number.isInteger(rule.intervalDays) || rule.intervalDays < 1 || rule.intervalDays > 365) throw new Error('Intervalo de dias inválido.');
    dates = Array.from({ length: count }, (_, index) => addExactDays(rule.firstDueDate, index * rule.intervalDays));
  } else if (rule.type === 'custom_dates') {
    if (rule.dates.length !== count) throw new Error('Informe uma data para cada parcela.');
    dates = [...rule.dates];
  } else {
    if (rule.explicitDates.length < 1 || rule.explicitDates.length >= count) throw new Error('Datas explícitas insuficientes para o cronograma híbrido.');
    dates = [...rule.explicitDates];
    const anchor = dates[dates.length - 1];
    for (let index = dates.length; index < count; index++) {
      dates.push(rule.remainingRule.type === 'monthly_day'
        ? addCalendarMonthsClamped(anchor, index - rule.explicitDates.length + 1, rule.remainingRule.dayOfMonth)
        : addExactDays(anchor, (index - rule.explicitDates.length + 1) * rule.remainingRule.intervalDays));
    }
  }
  dates.forEach((date, index) => {
    if (!validISODate(date) || (input.minimumDate && date < input.minimumDate) || (index > 0 && date <= dates[index - 1])) {
      throw new Error('As datas das parcelas devem ser válidas e crescentes.');
    }
  });
  return dates.map((dueDate, index) => ({ number: index + 1, dueDate, amount: amounts[index] }));
}
