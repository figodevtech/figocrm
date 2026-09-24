// src/lib/domain/financial-target-resolver.ts
// Resolução explícita do alvo financeiro — Fase C do hardening.
//   cliente → negociação/dívida (receivable) → parcela
// Pagamentos, parciais, quitações, abatimentos e mudanças de vencimento SEMPRE passam por aqui.
// Nunca usa "a primeira parcela aberta do usuário": a busca é restrita às dívidas do cliente resolvido,
// e dívidas múltiplas sem referência no contexto geram pergunta ao usuário.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext } from '@/lib/ai/context_manager';
import {
  EntityCandidate,
  joinOr,
  nameTokens,
  referenceMatchesName,
  resolveCustomerReference,
  ResolvedCustomer,
} from '@/lib/domain/entity-resolver';

export type InstallmentReference = 'first' | 'next' | 'last' | 'overdue' | number;

export interface FinancialTargetRequest {
  customer: { id?: string; name?: string };
  /** Referência à dívida pela mercadoria ("a dívida da moto"). */
  debtHint?: string;
  /** Dívida já escolhida pelo usuário numa desambiguação anterior. */
  receivableId?: string;
  installmentRef?: InstallmentReference;
}

export interface OpenInstallment {
  id: string;
  number: number;
  totalInstallments: number;
  originalValue: number;
  balance: number;
  dueDate: string;
  status: string;
}

export interface ResolvedDebt {
  id: string;
  /** Dívida de negócio (venda/troca) ou de empréstimo — exatamente um dos dois. */
  dealId: string | null;
  loanContractId: string | null;
  totalAmount: number;
  balance: number;
  label: string;
  installments: OpenInstallment[];
}

export type FinancialTargetResult =
  | {
      status: 'resolved';
      customer: ResolvedCustomer;
      debt: ResolvedDebt;
      installment?: OpenInstallment;
    }
  | {
      status: 'ambiguous';
      field: 'customer' | 'debt';
      promptQuestion: string;
      candidates: EntityCandidate[];
      customer?: ResolvedCustomer;
    }
  | {
      status: 'not_found';
      field: 'customer' | 'debt' | 'installment';
      promptQuestion: string;
      customer?: ResolvedCustomer;
    };

type ReceivableRow = {
  id: string;
  deal_id: string | null;
  loan_contract_id: string | null;
  total_amount: number;
  balance: number;
  created_at: string;
  deals: { deal_date: string; deal_items: Array<{ direction: string; items: { name: string } | null }> } | null;
  loan_contracts: { principal_amount: number; start_date: string } | null;
};

function debtLabel(row: ReceivableRow): string {
  if (row.loan_contract_id) {
    // "empréstimo" casa com debtHint da fala ("pagou a segunda do empréstimo")
    const principal = row.loan_contracts ? Number(row.loan_contracts.principal_amount) : 0;
    return principal > 0 ? `Empréstimo de R$ ${principal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}` : 'Empréstimo';
  }
  const outItems = (row.deals?.deal_items || [])
    .filter((di) => di.direction === 'OUT' && di.items?.name)
    .map((di) => di.items!.name);
  if (outItems.length > 0) return outItems.join(' + ');
  const date = row.deals?.deal_date ? new Date(`${row.deals.deal_date}T12:00:00`).toLocaleDateString('pt-BR') : '';
  return date ? `negócio de ${date}` : 'negócio sem mercadoria';
}

/** Seleção pura da parcela alvo a partir da referência falada. */
export function pickInstallment(
  all: OpenInstallment[],
  ref: InstallmentReference | undefined,
  today: string = new Date().toISOString().slice(0, 10)
): { installment?: OpenInstallment; error?: string } {
  if (ref === undefined) return {};
  const open = all.filter((i) => i.status !== 'paid' && i.status !== 'canceled' && i.balance > 0);

  if (ref === 'first' || typeof ref === 'number') {
    const n = ref === 'first' ? 1 : ref;
    const inst = all.find((i) => i.number === n);
    if (!inst) return { error: `Essa dívida não tem parcela ${n}.` };
    if (inst.status === 'renegotiated') return { error: `A parcela ${n} foi renegociada.` };
    if (!open.includes(inst)) return { error: `A parcela ${n} já está quitada.` };
    return { installment: inst };
  }
  if (ref === 'next') return open[0] ? { installment: open[0] } : { error: 'Não há parcela em aberto.' };
  if (ref === 'last') return open.length > 0 ? { installment: open[open.length - 1] } : { error: 'Não há parcela em aberto.' };
  const overdue = open.filter((i) => i.dueDate < today);
  return overdue[0] ? { installment: overdue[0] } : { error: 'Não há parcela atrasada nessa dívida.' };
}

export async function resolveFinancialTarget(
  supabase: SupabaseClient,
  userId: string,
  context: ConversationContext,
  request: FinancialTargetRequest
): Promise<FinancialTargetResult> {
  // 1. Cliente (ID do contexto tem prioridade quando a fala se refere a ele)
  const customerRes = await resolveCustomerReference(supabase, userId, {
    id: request.customer.id,
    name: request.customer.name,
    context: context.lastCustomer,
  });

  if (customerRes.status === 'ambiguous') {
    return { status: 'ambiguous', field: 'customer', promptQuestion: customerRes.promptQuestion!, candidates: customerRes.candidates! };
  }
  if (customerRes.status === 'not_found' || !customerRes.entity) {
    return { status: 'not_found', field: 'customer', promptQuestion: customerRes.promptQuestion || 'De qual cliente você está falando?' };
  }
  const customer = customerRes.entity;

  // 2. Dívidas em aberto SOMENTE deste cliente
  const { data, error } = await supabase
    .from('receivables')
    .select('id, deal_id, loan_contract_id, total_amount, balance, created_at, deals(deal_date, deal_items(direction, items(name))), loan_contracts(principal_amount, start_date)')
    .eq('user_id', userId)
    .eq('customer_id', customer.id)
    .in('status', ['pending', 'partially_paid'])
    .gt('balance', 0)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Falha ao consultar dívidas: ${error.message}`);
  const receivables = (data || []) as unknown as ReceivableRow[];

  if (receivables.length === 0) {
    return { status: 'not_found', field: 'debt', customer, promptQuestion: `${customer.name} não tem dívida em aberto.` };
  }

  let chosen: ReceivableRow | undefined;

  if (request.receivableId) {
    chosen = receivables.find((r) => r.id === request.receivableId);
    if (!chosen) {
      return { status: 'not_found', field: 'debt', customer, promptQuestion: `Essa dívida de ${customer.name} não está mais em aberto.` };
    }
  } else if (request.debtHint && nameTokens(request.debtHint).length > 0) {
    const matching = receivables.filter((r) => referenceMatchesName(request.debtHint!, debtLabel(r)));
    if (matching.length === 1) chosen = matching[0];
    else if (matching.length === 0) {
      return {
        status: 'not_found',
        field: 'debt',
        customer,
        promptQuestion: `Não achei dívida de ${customer.name} referente a ${request.debtHint}.`,
      };
    } else {
      return ambiguousDebts(customer, matching);
    }
  } else if (receivables.length === 1) {
    chosen = receivables[0];
  } else if (context.lastReceivableId) {
    // Continuidade da conversa: a dívida em contexto precisa ser deste mesmo cliente
    chosen = receivables.find((r) => r.id === context.lastReceivableId);
  }

  if (!chosen) return ambiguousDebts(customer, receivables);

  // 3. Parcelas da dívida escolhida
  const { data: instRows, error: instError } = await supabase
    .from('installments')
    .select('id, installment_number, total_installments, original_value, balance, due_date, status')
    .eq('user_id', userId)
    .eq('receivable_id', chosen.id)
    .order('due_date', { ascending: true })
    .order('installment_number', { ascending: true });

  if (instError) throw new Error(`Falha ao consultar parcelas: ${instError.message}`);

  const installments: OpenInstallment[] = (instRows || []).map((i) => ({
    id: i.id,
    number: i.installment_number,
    totalInstallments: i.total_installments,
    originalValue: Number(i.original_value),
    balance: Number(i.balance),
    dueDate: i.due_date,
    status: i.status,
  }));

  const debt: ResolvedDebt = {
    id: chosen.id,
    dealId: chosen.deal_id,
    loanContractId: chosen.loan_contract_id,
    totalAmount: Number(chosen.total_amount),
    balance: Number(chosen.balance),
    label: debtLabel(chosen),
    installments,
  };

  const picked = pickInstallment(installments, request.installmentRef);
  if (picked.error) {
    return { status: 'not_found', field: 'installment', customer, promptQuestion: `${picked.error} Qual parcela de ${customer.name}?` };
  }

  return { status: 'resolved', customer, debt, installment: picked.installment };
}

function ambiguousDebts(customer: ResolvedCustomer, rows: ReceivableRow[]): FinancialTargetResult {
  const candidates = rows.map((r) => ({
    id: r.id,
    name: debtLabel(r),
    detail: `saldo R$ ${Number(r.balance).toFixed(2)}`,
  }));
  return {
    status: 'ambiguous',
    field: 'debt',
    customer,
    candidates,
    promptQuestion: `${customer.name} tem mais de uma dívida. Qual delas: ${joinOr(candidates.map((c) => c.name))}?`,
  };
}

// ------------------------------------------------------------------------------------------------
// Alvo de estorno: cliente → operações (settlements) ainda não estornadas → uma operação
// ------------------------------------------------------------------------------------------------

export interface ReversibleSettlement {
  id: string;
  kind: 'payment' | 'adjustment';
  amount: number;
  createdAt: string;
  receivableId: string | null;
}

export type ReversalTargetResult =
  | { status: 'resolved'; customer: ResolvedCustomer; settlement: ReversibleSettlement }
  | { status: 'ambiguous'; field: 'customer' | 'settlement'; promptQuestion: string; candidates: EntityCandidate[]; customer?: ResolvedCustomer }
  | { status: 'not_found'; promptQuestion: string; customer?: ResolvedCustomer };

/** Sem valor dito, só vale a operação feita nesta conversa (janela do contexto). */
export const REVERSAL_RECENT_WINDOW_MS = 30 * 60 * 1000;

const brlLabel = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function settlementLabel(s: ReversibleSettlement): string {
  const when = new Date(s.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `${s.kind === 'payment' ? 'pagamento' : 'abatimento'} de ${brlLabel(s.amount)} em ${when}`;
}

/** Seleção pura entre as operações do cliente (testável sem banco). */
export function pickSettlement(
  rows: ReversibleSettlement[],
  filter: { amount?: number; kind?: 'payment' | 'adjustment' },
  now: number = Date.now()
): { status: 'resolved'; settlement: ReversibleSettlement } | { status: 'ambiguous' | 'not_found'; matches: ReversibleSettlement[] } {
  let matches = rows.filter((r) => (!filter.kind || r.kind === filter.kind));
  if (filter.amount !== undefined) {
    matches = matches.filter((r) => Math.round(r.amount * 100) === Math.round(filter.amount! * 100));
  } else {
    matches = matches.filter((r) => now - new Date(r.createdAt).getTime() <= REVERSAL_RECENT_WINDOW_MS);
  }
  if (matches.length === 1) return { status: 'resolved', settlement: matches[0] };
  return { status: matches.length === 0 ? 'not_found' : 'ambiguous', matches };
}

export async function resolveReversalTarget(
  supabase: SupabaseClient,
  userId: string,
  context: ConversationContext,
  request: { customer: { id?: string; name?: string }; amount?: number; kind?: 'payment' | 'adjustment'; settlementId?: string }
): Promise<ReversalTargetResult> {
  const customerRes = await resolveCustomerReference(supabase, userId, {
    id: request.customer.id,
    name: request.customer.name,
    context: context.lastCustomer,
  });
  if (customerRes.status === 'ambiguous') {
    return { status: 'ambiguous', field: 'customer', promptQuestion: customerRes.promptQuestion!, candidates: customerRes.candidates! };
  }
  if (!customerRes.entity) {
    return { status: 'not_found', promptQuestion: customerRes.promptQuestion || 'De qual cliente é a operação que você quer desfazer?' };
  }
  const customer = customerRes.entity;

  const { data, error } = await supabase
    .from('settlements')
    .select('id, kind, amount, created_at, receivable_id, reversal_of')
    .eq('user_id', userId)
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Falha ao consultar operações: ${error.message}`);

  const all = (data || []) as Array<{ id: string; kind: 'payment' | 'adjustment'; amount: number; created_at: string; receivable_id: string | null; reversal_of: string | null }>;
  const reversed = new Set(all.filter((r) => r.reversal_of).map((r) => r.reversal_of!));
  const rows: ReversibleSettlement[] = all
    .filter((r) => !r.reversal_of && !reversed.has(r.id))
    .map((r) => ({ id: r.id, kind: r.kind, amount: Number(r.amount), createdAt: r.created_at, receivableId: r.receivable_id }));

  if (request.settlementId) {
    const chosen = rows.find((r) => r.id === request.settlementId);
    return chosen
      ? { status: 'resolved', customer, settlement: chosen }
      : { status: 'not_found', customer, promptQuestion: 'Essa operação já foi desfeita ou não existe mais.' };
  }

  const picked = pickSettlement(rows, { amount: request.amount, kind: request.kind });
  if (picked.status === 'resolved') return { status: 'resolved', customer, settlement: picked.settlement };

  const what = request.kind === 'adjustment' ? 'abatimento' : request.kind === 'payment' ? 'pagamento' : 'lançamento';
  if (picked.status === 'not_found') {
    return {
      status: 'not_found',
      customer,
      promptQuestion:
        request.amount !== undefined
          ? `Não achei ${what} de ${brlLabel(request.amount)} do ${customer.name} para desfazer.`
          : `Qual ${what} do ${customer.name} você quer desfazer? Me diga o valor.`,
    };
  }
  const candidates = picked.matches.slice(0, 5).map((m) => ({ id: m.id, name: settlementLabel(m) }));
  return {
    status: 'ambiguous',
    field: 'settlement',
    customer,
    candidates,
    promptQuestion: `${customer.name} tem mais de um ${what} assim. Qual deles: ${joinOr(candidates.map((c) => c.name))}?`,
  };
}
