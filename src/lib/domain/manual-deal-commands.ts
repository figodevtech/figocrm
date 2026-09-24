// src/lib/domain/manual-deal-commands.ts
// Tradução pura dos formulários manuais em DealCommand (sem banco), validada com DealCommandSchema.
// Mantém os contratos de entrada das ações antigas (createSaleAction / createTradeAction).

import type { DealCommand, PaymentMethodType } from '@/types/deal-command';
import type { PaymentMethod } from '@/types/domain';
import { validateDealCommandPayload } from '@/lib/ai/schemas/deal-command.schema';
import { toCents } from '@/lib/finance/money';

export interface CreateSaleInput {
  customerId: string;
  itemId: string;
  totalValue: number;
  paymentMethod?: PaymentMethod;
  /** Valor recebido no ato (entrada ou pagamento à vista). */
  cashInflow?: number;
  /** "Deu uma mercadoria" como parte do pagamento: entra no estoque pelo valor negociado. */
  itemIn?: {
    name: string;
    evaluatedValue: number;
    category?: string;
  };
  receivable?: {
    totalAmount: number;
    installmentsCount: number;
    installmentValue: number;
    firstDueDate?: string;
    dueDayOfMonth?: number;
    intervalDays?: number;
    isPromissory?: boolean;
  };
  notes?: string;
  /** Evita duplicar a venda em duplo clique / reenvio do formulário. */
  idempotencyKey?: string;
}

export interface CreateTradeInput {
  customerId: string;
  itemOutId: string;
  itemIn: {
    name: string;
    evaluatedValue: number;
    category?: string;
  };
  tradeBalance: number;
  direction: 'received' | 'paid' | 'even';
  immediatePaymentMethod?: PaymentMethod;
  immediateCash?: number;
  installments?: {
    count: number;
    value: number;
    dueDay?: number;
    firstDueDate?: string;
  };
  notes?: string;
  idempotencyKey?: string;
}

export type ManualBuildResult = { ok: true; command: DealCommand } | { ok: false; error: string };

function method(m?: PaymentMethod): PaymentMethodType {
  if (!m) return 'other';
  if (m === 'debit_card' || m === 'credit_card') return 'card';
  return m;
}

function empty(customerId: string, notes?: string, idempotencyKey?: string): DealCommand {
  return {
    intent: 'create_deal',
    counterparty: { id: customerId, name: 'Cliente' },
    itemsIn: [],
    itemsOut: [],
    cashIn: [],
    cashOut: [],
    receivables: [],
    payables: [],
    adjustments: [],
    notes,
    idempotencyKey,
    missingInformation: [],
    ambiguities: [],
  };
}

function validated(cmd: DealCommand): ManualBuildResult {
  const res = validateDealCommandPayload(cmd);
  return res.success && res.data ? { ok: true, command: res.data as DealCommand } : { ok: false, error: `Dados inválidos: ${res.error}` };
}

export function buildManualSaleCommand(input: CreateSaleInput): ManualBuildResult {
  if (!input.customerId || !input.itemId) return { ok: false, error: 'Informe o cliente e a mercadoria.' };
  if (!(input.totalValue > 0)) return { ok: false, error: 'Informe o valor da venda.' };

  const cmd = empty(input.customerId, input.notes, input.idempotencyKey);
  cmd.itemsOut.push({ itemId: input.itemId, negotiatedValue: input.totalValue, direction: 'OUT' });
  if (input.itemIn) {
    if (!input.itemIn.name?.trim() || !(input.itemIn.evaluatedValue > 0)) return { ok: false, error: 'Informe a mercadoria recebida e o valor dela.' };
    cmd.itemsIn.push({ description: input.itemIn.name.trim(), negotiatedValue: input.itemIn.evaluatedValue, direction: 'IN' });
  }
  if (input.cashInflow && input.cashInflow > 0) {
    cmd.cashIn.push({ amount: input.cashInflow, method: method(input.paymentMethod), direction: 'IN' });
  }
  if (input.receivable && input.receivable.totalAmount > 0) {
    const r = input.receivable;
    if (toCents(r.installmentsCount * r.installmentValue) !== toCents(r.totalAmount)) {
      return { ok: false, error: `As parcelas (${r.installmentsCount}x de ${r.installmentValue}) não fecham com o valor a receber (${r.totalAmount}).` };
    }
    cmd.receivables.push({
      totalAmount: r.totalAmount,
      installments: {
        count: r.installmentsCount,
        installmentAmount: r.installmentValue,
        firstDueDate: r.firstDueDate,
        dueDayOfMonth: r.dueDayOfMonth,
        intervalDays: r.intervalDays ?? 30,
        isPromissory: r.isPromissory ?? false,
      },
    });
  }
  return validated(cmd);
}

export function buildManualTradeCommand(input: CreateTradeInput): ManualBuildResult {
  if (!input.customerId || !input.itemOutId || !input.itemIn?.name) return { ok: false, error: 'Informe o cliente e as mercadorias da troca.' };
  if (!(input.itemIn.evaluatedValue >= 0) || !(input.tradeBalance >= 0)) return { ok: false, error: 'Valores da troca inválidos.' };

  const balance = input.direction === 'even' ? 0 : input.tradeBalance;
  // valor(sai) + pago pelo usuário = valor(entra) + recebido pelo usuário
  const outValue = input.direction === 'received' ? input.itemIn.evaluatedValue + balance : input.itemIn.evaluatedValue - balance;
  if (outValue < 0) return { ok: false, error: 'A volta paga é maior que o valor do item recebido.' };

  const cmd = empty(input.customerId, input.notes, input.idempotencyKey);
  cmd.itemsOut.push({ itemId: input.itemOutId, negotiatedValue: outValue, direction: 'OUT' });
  cmd.itemsIn.push({ description: input.itemIn.name, negotiatedValue: input.itemIn.evaluatedValue, direction: 'IN' });

  const immediate = Math.min(input.immediateCash ?? 0, balance);
  const remaining = toCents(balance) - toCents(immediate);
  if (immediate > 0) {
    const movement = { amount: immediate, method: method(input.immediatePaymentMethod), direction: input.direction === 'received' ? ('IN' as const) : ('OUT' as const) };
    if (input.direction === 'received') cmd.cashIn.push(movement);
    else cmd.cashOut.push(movement);
  }

  if (remaining > 0) {
    const inst = input.installments;
    if (!inst || inst.count < 1) return { ok: false, error: 'Informe como fica o restante da volta (parcelas).' };
    if (toCents(inst.count * inst.value) !== remaining) {
      return { ok: false, error: `As parcelas (${inst.count}x de ${inst.value}) não fecham com o restante da volta (${remaining / 100}).` };
    }
    const obligation = {
      totalAmount: remaining / 100,
      installments: { count: inst.count, installmentAmount: inst.value, dueDayOfMonth: inst.dueDay, firstDueDate: inst.firstDueDate, intervalDays: 30, isPromissory: false },
    };
    if (input.direction === 'received') cmd.receivables.push(obligation);
    else cmd.payables.push(obligation);
  }
  return validated(cmd);
}
