// src/lib/ai/schemas/llm-interpretation.schema.ts
// Contrato de Structured Output da LLM — Fase B do hardening.
// A LLM devolve SOMENTE este objeto. Ele é validado com Zod (.strict) antes de qualquer uso;
// objeto parcial ou com campo extra é rejeitado e nunca chega ao executor.
// O JSON Schema abaixo é enviado à OpenAI em modo `json_schema` strict e precisa espelhar o Zod
// (tests/unit garante que as chaves batem).

import { z } from 'zod';

export const LLM_INTENTS = [
  'create_sale',
  'create_trade',
  'create_purchase',
  'register_payment',
  'register_partial_payment',
  'register_adjustment',
  'update_due_date',
  'renegotiate_debt',
  'query_information',
  'clarify_ambiguity',
  'unrecognized_command',
] as const;

export const LLM_QUERY_TYPES = [
  'quanto_fulano_deve',
  'quanto_tenho_na_rua',
  'quanto_tenho_em_mercadoria',
  'quem_esta_atrasado',
  'qual_proxima_parcela',
  'quanto_ganhei_esse_mes',
] as const;

export const LLM_MISSING_TYPES = [
  'deal_total',
  'item_reference',
  'customer_reference',
  'acquisition_cost',
  'payment_breakdown',
  'installments_count',
  'installment_due_date',
  'trade_balance_direction',
] as const;

export const LLM_AMBIGUITY_TYPES = ['value', 'customer', 'item', 'direction', 'installment', 'destructive'] as const;

const MAX_MONEY = 100_000_000;
const money = z.number().nonnegative().max(MAX_MONEY).nullable();

export const LLMInterpretationSchema = z
  .object({
    intent: z.enum(LLM_INTENTS),
    customerName: z.string().trim().min(1).max(120).nullable(),
    item: z.string().trim().min(1).max(160).nullable(),
    itemOut: z.string().trim().min(1).max(160).nullable(),
    itemIn: z.string().trim().min(1).max(160).nullable(),
    totalValue: money,
    itemInValue: money,
    cashIn: money,
    cashOut: money,
    paymentMethod: z.enum(['pix', 'cash', 'bank_transfer', 'card', 'other']).nullable(),
    tradeBalance: money,
    direction: z.enum(['inflow', 'outflow', 'even']).nullable(),
    receivable: money,
    payable: money,
    installmentsCount: z.number().int().positive().max(360).nullable(),
    installmentAmount: money,
    dueDay: z.number().int().min(1).max(31).nullable(),
    dueMonthOffset: z.number().int().min(0).max(24).nullable(),
    firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    amount: money,
    paymentScope: z.enum(['amount', 'installment_full', 'debt_full']).nullable(),
    installmentRef: z.enum(['first', 'next', 'last', 'overdue']).nullable(),
    installmentNumber: z.number().int().positive().max(360).nullable(),
    debtHint: z.string().trim().min(1).max(160).nullable(),
    adjustmentType: z.enum(['discount', 'item_offset', 'service_offset', 'debt_offset']).nullable(),
    queryType: z.enum(LLM_QUERY_TYPES).nullable(),
    missingInformation: z
      .array(z.object({ type: z.enum(LLM_MISSING_TYPES), question: z.string().min(1).max(300) }).strict())
      .max(10),
    ambiguities: z
      .array(
        z
          .object({
            field: z.string().min(1).max(60),
            type: z.enum(LLM_AMBIGUITY_TYPES),
            question: z.string().min(1).max(300),
            options: z.array(z.string().max(160)).max(10),
          })
          .strict()
      )
      .max(10),
  })
  .strict();

export type LLMInterpretation = z.infer<typeof LLMInterpretationSchema>;

// ---------------------------------------------------------------------------------------------
// JSON Schema (OpenAI Structured Outputs, strict: todos os campos obrigatórios, nulos explícitos)
// ---------------------------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

const nullableString = (): JsonSchema => ({ type: ['string', 'null'] });
const nullableNumber = (): JsonSchema => ({ type: ['number', 'null'] });
const nullableInteger = (): JsonSchema => ({ type: ['integer', 'null'] });
const nullableEnum = (values: readonly string[]): JsonSchema => ({ type: ['string', 'null'], enum: [...values, null] });

function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export const LLM_INTERPRETATION_JSON_SCHEMA: JsonSchema = strictObject({
  intent: { type: 'string', enum: [...LLM_INTENTS] },
  customerName: nullableString(),
  item: nullableString(),
  itemOut: nullableString(),
  itemIn: nullableString(),
  totalValue: nullableNumber(),
  itemInValue: nullableNumber(),
  cashIn: nullableNumber(),
  cashOut: nullableNumber(),
  paymentMethod: nullableEnum(['pix', 'cash', 'bank_transfer', 'card', 'other']),
  tradeBalance: nullableNumber(),
  direction: nullableEnum(['inflow', 'outflow', 'even']),
  receivable: nullableNumber(),
  payable: nullableNumber(),
  installmentsCount: nullableInteger(),
  installmentAmount: nullableNumber(),
  dueDay: nullableInteger(),
  dueMonthOffset: nullableInteger(),
  firstDueDate: nullableString(),
  amount: nullableNumber(),
  paymentScope: nullableEnum(['amount', 'installment_full', 'debt_full']),
  installmentRef: nullableEnum(['first', 'next', 'last', 'overdue']),
  installmentNumber: nullableInteger(),
  debtHint: nullableString(),
  adjustmentType: nullableEnum(['discount', 'item_offset', 'service_offset', 'debt_offset']),
  queryType: nullableEnum(LLM_QUERY_TYPES),
  missingInformation: {
    type: 'array',
    items: strictObject({
      type: { type: 'string', enum: [...LLM_MISSING_TYPES] },
      question: { type: 'string' },
    }),
  },
  ambiguities: {
    type: 'array',
    items: strictObject({
      field: { type: 'string' },
      type: { type: 'string', enum: [...LLM_AMBIGUITY_TYPES] },
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
    }),
  },
});

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`);
}
