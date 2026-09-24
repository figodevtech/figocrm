// src/lib/ai/schemas/deal-command.schema.ts
// Schema Zod para Structured Output de LLMs — Fase 29 do FigoCRM
// Garante que a saída gerada pela IA seja estritamente validada antes de qualquer processamento de domínio.

import { z } from 'zod';

export const FlowDirectionSchema = z.enum(['IN', 'OUT']);

export const PaymentMethodSchema = z.enum([
  'pix',
  'cash',
  'bank_transfer',
  'card',
  'other',
]);

export const AdjustmentTypeSchema = z.enum([
  'discount',
  'debt_offset',
  'service_offset',
  'item_offset',
  'manual_adjustment',
]);

export const MissingInformationTypeSchema = z.enum([
  'deal_total',
  'item_reference',
  'customer_reference',
  'acquisition_cost',
  'payment_breakdown',
  'installments_count',
  'installment_due_date',
  'trade_balance_direction',
  'loan_interest',
]);

export const AmbiguityTypeSchema = z.enum([
  'value',
  'customer',
  'item',
  'direction',
  'installment',
  'destructive',
]);

export const MissingInformationItemSchema = z.object({
  type: MissingInformationTypeSchema,
  description: z.string(),
  promptQuestion: z.string(),
});

export const AmbiguityItemSchema = z.object({
  field: z.string(),
  type: AmbiguityTypeSchema,
  description: z.string(),
  possibleInterpretations: z.array(z.string()),
  suggestedPrompt: z.string(),
});

export const CounterpartyReferenceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Nome do cliente/contraparte não pode ser vazio.'),
  phone: z.string().optional(),
  document: z.string().optional(),
});

export const ItemMovementSchema = z.object({
  reference: z.string().optional(),
  itemId: z.string().optional(),
  description: z.string().optional(),
  negotiatedValue: z.number().nonnegative().optional(),
  acquisitionValue: z.number().nonnegative().optional(),
  newItem: z.boolean().optional(),
  direction: FlowDirectionSchema,
});

export const CashMovementSchema = z.object({
  direction: FlowDirectionSchema,
  amount: z.number().positive('Valor monetário em dinheiro/pix deve ser maior que zero.'),
  method: PaymentMethodSchema.default('pix'),
  notes: z.string().optional(),
});

export const InstallmentScheduleSchema = z.object({
  count: z.number().int().positive('Quantidade de parcelas deve ser positiva.'),
  installmentAmount: z.number().positive('Valor da parcela deve ser positivo.'),
  firstDueDate: z.string().optional(),
  dueDayOfMonth: z.number().int().min(1).max(31).optional(),
  intervalDays: z.number().int().positive().default(30),
  isPromissory: z.boolean().default(false),
  manualInstallments: z
    .array(
      z.object({
        number: z.number().int(),
        amount: z.number(),
        dueDate: z.string(),
      })
    )
    .optional(),
});

export const ReceivableCommandSchema = z.object({
  id: z.string().optional(),
  totalAmount: z.number().positive('Valor a receber deve ser maior que zero.'),
  description: z.string().optional(),
  installments: InstallmentScheduleSchema.optional(),
});

export const PayableCommandSchema = z.object({
  id: z.string().optional(),
  totalAmount: z.number().positive('Valor a pagar deve ser maior que zero.'),
  description: z.string().optional(),
  installments: InstallmentScheduleSchema.optional(),
});

export const AdjustmentCommandSchema = z.object({
  type: AdjustmentTypeSchema,
  amount: z.number().positive('Valor do abatimento/desconto deve ser positivo.'),
  reason: z.string().optional(),
});

/**
 * Schema Canônico de Validação do DealCommand
 */
export const DealCommandSchema = z.object({
  intent: z.literal('create_deal'),
  counterparty: CounterpartyReferenceSchema.optional(),
  itemsIn: z.array(ItemMovementSchema).default([]),
  itemsOut: z.array(ItemMovementSchema).default([]),
  cashIn: z.array(CashMovementSchema).default([]),
  cashOut: z.array(CashMovementSchema).default([]),
  receivables: z.array(ReceivableCommandSchema).default([]),
  payables: z.array(PayableCommandSchema).default([]),
  adjustments: z.array(AdjustmentCommandSchema).default([]),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  missingInformation: z.array(MissingInformationItemSchema).default([]),
  ambiguities: z.array(AmbiguityItemSchema).default([]),
});

export type ValidatedDealCommand = z.infer<typeof DealCommandSchema>;

/**
 * Função utilitária para validação em runtime com tipagem segura
 */
export function validateDealCommandPayload(payload: unknown): {
  success: boolean;
  data?: ValidatedDealCommand;
  error?: string;
} {
  const result = DealCommandSchema.safeParse(payload);
  if (!result.success) {
    const formattedError = (result.error.issues as Array<{ path?: Array<string | number | symbol>; message: string }>).map((e) => `${(e.path || []).join('.')}: ${e.message}`).join('; ');
    return {
      success: false,
      error: formattedError,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}
