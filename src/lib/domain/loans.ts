// src/lib/domain/loans.ts
// Empréstimo com juros: formulário e voz passam pelo MESMO caminho
//   entrada → planLoan (termos + grade, domínio puro) → RPC create_loan_contract (atômica)
// O banco confere juros, total e grade; pagamento, estorno e renegociação usam as RPCs de dívida já existentes.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toReais } from '@/lib/finance/money';
import { writeDeniedMessage } from '@/lib/subscription';
import { LoanPlan, LoanPlanInput, planLoan } from '@/lib/domain/loan-plan';

export { planLoan, todayISO } from '@/lib/domain/loan-plan';
export type { LoanPlan } from '@/lib/domain/loan-plan';

export interface CreateLoanInput extends LoanPlanInput {
  customerId: string;
  source: 'manual' | 'voice';
}

export function buildLoanPayload(input: CreateLoanInput, plan: Extract<LoanPlan, { ok: true }>) {
  const { terms, schedule } = plan;
  return {
    customer_id: input.customerId,
    principal_amount: toReais(terms.principalCents),
    interest_type: terms.interestType,
    interest_rate: terms.interestRate,
    interest_amount: toReais(terms.interestCents),
    total_amount: toReais(terms.totalCents),
    installments_count: terms.installmentsCount,
    start_date: plan.startDate,
    payment_method: input.paymentMethod ?? 'pix',
    notes: input.notes?.trim() || null,
    source: input.source,
    idempotency_key: input.idempotencyKey || null,
    installments: schedule.map((s) => ({ installment_number: s.number, original_value: toReais(s.amountCents), due_date: s.dueDate })),
  };
}

export interface CreateLoanResult {
  success: boolean;
  loanContractId?: string;
  receivableId?: string;
  alreadyExecuted?: boolean;
  plan?: Extract<LoanPlan, { ok: true }>;
  error?: string;
  errorType?: 'validation' | 'subscription' | 'database';
}

export async function createLoanContract(supabase: SupabaseClient, input: CreateLoanInput, now: Date = new Date()): Promise<CreateLoanResult> {
  if (!input.customerId) return { success: false, error: 'Escolha o cliente.', errorType: 'validation' };
  const plan = planLoan(input, now);
  if (!plan.ok) return { success: false, error: plan.error, errorType: 'validation' };

  const { data, error } = await supabase.rpc('create_loan_contract', { p_payload: buildLoanPayload(input, plan) });
  if (error) {
    const subscription = error.hint === 'SUBSCRIPTION_INACTIVE' || error.message.includes('Assinatura inativa');
    return {
      success: false,
      error: subscription ? writeDeniedMessage('expired') : 'Não consegui salvar o empréstimo. Nada foi gravado.',
      errorType: subscription ? 'subscription' : 'database',
    };
  }
  const res = data as { loan_contract_id: string; receivable_id: string; already_executed?: boolean };
  return {
    success: true,
    loanContractId: res.loan_contract_id,
    receivableId: res.receivable_id,
    alreadyExecuted: !!res.already_executed,
    plan,
  };
}
