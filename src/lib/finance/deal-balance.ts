// src/lib/finance/deal-balance.ts
// Validação Determinística do Balanço de Negociações — Fase 25 e 26
// Assegura que nenhum negócio seja gravado com valores descasados ou sem forma de pagamento definida.

import { DealCommand } from '@/types/deal-command';
import { addCents, subtractCents, toCents, formatCurrencyFromCents } from './money';

export interface DealBalanceValidationResult {
  isBalanced: boolean;
  totalOutCents: number;
  totalInCents: number;
  differenceCents: number;
  missingSide?: 'payment' | 'merchandise' | 'none';
  errorMessage?: string;
  suggestedPrompt?: string;
}

/**
 * Valida o fechamento contábil e financeiro de um DealCommand.
 * 
 * Lado de Saída do Usuário (OUT):
 * - Itens entregues pelo usuário (negotiatedValue)
 * - Dinheiro pago pelo usuário (cashOut)
 * - Contas a pagar assumidas pelo usuário (payables)
 * 
 * Lado de Entrada para o Usuário (IN):
 * - Itens recebidos na troca (negotiatedValue / acquisitionValue)
 * - Dinheiro recebido pelo usuário (cashIn)
 * - Contas a receber / parcelas a favor do usuário (receivables)
 * - Abatimentos / descontos concedidos (adjustments)
 */
export function validateDealBalance(command: DealCommand): DealBalanceValidationResult {
  // 1. Apurar Total OUT
  const itemsOutCents = command.itemsOut.reduce(
    (acc, curr) => addCents(acc, toCents(curr.negotiatedValue || 0)),
    0
  );
  const cashOutCents = command.cashOut.reduce(
    (acc, curr) => addCents(acc, toCents(curr.amount || 0)),
    0
  );
  const payablesCents = command.payables.reduce(
    (acc, curr) => addCents(acc, toCents(curr.totalAmount || 0)),
    0
  );

  const totalOutCents = addCents(itemsOutCents, cashOutCents, payablesCents);

  // 2. Apurar Total IN
  const itemsInCents = command.itemsIn.reduce(
    (acc, curr) => addCents(acc, toCents(curr.negotiatedValue ?? curr.acquisitionValue ?? 0)),
    0
  );
  const cashInCents = command.cashIn.reduce(
    (acc, curr) => addCents(acc, toCents(curr.amount || 0)),
    0
  );
  const receivablesCents = command.receivables.reduce(
    (acc, curr) => addCents(acc, toCents(curr.totalAmount || 0)),
    0
  );
  const adjustmentsCents = command.adjustments.reduce(
    (acc, curr) => addCents(acc, toCents(curr.amount || 0)),
    0
  );

  const totalInCents = addCents(itemsInCents, cashInCents, receivablesCents, adjustmentsCents);

  // 3. Comparação matemática estrita
  const differenceCents = subtractCents(totalOutCents, totalInCents);

  // Permuta seca pura (0 a 0 sem valores explícitos se for declarada pau-a-pau)
  if (
    command.itemsIn.length > 0 &&
    command.itemsOut.length > 0 &&
    totalOutCents === 0 &&
    totalInCents === 0
  ) {
    return {
      isBalanced: true,
      totalOutCents: 0,
      totalInCents: 0,
      differenceCents: 0,
    };
  }

  // Se ambos zerados em operação sem itens, não está balanceado
  if (totalOutCents === 0 && totalInCents === 0) {
    return {
      isBalanced: false,
      totalOutCents: 0,
      totalInCents: 0,
      differenceCents: 0,
      errorMessage: 'Nenhum valor financeiro ou mercadoria foi informado para a negociação.',
      suggestedPrompt: 'Qual é o valor total ou as mercadorias envolvidas neste negócio?',
    };
  }

  if (differenceCents === 0) {
    return {
      isBalanced: true,
      totalOutCents,
      totalInCents,
      differenceCents: 0,
    };
  }

  // Se a saída for maior que a entrada (falta pagamento do cliente)
  if (differenceCents > 0) {
    const formattedDiff = formatCurrencyFromCents(differenceCents);
    return {
      isBalanced: false,
      totalOutCents,
      totalInCents,
      differenceCents,
      missingSide: 'payment',
      errorMessage: `A conta não fecha: faltam ${formattedDiff} para cobrir o valor total da negociação.`,
      suggestedPrompt: `A conta ficou com ${formattedDiff} sem forma de pagamento. Como ficou esse restante?`,
    };
  }

  // Se a entrada for maior que a saída (cliente pagou/entregou mais do que o combinado)
  const absDiff = Math.abs(differenceCents);
  const formattedAbsDiff = formatCurrencyFromCents(absDiff);
  return {
    isBalanced: false,
    totalOutCents,
    totalInCents,
    differenceCents,
    missingSide: 'merchandise',
    errorMessage: `A conta não fecha: há um excedente de ${formattedAbsDiff} acima do valor combinado.`,
    suggestedPrompt: `O valor informado ultrapassou a conta em ${formattedAbsDiff}. Esse excedente é uma volta a pagar ou outro item?`,
  };
}
