// src/lib/format.ts
// Formatação e leitura de valores para a interface (pt-BR). Sem regra financeira aqui:
// só apresentação e conversão do que o usuário digitou.

import { toCents } from '@/lib/finance/money';

/** "R$ 12.450" quando inteiro, "R$ 1.500,50" com centavos. */
export function formatBRL(value: number | null | undefined): string {
  const cents = toCents(Number(value ?? 0));
  const whole = cents % 100 === 0;
  const abs = Math.abs(cents) / 100;
  const text = abs.toLocaleString('pt-BR', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}R$ ${text}`;
}

/**
 * Lê valor digitado: "3.200", "3200,50", "R$ 1.500,00", "2.5" (decimal), "1,5 mil" não é aceito.
 * Retorna null quando não dá para ler com segurança.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = raw.replace(/R\$|\s/gi, '').trim();
  if (!text) return null;
  if (!/^\d[\d.,]*$/.test(text)) return null;

  let normalized: string;
  if (text.includes(',')) {
    // Vírgula é decimal; pontos são milhar
    const [intPart, decPart, ...rest] = text.split(',');
    if (rest.length > 0 || (decPart !== undefined && decPart.length > 2)) return null;
    normalized = `${intPart.replace(/\./g, '')}.${decPart ?? ''}`;
  } else {
    const groups = text.split('.');
    if (groups.length === 1) normalized = text;
    else if (groups.slice(1).every((g) => g.length === 3)) normalized = groups.join(''); // 3.200 / 1.000.000
    else if (groups.length === 2 && groups[1].length <= 2) normalized = text; // 2.5 / 10.50
    else return null;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

/** Valor para preencher um campo de dinheiro: 3200 → "3.200", 1500.5 → "1.500,50". */
export function moneyInputValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const cents = toCents(value);
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

/** Lê percentual digitado ("10", "2,5", "12.5%"). */
export function parsePercentInput(raw: string): number | null {
  const text = raw.replace(/%|\s/g, '').replace(',', '.');
  if (!text || !/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 2026-10-10 → 10/10/2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** 2026-10-10 → 10/10 (com ano só quando não é o ano corrente) */
export function formatShortDate(iso: string | null | undefined, today: string = new Date().toISOString().slice(0, 10)): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

/** Soma dias a uma data ISO (sem fuso). */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

/** Só dígitos → "(83) 99999-9999" quando tem 10/11 dígitos; senão devolve como veio. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

/** Busca sem acento e sem caixa. */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const norm = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((token) => hay.includes(token));
}
