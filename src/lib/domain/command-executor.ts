// src/lib/domain/command-executor.ts
// Executor seguro de negociações — camada única entre a IA/APIs e o banco.
// Garante: schema válido, assinatura ativa, ausência de ambiguidade, balanço contábil fechado,
// resolução de entidades sem escolha silenciosa e execução atômica via RPC `execute_deal_transaction`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWritePermission } from '@/lib/subscription';
import { DealCommand } from '@/types/deal-command';
import { validateDealCommandPayload } from '@/lib/ai/schemas/deal-command.schema';
import { validateDealBalance } from '@/lib/finance/deal-balance';
import { calculateItemCMVCents, calculateDealTotalCMVCents } from '@/lib/finance/cmv';
import { calculateProjectedProfitCents } from '@/lib/finance/profit';
import { generateInstallmentScheduleCents } from '@/lib/finance/installments';
import { toCents, toReais, formatCurrencyFromCents } from '@/lib/finance/money';
import type { ConversationContext } from '@/lib/ai/context_manager';
import {
  EntityCandidate,
  resolveCustomerReference,
  resolveItemReference,
  ResolvedItem,
} from '@/lib/domain/entity-resolver';

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
  errorType?: 'validation' | 'subscription' | 'resolution' | 'balance' | 'database';
  alreadyExecuted?: boolean;
  resolved?: {
    customer?: { id: string; name: string };
    itemsOut?: Array<{ id: string; name: string }>;
    receivableIds?: string[];
  };
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

  // 6. Cliente: obrigatório; homônimos geram pergunta; nome novo gera cadastro
  if (!cmd.counterparty?.id && !cmd.counterparty?.name) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: 'Com quem você fechou esse negócio?',
      humanSummary: 'Com quem você fechou esse negócio?',
      missingInformation: ['customer_reference'],
    };
  }

  const customerRes = await resolveCustomerReference(supabase, userId, {
    id: cmd.counterparty.id,
    name: cmd.counterparty.name,
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
  } else if (cmd.counterparty.id) {
    return { success: false, humanSummary: 'Não encontrei esse cliente no seu cadastro.', errorType: 'resolution' };
  }

  // 7. Itens de saída: somente do estoque disponível, sem escolha silenciosa
  const resolvedItems: ResolvedItem[] = [];
  for (const [index, itOut] of cmd.itemsOut.entries()) {
    const itemRes = await resolveItemReference(supabase, userId, {
      id: itOut.itemId,
      reference: itOut.reference || itOut.description,
      context: context?.lastItem,
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

  // Cliente novo só é cadastrado depois que tudo foi resolvido (nenhum efeito colateral em caso de pergunta)
  if (!customer) {
    const { data: newCust, error: custError } = await supabase
      .from('customers')
      .insert({
        user_id: userId,
        name: cmd.counterparty.name!.trim(),
        phone: cmd.counterparty.phone || null,
        document: cmd.counterparty.document || null,
      })
      .select('id, name')
      .single();
    if (custError || !newCust) {
      return { success: false, humanSummary: 'Não consegui cadastrar o cliente.', error: custError?.message, errorType: 'database' };
    }
    customer = newCust;
  }

  const itemsOutPayload: Array<{ item_id: string; evaluated_value: number }> = [];
  const itemsOutCMVCentsList: number[] = [];

  for (const [index, item] of resolvedItems.entries()) {
    itemsOutPayload.push({ item_id: item.id, evaluated_value: cmd.itemsOut[index].negotiatedValue || 0 });

    const { data: costs } = await supabase.from('item_costs').select('amount').eq('item_id', item.id).eq('user_id', userId);
    const costsCents = (costs || []).map((c) => ({ amountCents: toCents(Number(c.amount)) }));
    itemsOutCMVCentsList.push(calculateItemCMVCents(toCents(item.acquisitionCost), costsCents));
  }

  // 8. Valores do deal
  const dealTotalCents = balanceResult.totalOutCents;
  const dealTotalCMVCents = calculateDealTotalCMVCents(itemsOutCMVCentsList);
  const recognizedProfitCents = calculateProjectedProfitCents(dealTotalCents, dealTotalCMVCents);

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
    return {
      success: false,
      humanSummary: 'Não foi possível salvar a negociação. Nada foi gravado.',
      error: rpcError.message,
      errorType: 'database',
    };
  }

  const rpc = rpcResponse as { deal_id?: string; already_executed?: boolean; receivable_ids?: string[] };
  if (rpc.already_executed) {
    return { success: true, dealId: rpc.deal_id, alreadyExecuted: true, humanSummary: 'Esta operação já havia sido registrada.' };
  }

  return {
    success: true,
    dealId: rpc.deal_id,
    humanSummary: summarizeDeal(cmd, dealType, dealTotalCents, customer.name, resolvedItems),
    resolved: {
      customer,
      itemsOut: resolvedItems.map((i) => ({ id: i.id, name: i.name })),
      receivableIds: rpc.receivable_ids || [],
    },
  };
}

function summarizeDeal(
  cmd: DealCommand,
  dealType: string,
  dealTotalCents: number,
  customerName: string,
  items: ResolvedItem[]
): string {
  const itemNames = items.map((i) => i.name).join(' + ') || 'Mercadoria';
  const parts: string[] = [];

  if (dealType === 'troca') {
    const itIn = cmd.itemsIn.map((i) => i.description || i.reference).join(' + ');
    parts.push(`Pronto. Troca registrada: ${itemNames} saiu, ${itIn} entrou, com ${customerName}.`);
  } else {
    parts.push(`Pronto. ${itemNames} vendido para ${customerName} por ${formatCurrencyFromCents(dealTotalCents)}.`);
  }

  const cashIn = cmd.cashIn.reduce((acc, c) => acc + toCents(c.amount), 0);
  const cashOut = cmd.cashOut.reduce((acc, c) => acc + toCents(c.amount), 0);
  if (cashIn > 0) parts.push(`Recebido agora: ${formatCurrencyFromCents(cashIn)}.`);
  if (cashOut > 0) parts.push(`Você pagou ${formatCurrencyFromCents(cashOut)}.`);

  const rec = cmd.receivables[0];
  if (rec) {
    const inst = rec.installments;
    parts.push(
      inst && inst.count > 1
        ? `A receber: ${inst.count}x de ${formatCurrencyFromCents(toCents(inst.installmentAmount))}${inst.dueDayOfMonth ? ` todo dia ${inst.dueDayOfMonth}` : ''}.`
        : `A receber: ${formatCurrencyFromCents(toCents(rec.totalAmount))}.`
    );
  }
  return parts.join(' ');
}
