// src/lib/domain/command-executor.ts
// Executor seguro de negociações — camada única entre a IA/APIs e o banco.
// Garante: schema válido, entitlement de escrita, ausência de ambiguidade, balanço contábil fechado,
// resolução de entidades sem escolha silenciosa e execução atômica via RPC `execute_deal_transaction`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWritePermission, writeDeniedMessage } from '@/lib/subscription';
import { trackProductEvent } from '@/lib/analytics/events';
import { DealCommand } from '@/types/deal-command';
import { validateDealCommandPayload } from '@/lib/ai/schemas/deal-command.schema';
import { validateDealBalance } from '@/lib/finance/deal-balance';
import { calculateItemCMVCents, calculateDealTotalCMVCents } from '@/lib/finance/cmv';
import { calculateProjectedProfitCents } from '@/lib/finance/profit';
import { generateInstallmentScheduleCents } from '@/lib/finance/installments';
import { toCents, toReais } from '@/lib/finance/money';
import type { ConversationContext } from '@/lib/ai/context_manager';
import {
  EntityCandidate,
  resolveCustomerReference,
  resolveItemReference,
  ResolvedItem,
} from '@/lib/domain/entity-resolver';

/** Nome do cliente avulso quando a fala não disse com quem foi o negócio. */
export const UNNAMED_CUSTOMER = 'Cliente avulso';

export interface PendingEntityChoice {
  field: 'customer' | 'item';
  /** Índice do item em itemsOut quando field = 'item'. */
  index?: number;
  candidates: EntityCandidate[];
}

export interface CommandExecutionResult {
  success: boolean;
  dealId?: string;
  humanSummary: string;
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
  missingInformation?: string[];
  pendingChoice?: PendingEntityChoice;
  error?: string;
  errorType?: 'validation' | 'subscription' | 'plan_customer_limit' | 'resolution' | 'balance' | 'database';
  alreadyExecuted?: boolean;
  resolved?: {
    customer?: { id: string; name: string };
    itemsOut?: Array<{ id: string; name: string }>;
    receivableIds?: string[];
  };
  /** Mercadorias vendidas sem estar no estoque e sem custo informado (lucro pendente). */
  pendingCostItems?: Array<{ id: string; name: string; negotiatedValue: number }>;
  /** Cadastros criados como avulsos neste negócio (para a resposta e para vincular depois). */
  provisional?: { customer?: { id: string; name: string }; items: Array<{ id: string; name: string }> };
}

export interface ExecutionDeps {
  supabase: SupabaseClient;
  userId: string;
  source?: 'VOICE_ASSISTANT' | 'MANUAL_WEB' | 'API';
  context?: ConversationContext;
}

export async function executeDealCommand(command: DealCommand, deps: ExecutionDeps): Promise<CommandExecutionResult> {
  const { supabase, userId, context } = deps;
  const source = deps.source ?? 'VOICE_ASSISTANT';

  // 1. Schema: payload inválido nunca executa, nem parcialmente
  const validation = validateDealCommandPayload(command);
  if (!validation.success || !validation.data) {
    return {
      success: false,
      humanSummary: 'Não consegui montar esse negócio com segurança. Pode repetir com os valores?',
      error: validation.error,
      errorType: 'validation',
    };
  }
  const cmd = validation.data as DealCommand;

  // 2. Assinatura / trial
  try {
    await assertWritePermission(userId, supabase);
  } catch (subErr: unknown) {
    const msg = subErr instanceof Error ? subErr.message : 'Assinatura inativa ou expirada.';
    return { success: false, humanSummary: msg, error: msg, errorType: 'subscription' };
  }

  // 3. Ambiguidade ou informação ausente bloqueia execução
  if (cmd.ambiguities.length > 0) {
    const amb = cmd.ambiguities[0];
    return { success: false, requiresConfirmation: true, confirmationPrompt: amb.suggestedPrompt, humanSummary: amb.suggestedPrompt };
  }
  if (cmd.missingInformation.length > 0) {
    const miss = cmd.missingInformation[0];
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: miss.promptQuestion,
      humanSummary: miss.promptQuestion,
      missingInformation: cmd.missingInformation.map((m) => m.type),
    };
  }

  // 4. Balanço contábil
  const balanceResult = validateDealBalance(cmd);
  if (!balanceResult.isBalanced) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: balanceResult.suggestedPrompt,
      humanSummary: balanceResult.suggestedPrompt || balanceResult.errorMessage || 'Os valores da negociação não fecham.',
      error: balanceResult.errorMessage,
      errorType: 'balance',
    };
  }

  // 5. Idempotência
  if (cmd.idempotencyKey) {
    const { data: existingDeal } = await supabase
      .from('deals')
      .select('id')
      .eq('user_id', userId)
      .eq('idempotency_key', cmd.idempotencyKey)
      .maybeSingle();
    if (existingDeal) {
      return { success: true, dealId: existingDeal.id, alreadyExecuted: true, humanSummary: 'Esta operação já havia sido registrada.' };
    }
  }

  // 6. Cliente: homônimos geram pergunta; nome não encontrado (ou não dito) vira CLIENTE AVULSO,
  //    que o usuário vincula a um cadastro ou confirma depois. O negócio nunca fica refém do cadastro.
  const counterparty = cmd.counterparty?.id || cmd.counterparty?.name?.trim() ? cmd.counterparty! : { name: UNNAMED_CUSTOMER };
  const customerRes = counterparty.name === UNNAMED_CUSTOMER && !counterparty.id
    ? { status: 'not_found' as const }
    : await resolveCustomerReference(supabase, userId, {
        id: counterparty.id,
        name: counterparty.name,
        context: context?.lastCustomer,
      });

  let customer: { id: string; name: string } | undefined;
  if (customerRes.status === 'resolved' && customerRes.entity) {
    customer = customerRes.entity;
  } else if (customerRes.status === 'ambiguous') {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: customerRes.promptQuestion,
      humanSummary: customerRes.promptQuestion!,
      pendingChoice: { field: 'customer', candidates: customerRes.candidates! },
      errorType: 'resolution',
    };
  } else if (counterparty.id) {
    return { success: false, humanSummary: 'Não encontrei esse cliente no seu cadastro.', errorType: 'resolution' };
  }

  // 7. Itens de saída: do estoque (disponível ou reservado), sem escolha silenciosa entre parecidos.
  //    Não achou no estoque? A venda não fica refém do cadastro: a mercadoria nasce vendida no negócio.
  const resolvedItems: ResolvedItem[] = [];
  const newItems: Array<{ index: number; name: string; acquisitionCost?: number }> = [];
  for (const [index, itOut] of cmd.itemsOut.entries()) {
    const spokenName = (itOut.reference || itOut.description || '').trim();
    if (itOut.newItem && !itOut.itemId) {
      if (!spokenName) return { success: false, humanSummary: 'Qual mercadoria você vendeu?', errorType: 'validation' };
      newItems.push({ index, name: spokenName, acquisitionCost: itOut.acquisitionValue });
      continue;
    }
    const itemRes = await resolveItemReference(supabase, userId, {
      id: itOut.itemId,
      reference: itOut.reference || itOut.description,
      context: context?.lastItem,
      statuses: ['disponivel', 'reservado'],
    });

    if (itemRes.status === 'ambiguous') {
      return {
        success: false,
        requiresConfirmation: true,
        confirmationPrompt: itemRes.promptQuestion,
        humanSummary: itemRes.promptQuestion!,
        pendingChoice: { field: 'item', index, candidates: itemRes.candidates! },
        errorType: 'resolution',
      };
    }
    if (itemRes.status === 'not_found' && !itOut.itemId && spokenName) {
      newItems.push({ index, name: spokenName, acquisitionCost: itOut.acquisitionValue });
      continue;
    }
    if (itemRes.status !== 'resolved' || !itemRes.entity) {
      return {
        success: false,
        humanSummary: itemRes.promptQuestion || 'Mercadoria não encontrada no estoque.',
        error: 'Mercadoria não encontrada no estoque.',
        errorType: 'resolution',
      };
    }
    if (resolvedItems.some((r) => r.id === itemRes.entity!.id)) {
      return { success: false, humanSummary: 'A mesma mercadoria apareceu duas vezes no negócio.', errorType: 'resolution' };
    }
    resolvedItems.push(itemRes.entity);
  }

  // Cliente avulso só é criado depois que tudo foi resolvido (nenhum efeito colateral em caso de pergunta)
  let provisionalCustomer: { id: string; name: string } | undefined;
  if (!customer) {
    const { data: newCust, error: custError } = await supabase
      .from('customers')
      .insert({
        user_id: userId,
        name: counterparty.name!.trim().slice(0, 120),
        phone: counterparty.phone || null,
        document: counterparty.document || null,
        is_provisional: true,
      })
      .select('id, name')
      .single();
    if (custError || !newCust) {
      if (custError?.hint === 'FREE_CUSTOMER_LIMIT') await trackProductEvent(userId, 'free_customer_limit_reached', { source });
      return { success: false, humanSummary: custError?.hint === 'FREE_CUSTOMER_LIMIT'
        ? 'Você atingiu o limite de clientes do Free. Posso registrar negócios para clientes existentes, ou você pode assinar o Pro para cadastrar mais.'
        : 'Não consegui cadastrar o cliente.', error: custError?.message,
        errorType: custError?.hint === 'FREE_CUSTOMER_LIMIT' ? 'plan_customer_limit' : 'database' };
    }
    customer = newCust;
    provisionalCustomer = newCust;
  }

  const itemsOutPayload: Array<Record<string, unknown>> = [];
  const itemsOutCMVCentsList: number[] = [];
  const resolvedIndexes = cmd.itemsOut.map((_, i) => i).filter((i) => !newItems.some((n) => n.index === i));

  for (const [pos, item] of resolvedItems.entries()) {
    itemsOutPayload.push({ item_id: item.id, evaluated_value: cmd.itemsOut[resolvedIndexes[pos]].negotiatedValue || 0 });

    const { data: costs } = await supabase.from('item_costs').select('amount').eq('item_id', item.id).eq('user_id', userId);
    const costsCents = (costs || []).map((c) => ({ amountCents: toCents(Number(c.amount)) }));
    itemsOutCMVCentsList.push(calculateItemCMVCents(toCents(item.acquisitionCost), costsCents));
  }
  for (const n of newItems) {
    itemsOutPayload.push({
      name: n.name,
      evaluated_value: cmd.itemsOut[n.index].negotiatedValue || 0,
      acquisition_cost: n.acquisitionCost ?? null,
      category: 'mercadoria',
    });
    if (n.acquisitionCost !== undefined) itemsOutCMVCentsList.push(toCents(n.acquisitionCost));
  }
  const profitPending = newItems.some((n) => n.acquisitionCost === undefined);

  // 8. Valores do deal (custo desconhecido → lucro pendente, nunca lucro inventado)
  const dealTotalCents = balanceResult.totalOutCents;
  const dealTotalCMVCents = calculateDealTotalCMVCents(itemsOutCMVCentsList);
  const recognizedProfitCents = profitPending ? 0 : calculateProjectedProfitCents(dealTotalCents, dealTotalCMVCents);

  const dealType =
    cmd.itemsIn.length > 0 && cmd.itemsOut.length > 0
      ? 'troca'
      : cmd.itemsOut.length > 0
        ? 'venda'
        : cmd.itemsIn.length > 0
          ? 'compra'
          : 'avulso';

  const scheduleFor = (totalAmount: number, inst?: DealCommand['receivables'][number]['installments']) =>
    generateInstallmentScheduleCents({
      totalAmountCents: toCents(totalAmount),
      count: inst?.count || 1,
      dueDayOfMonth: inst?.dueDayOfMonth,
      intervalDays: inst?.intervalDays || 30,
      isPromissory: inst?.isPromissory || false,
      firstDueDate: inst?.firstDueDate,
    }).map((i) => ({
      installment_number: i.installmentNumber,
      total_installments: i.totalInstallments,
      original_value: i.originalValueReais,
      due_date: i.dueDate,
      is_promissory: i.isPromissory,
    }));

  const transactionPayload = {
    idempotency_key: cmd.idempotencyKey || null,
    customer_id: customer.id,
    deal_type: dealType,
    total_value: toReais(dealTotalCents),
    recognized_profit: toReais(recognizedProfitCents),
    source: source === 'VOICE_ASSISTANT' ? 'voice' : 'manual',
    deal_date: new Date().toISOString().split('T')[0],
    notes: cmd.notes || null,
    items_out: itemsOutPayload,
    items_in: cmd.itemsIn.map((itIn) => ({
      name: itIn.description || itIn.reference || 'Item Recebido na Troca',
      evaluated_value: itIn.negotiatedValue ?? itIn.acquisitionValue ?? 0,
      category: 'mercadoria',
    })),
    cash_movements: [
      ...cmd.cashIn.map((c) => ({ direction: 'IN', amount: c.amount, payment_method: c.method || 'other', description: c.notes || 'Entrada da negociação' })),
      ...cmd.cashOut.map((c) => ({ direction: 'OUT', amount: c.amount, payment_method: c.method || 'other', description: c.notes || 'Saída da negociação' })),
    ],
    receivables: cmd.receivables.map((rec) => ({ total_amount: rec.totalAmount, installments: scheduleFor(rec.totalAmount, rec.installments) })),
    payables: cmd.payables.map((pay) => ({
      total_amount: pay.totalAmount,
      description: pay.description || 'Volta a pagar de negociação',
      installments: scheduleFor(pay.totalAmount, pay.installments),
    })),
    adjustments: cmd.adjustments.map((adj) => ({ type: adj.type, amount: adj.amount, reason: adj.reason || 'Abatimento da negociação' })),
  };

  // 9. Execução atômica
  const { data: rpcResponse, error: rpcError } = await supabase.rpc('execute_deal_transaction', { p_payload: transactionPayload });

  if (rpcError) {
    const subscription = rpcError.hint === 'SUBSCRIPTION_INACTIVE';
    return {
      success: false,
      humanSummary: subscription ? writeDeniedMessage('expired') : 'Não consegui salvar o negócio. Nada foi gravado.',
      error: rpcError.message,
      errorType: subscription ? 'subscription' : 'database',
    };
  }

  const rpc = rpcResponse as { deal_id?: string; already_executed?: boolean; receivable_ids?: string[]; items_out_ids?: string[] };
  if (rpc.already_executed) {
    return { success: true, dealId: rpc.deal_id, alreadyExecuted: true, humanSummary: 'Esta operação já havia sido registrada.' };
  }

  // A RPC devolve os IDs das mercadorias criadas na ordem de newItems
  const created = newItems.map((n, i) => ({ id: rpc.items_out_ids?.[i] ?? '', name: n.name, known: n.acquisitionCost !== undefined, index: n.index }));
  const soldNames = [...resolvedItems.map((i) => i.name), ...created.map((c) => c.name)];
  return {
    success: true,
    dealId: rpc.deal_id,
    humanSummary: summarizeDeal(cmd, dealType, dealTotalCents, customer.name, soldNames),
    resolved: {
      customer,
      itemsOut: [...resolvedItems.map((i) => ({ id: i.id, name: i.name })), ...created.map((c) => ({ id: c.id, name: c.name }))],
      receivableIds: rpc.receivable_ids || [],
    },
    provisional: {
      customer: provisionalCustomer,
      items: created.filter((c) => c.id).map((c) => ({ id: c.id, name: c.name })),
    },
    pendingCostItems: created
      .filter((c) => !c.known && c.id)
      .map((c) => ({ id: c.id, name: c.name, negotiatedValue: cmd.itemsOut[c.index].negotiatedValue || 0 })),
  };
}

const brlShort = (cents: number) => {
  const whole = cents % 100 === 0;
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** Resposta curta: o que entrou/saiu e o que ficou para receber. */
function summarizeDeal(
  cmd: DealCommand,
  dealType: string,
  dealTotalCents: number,
  customerName: string,
  itemNamesList: string[]
): string {
  const itemNames = itemNamesList.join(' + ') || 'mercadoria';
  const parts: string[] = [];

  if (dealType === 'troca') {
    const itIn = cmd.itemsIn.map((i) => i.description || i.reference).join(' + ');
    parts.push(`Pronto. Troca${customerName === UNNAMED_CUSTOMER ? '' : ` com ${customerName}`}: saiu ${itemNames}, entrou ${itIn}.`);
  } else if (dealType === 'compra') {
    const itIn = cmd.itemsIn.map((i) => i.description || i.reference).join(' + ');
    parts.push(`Pronto. Compra de ${itIn}${customerName === UNNAMED_CUSTOMER ? '' : ` com ${customerName}`} por ${brlShort(dealTotalCents)}.`);
  } else {
    parts.push(`Pronto. Venda de ${itemNames}${customerName === UNNAMED_CUSTOMER ? '' : ` pro ${customerName}`} por ${brlShort(dealTotalCents)}.`);
  }

  const cashIn = cmd.cashIn.reduce((acc, c) => acc + toCents(c.amount), 0);
  const cashOut = cmd.cashOut.reduce((acc, c) => acc + toCents(c.amount), 0);
  if (cashIn > 0) parts.push(`Entrou ${brlShort(cashIn)}.`);
  if (cashOut > 0) parts.push(`Você pagou ${brlShort(cashOut)}.`);

  const rec = cmd.receivables[0];
  if (rec) {
    const inst = rec.installments;
    parts.push(
      inst && inst.count > 1
        ? `Faltam ${inst.count}x de ${brlShort(toCents(inst.installmentAmount))}${inst.dueDayOfMonth ? ` todo dia ${inst.dueDayOfMonth}` : ''}.`
        : `Falta receber ${brlShort(toCents(rec.totalAmount))}.`
    );
  }
  return parts.join(' ');
}
