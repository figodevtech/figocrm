// src/types/deal-command.ts
// Contrato Universal de Negociação — Fase 25 do FigoCRM
// Representa de forma unificada e canônica qualquer negócio:
// venda à vista, parcelada, trocas secas, trocas com volta, abatimentos e compensações.

export type FlowDirection = 'IN' | 'OUT';

export type PaymentMethodType = 'pix' | 'cash' | 'bank_transfer' | 'card' | 'other';

export type AdjustmentType =
  | 'discount'
  | 'debt_offset'
  | 'service_offset'
  | 'item_offset'
  | 'manual_adjustment';

export type MissingInformationType =
  | 'deal_total'
  | 'item_reference'
  | 'customer_reference'
  | 'acquisition_cost'
  | 'payment_breakdown'
  | 'installments_count'
  | 'installment_due_date'
  | 'trade_balance_direction'
  | 'loan_interest';

export interface MissingInformationItem {
  type: MissingInformationType;
  description: string;
  promptQuestion: string;
}

export type AmbiguityType =
  | 'value'
  | 'customer'
  | 'item'
  | 'direction'
  | 'installment'
  | 'destructive';

export interface AmbiguityItem {
  field: string;
  type: AmbiguityType;
  description: string;
  possibleInterpretations: string[];
  suggestedPrompt: string;
}

export interface CounterpartyReference {
  id?: string;
  name: string;
  phone?: string;
  document?: string;
}

export interface ItemMovement {
  reference?: string;
  itemId?: string;
  description?: string;
  negotiatedValue?: number;
  acquisitionValue?: number;
  direction: FlowDirection;
}

export interface CashMovementCommand {
  direction: FlowDirection;
  amount: number;
  method?: PaymentMethodType;
  notes?: string;
}

export interface InstallmentScheduleCommand {
  count: number;
  installmentAmount: number;
  firstDueDate?: string;
  dueDayOfMonth?: number;
  intervalDays?: number;
  isPromissory?: boolean;
  manualInstallments?: Array<{
    number: number;
    amount: number;
    dueDate: string;
  }>;
}

export interface ReceivableCommand {
  id?: string;
  totalAmount: number;
  description?: string;
  installments?: InstallmentScheduleCommand;
}

export interface PayableCommand {
  id?: string;
  totalAmount: number;
  description?: string;
  installments?: InstallmentScheduleCommand;
}

export interface AdjustmentCommand {
  type: AdjustmentType;
  amount: number;
  reason?: string;
}

/**
 * Contrato Universal de Negociação
 * Qualquer operação de venda, compra, permuta ou renegociação converge para este contrato.
 */
export interface DealCommand {
  intent: 'create_deal';

  counterparty?: CounterpartyReference;

  itemsIn: ItemMovement[];
  itemsOut: ItemMovement[];

  cashIn: CashMovementCommand[];
  cashOut: CashMovementCommand[];

  receivables: ReceivableCommand[];
  payables: PayableCommand[];

  adjustments: AdjustmentCommand[];

  notes?: string;
  idempotencyKey?: string;

  missingInformation: MissingInformationItem[];
  ambiguities: AmbiguityItem[];
}
