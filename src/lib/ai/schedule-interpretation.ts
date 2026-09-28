// Reconhece apenas datas e regras temporais ditas. A expansão financeira fica no backend.
import { addCalendarMonthsClamped, addExactDays, validISODate, type InstallmentScheduleRule } from '@/lib/finance/installment-schedule';

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function dateFor(day: number, month: number, year: number): string | null {
  const value = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return validISODate(value) ? value : null;
}

function nextOccurrence(day: number, month: number, after: string): string | null {
  const currentYear = Number(after.slice(0, 4));
  for (let year = currentYear; year <= currentYear + 4; year++) {
    const value = dateFor(day, month, year);
    if (value && value >= after) return value;
  }
  return null;
}

export function spokenDueDates(text: string, today: string): string[] {
  const normalized = fold(text);
  const candidates: Array<{ index: number; day: number; month: number; year?: number }> = [];
  for (const m of normalized.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/g)) {
    candidates.push({ index: m.index, day: Number(m[1]), month: Number(m[2]), year: m[3] ? Number(m[3]) : undefined });
  }
  for (const m of normalized.matchAll(/\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/g)) {
    candidates.push({ index: m.index, day: Number(m[1]), month: MONTHS[m[2]], year: m[3] ? Number(m[3]) : undefined });
  }
  candidates.sort((a, b) => a.index - b.index);
  const dates: string[] = [];
  for (const c of candidates) {
    const year = c.year === undefined ? undefined : c.year < 100 ? 2000 + c.year : c.year;
    const previous = dates.at(-1);
    const inferredYear = previous
      ? Number(previous.slice(0, 4)) + (Number(previous.slice(5, 7)) === 12 && c.month === 1 ? 1 : 0)
      : undefined;
    const value = year !== undefined ? dateFor(c.day, c.month, year)
      : inferredYear !== undefined ? dateFor(c.day, c.month, inferredYear)
      : nextOccurrence(c.day, c.month, today);
    if (!value) return [];
    dates.push(value);
  }
  if (dates.length) return dates;
  const nextMonthDay = normalized.match(/\b(?:dia\s+)?(\d{1,2})\s+(?:do\s+)?mes que vem\b/);
  if (nextMonthDay) {
    const day = Number(nextMonthDay[1]);
    return day >= 1 && day <= 31 ? [addCalendarMonthsClamped(today, 1, day)] : [];
  }
  if (/\bamanha\b/.test(normalized)) return [addExactDays(today, 1)];
  const relative = normalized.match(/\bdaqui a (\d+|duas|uma|um) (dias?|semanas?)\b/);
  if (relative) {
    const quantity = relative[1] === 'duas' ? 2 : relative[1] === 'uma' || relative[1] === 'um' ? 1 : Number(relative[1]);
    return [addExactDays(today, quantity * (relative[2].startsWith('semana') ? 7 : 1))];
  }
  return [];
}

export type ScheduleInterpretation = { rule?: InstallmentScheduleRule; explicitDates: string[]; question?: string };

export function interpretScheduleRule(text: string, count: number, today: string, existingDates: string[] = []): ScheduleInterpretation {
  const normalized = fold(text);
  if (/^\s*(sim|isso|exato|correto)( mesmo)?[.!]?\s*$/.test(normalized) && existingDates.length === 1) {
    const firstDueDate = existingDates[0];
    return { rule: { type: 'monthly_day', firstDueDate, dayOfMonth: Number(firstDueDate.slice(8)) }, explicitDates: existingDates };
  }
  const spoken = spokenDueDates(text, existingDates.at(-1) ?? today);
  const dates = [...existingDates, ...spoken];
  if (dates.length > count) return { explicitDates: dates, question: 'Você informou mais datas que parcelas. Quais vencimentos estão certos?' };
  if (dates.length === count) return { rule: { type: 'custom_dates', dates }, explicitDates: dates };

  const monthlyMatch = normalized.match(/\b(?:todo|cada)\s+(?:o\s+)?dia\s+(\d{1,2})\b/);
  const monthly = monthlyMatch || /\b(mensalmente|todo mes|de cada mes|mes a mes)\b/.test(normalized);
  const intervalMatch = normalized.match(/\bde\s+(\d{1,3})\s+em\s+\1\s+dias\b|\ba cada\s+(\d{1,3})\s+dias\b|\b(?:restante|proximas?).{0,30}?\b(?:para|em)\s+(\d{1,3})\s+dias\b/);
  const intervalDays = intervalMatch ? Number(intervalMatch[1] || intervalMatch[2] || intervalMatch[3]) : undefined;
  if (monthly && intervalDays) return { explicitDates: dates, question: 'Você quer as próximas todo mês no mesmo dia ou exatamente a cada 30 dias?' };
  if (monthly) {
    const day = monthlyMatch ? Number(monthlyMatch[1]) : dates.length ? Number(dates.at(-1)!.slice(8)) : undefined;
    if (!day || day < 1 || day > 31) return { explicitDates: dates, question: 'Qual dia do mês vence cada parcela?' };
    if (!dates.length) {
      const nextMonth = /\bmes que vem\b/.test(normalized);
      const base = nextMonth ? addCalendarMonthsClamped(today, 1, day) : addCalendarMonthsClamped(today, 0, day);
      dates.push(base < today ? addCalendarMonthsClamped(today, 1, day) : base);
    }
    return {
      rule: dates.length === 1 && Number(dates[0].slice(8)) === day
        ? { type: 'monthly_day', firstDueDate: dates[0], dayOfMonth: day }
        : { type: 'hybrid', explicitDates: dates, remainingRule: { type: 'monthly_day', dayOfMonth: day } },
      explicitDates: dates,
    };
  }
  if (intervalDays !== undefined) {
    if (intervalDays < 1 || intervalDays > 365) return { explicitDates: dates, question: 'Qual é o intervalo em dias entre as parcelas?' };
    if (!dates.length) return { explicitDates: dates, question: 'Quando vence a primeira parcela?' };
    return {
      rule: dates.length === 1
        ? { type: 'interval_days', firstDueDate: dates[0], intervalDays }
        : { type: 'hybrid', explicitDates: dates, remainingRule: { type: 'interval_days', intervalDays } },
      explicitDates: dates,
    };
  }
  if (dates.length) {
    const day = Number(dates.at(-1)!.slice(8));
    return { explicitDates: dates, question: dates.length === 1
      ? `As próximas ficam todo dia ${day} de cada mês?`
      : `Faltam ${count - dates.length} vencimentos. Quais são as datas ou a regra para as próximas?` };
  }
  if (/\bprimeira\b.{0,20}\bmes que vem\b/.test(normalized)) {
    return { explicitDates: [], question: 'Qual dia do mês que vem vence a primeira parcela?' };
  }
  return { explicitDates: [], question: count > 1 ? `Qual o vencimento das ${count} parcelas?` : 'Quando vence a parcela?' };
}
