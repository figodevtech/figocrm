// src/lib/finance/money.ts
// Manipulação determinística de valores monetários com precisão em centavos
// Elimina erros de ponto flutuante IEEE 754

/**
 * Converte valor em Reais (float) para Centavos inteiros.
 * Ex: 19.90 -> 1990; 0.1 + 0.2 -> 30
 */
export function toCents(reais: number): number {
  if (isNaN(reais)) return 0;
  return Math.round((reais + Number.EPSILON) * 100);
}

/**
 * Converte Centavos inteiros para Reais (float de 2 casas decimais).
 * Ex: 1990 -> 19.90
 */
export function toReais(cents: number): number {
  if (isNaN(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * Arredonda centavos para valor inteiro garantido
 */
export function roundCents(cents: number): number {
  return Math.round(cents);
}

/**
 * Soma valores em centavos de forma segura
 */
export function addCents(...centsList: number[]): number {
  return centsList.reduce((acc, curr) => acc + (isNaN(curr) ? 0 : Math.round(curr)), 0);
}

/**
 * Subtrai centavos: a - b
 */
export function subtractCents(centsA: number, centsB: number): number {
  return Math.round(centsA) - Math.round(centsB);
}

/**
 * Multiplica centavos por uma razão ou fator
 */
export function multiplyCents(cents: number, factor: number): number {
  return Math.round(cents * factor);
}

/**
 * Divide centavos por um divisor inteiro com arredondamento
 */
export function divideCents(cents: number, divisor: number): number {
  if (divisor === 0) throw new Error('Divisão por zero não permitida.');
  return Math.round(cents / divisor);
}

/**
 * Formata centavos em string legível em Real brasileiro (R$)
 */
export function formatCurrencyFromCents(cents: number): string {
  const reais = toReais(cents);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(reais);
}

/**
 * Formata reais diretamente em moeda BRL
 */
export function formatCurrency(reais: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(reais);
}
