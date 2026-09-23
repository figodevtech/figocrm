// src/lib/domain/command-executor.ts
// Executor Seguro de Comandos de Domínio — Fase 32 & Hardening Final do FigoCRM
// Camada única e atômica entre a IA / APIs e o Banco de Dados (Supabase).
// Garante: autenticação, assinatura, validação contábil, integridade de estoque, transacionalidade atômica via Postgres RPC e auditoria.

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { DealCommand } from '@/types/deal-command';
import { validateDealBalance } from '@/lib/finance/deal-balance';
import { calculateItemCMVCents, calculateDealTotalCMVCents } from '@/lib/finance/cmv';
import { calculateProjectedProfitCents } from '@/lib/finance/profit';
import { generateInstallmentScheduleCents } from '@/lib/finance/installments';
import { toCents, toReais, formatCurrencyFromCents } from '@/lib/finance/money';

export interface CommandExecutionResult {
  success: boolean;
  dealId?: string;
  humanSummary: string;
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
  missingInformation?: string[];
  error?: string;
  alreadyExecuted?: boolean;
}

/**
 * Executa um DealCommand de forma atômica no banco de dados via RPC PostgreSQL `execute_deal_transaction`.
 */
export async function executeDealCommand(
  command: DealCommand,
  source: 'VOICE_ASSISTANT' | 'MANUAL_WEB' | 'API' = 'VOICE_ASSISTANT',
  rawTranscript?: string
): Promise<CommandExecutionResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  // 1. Validação de Autenticação
  if (authError || !user) {
    return {
      success: false,
      humanSummary: 'Não foi possível autenticar o usuário.',
      error: 'Usuário não autenticado.',
    };
  }

  // 2. Validação de Assinatura / Trial Ativo
  try {
    await assertWritePermission(user.id);
  } catch (subErr: unknown) {
    const msg = subErr instanceof Error ? subErr.message : 'Assinatura inativa ou expirada.';
    return {
      success: false,
      humanSummary: msg,
      error: msg,
    };
  }

  // 3. Validação de Ambiguidade ou Informações Ausentes
  if (command.ambiguities && command.ambiguities.length > 0) {
    const amb = command.ambiguities[0];
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: amb.suggestedPrompt,
      humanSummary: amb.suggestedPrompt,
    };
  }

  if (command.missingInformation && command.missingInformation.length > 0) {
    const miss = command.missingInformation[0];
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: miss.promptQuestion,
      humanSummary: miss.promptQuestion,
      missingInformation: command.missingInformation.map((m) => m.type),
    };
  }

  // 4. Validação Contábil e Balanço da Negociação (Fase 25 e 26)
  const balanceResult = validateDealBalance(command);
  if (!balanceResult.isBalanced) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: balanceResult.suggestedPrompt,
      humanSummary: balanceResult.errorMessage || 'Os valores da negociação não fecham.',
      error: balanceResult.errorMessage,
    };
  }

  // 5. Verificação preliminar de Idempotência
  if (command.idempotencyKey) {
    const { data: existingDeal } = await supabase
      .from('deals')
      .select('id')
      .eq('user_id', user.id)
      .eq('idempotency_key', command.idempotencyKey)
      .maybeSingle();

    if (existingDeal) {
      return {
        success: true,
        dealId: existingDeal.id,
        alreadyExecuted: true,
        humanSummary: 'Esta operação já havia sido registrada com sucesso.',
      };
    }
  }

  // 6. Resolução de Contraparte (Cliente)
  let customerId: string | null = null;
  if (command.counterparty?.id) {
    customerId = command.counterparty.id;
  } else if (command.counterparty?.name) {
    const name = command.counterparty.name.trim();
    // Busca cliente existente pelo nome (case-insensitive)
    const { data: foundCust } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.id)
      .ilike('name', `%${name}%`)
      .limit(1)
      .maybeSingle();

    if (foundCust) {
      customerId = foundCust.id;
    } else {
      // Cadastra novo cliente automaticamente
      const { data: newCust, error: custError } = await supabase
        .from('customers')
        .insert({
          user_id: user.id,
          name,
          phone: command.counterparty.phone || null,
          document: command.counterparty.document || null,
        })
        .select('id')
        .single();

      if (!custError && newCust) {
        customerId = newCust.id;
      }
    }
  }

  // Se a operação for venda parcelada ou promissória e não houver cliente, exige identificação
  if (!customerId && (command.receivables.length > 0 || command.payables.length > 0)) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: 'Com quem você fechou esse negócio? Preciso do nome para gerar as parcelas.',
      humanSummary: 'Nome do cliente não informado para o parcelamento.',
    };
  }

  // 7. Resolução dos Itens de Saída (Estoque Atual) e Cálculo de CMV
  const itemsOutPayload: Array<{ item_id: string; evaluated_value: number }> = [];
  const itemsOutCMVCentsList: number[] = [];

  for (const itOut of command.itemsOut) {
    let resolvedItem: { id: string; acquisition_cost: number; item_costs?: Array<{ amount: number }> } | null = null;

    if (itOut.itemId) {
      const { data: it } = await supabase
        .from('items')
        .select('id, acquisition_cost, status, item_costs(amount)')
        .eq('id', itOut.itemId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (it && it.status !== 'vendido') {
        resolvedItem = it;
      }
    } else if (itOut.reference || itOut.description) {
      const ref = (itOut.reference || itOut.description)!.trim();
      const { data: it } = await supabase
        .from('items')
        .select('id, acquisition_cost, status, item_costs(amount)')
        .eq('user_id', user.id)
        .ilike('name', `%${ref}%`)
        .eq('status', 'disponivel')
        .limit(1)
        .maybeSingle();
      if (it) {
        resolvedItem = it;
      }
    }

    if (!resolvedItem) {
      return {
        success: false,
        humanSummary: `Não encontrei '${itOut.reference || itOut.description || 'a mercadoria'}' disponível em seu estoque ativo.`,
        error: 'Mercadoria não encontrada no estoque.',
      };
    }

    itemsOutPayload.push({
      item_id: resolvedItem.id,
      evaluated_value: itOut.negotiatedValue || 0,
    });

    const costsCents = (resolvedItem.item_costs || []).map((c) => ({
      amountCents: toCents(Number(c.amount)),
    }));
    const itemCMVCents = calculateItemCMVCents(toCents(Number(resolvedItem.acquisition_cost)), costsCents);
    itemsOutCMVCentsList.push(itemCMVCents);
  }

  // 8. Cálculo de Lucro e Valores do Deal
  const dealTotalCents = balanceResult.totalOutCents;
  const dealTotalCMVCents = calculateDealTotalCMVCents(itemsOutCMVCentsList);
  const recognizedProfitCents = calculateProjectedProfitCents(dealTotalCents, dealTotalCMVCents);

  const dealType = command.itemsIn.length > 0 && command.itemsOut.length > 0
    ? 'troca'
    : (command.itemsOut.length > 0 ? 'venda' : (command.itemsIn.length > 0 ? 'compra' : 'avulso'));

  // 9. Montagem do Payload para o RPC Transacional Atômico do PostgreSQL
  const itemsInPayload = command.itemsIn.map((itIn) => ({
    name: itIn.description || itIn.reference || 'Item Recebido na Troca',
    evaluated_value: itIn.negotiatedValue ?? itIn.acquisitionValue ?? 0,
    category: (itIn as unknown as { category?: string }).category || 'mercadoria',
  }));

  const cashMovementsPayload = [
    ...command.cashIn.map((cin) => ({
      direction: 'IN',
      amount: cin.amount,
      payment_method: cin.method || 'pix',
      description: cin.notes || 'Entrada da negociação',
    })),
    ...command.cashOut.map((cout) => ({
      direction: 'OUT',
      amount: cout.amount,
      payment_method: cout.method || 'pix',
      description: cout.notes || 'Saída da negociação',
    })),
  ];

  const receivablesPayload = command.receivables.map((rec) => {
    const count = rec.installments?.count || 1;
    const schedule = generateInstallmentScheduleCents({
      totalAmountCents: toCents(rec.totalAmount),
      count,
      dueDayOfMonth: rec.installments?.dueDayOfMonth,
      intervalDays: rec.installments?.intervalDays || 30,
      isPromissory: rec.installments?.isPromissory || false,
      startDate: rec.installments?.firstDueDate,
    });

    return {
      total_amount: rec.totalAmount,
      installments: schedule.map((inst) => ({
        installment_number: inst.installmentNumber,
        total_installments: inst.totalInstallments,
        original_value: inst.originalValueReais,
        due_date: inst.dueDate,
        is_promissory: inst.isPromissory,
      })),
    };
  });

  const payablesPayload = command.payables.map((pay) => {
    const count = pay.installments?.count || 1;
    const schedule = generateInstallmentScheduleCents({
      totalAmountCents: toCents(pay.totalAmount),
      count,
      dueDayOfMonth: pay.installments?.dueDayOfMonth,
      intervalDays: pay.installments?.intervalDays || 30,
      startDate: pay.installments?.firstDueDate,
    });

    return {
      total_amount: pay.totalAmount,
      description: pay.description || 'Volta a pagar de negociação',
      installments: schedule.map((inst) => ({
        installment_number: inst.installmentNumber,
        total_installments: inst.totalInstallments,
        original_value: inst.originalValueReais,
        due_date: inst.dueDate,
        is_promissory: inst.isPromissory,
      })),
    };
  });

  const adjustmentsPayload = command.adjustments.map((adj) => ({
    type: adj.type,
    amount: adj.amount,
    reason: adj.reason || 'Abatimento da negociação',
  }));

  const transactionPayload = {
    idempotency_key: command.idempotencyKey || null,
    customer_id: customerId,
    deal_type: dealType,
    total_value: toReais(dealTotalCents),
    recognized_profit: toReais(recognizedProfitCents),
    source: source === 'VOICE_ASSISTANT' ? 'ia_voz' : (source === 'MANUAL_WEB' ? 'manual' : 'api'),
    deal_date: new Date().toISOString().split('T')[0],
    notes: command.notes || null,
    items_out: itemsOutPayload,
    items_in: itemsInPayload,
    cash_movements: cashMovementsPayload,
    receivables: receivablesPayload,
    payables: payablesPayload,
    adjustments: adjustmentsPayload,
  };

  // 10. Execução Atômica via PostgreSQL RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResponse, error: rpcError } = await (supabase.rpc as any)(
    'execute_deal_transaction',
    { p_payload: transactionPayload }
  );

  if (rpcError) {
    return {
      success: false,
      humanSummary: 'Não foi possível salvar a negociação devido a um erro de validação no banco de dados.',
      error: rpcError.message,
    };
  }

  const dealId = (rpcResponse as { deal_id?: string; already_executed?: boolean })?.deal_id;
  const alreadyExecuted = (rpcResponse as { deal_id?: string; already_executed?: boolean })?.already_executed;

  if (alreadyExecuted) {
    return {
      success: true,
      dealId,
      alreadyExecuted: true,
      humanSummary: 'Esta operação já havia sido registrada com sucesso.',
    };
  }

  // 11. Registro na tabela ai_interactions se originado por voz
  if (source === 'VOICE_ASSISTANT' && rawTranscript) {
    await supabase.from('ai_interactions').insert({
      user_id: user.id,
      target_deal_id: dealId || null,
      spoken_text: rawTranscript,
      detected_intent: command.intent,
      extracted_entities: command as unknown as Record<string, unknown>,
      required_confirmation: false,
      execution_status: 'executed',
    });
  }

  // 12. Montagem de Resposta Humana Precisa
  let humanSummary = 'Pronto. Negociação registrada com sucesso.';
  if (dealType === 'venda') {
    const itName = command.itemsOut[0]?.reference || command.itemsOut[0]?.description || 'Mercadoria';
    const valStr = formatCurrencyFromCents(dealTotalCents);
    humanSummary = `Pronto. ${itName} vendida por ${valStr}.`;
    if (command.receivables.length > 0 && command.receivables[0].installments) {
      const inst = command.receivables[0].installments;
      humanSummary += ` Ficaram ${inst.count} parcelas de ${formatCurrencyFromCents(toCents(inst.installmentAmount))}.`;
    }
  } else if (dealType === 'troca') {
    const itOutName = command.itemsOut[0]?.reference || 'item';
    const itInName = command.itemsIn[0]?.description || 'item';
    humanSummary = `Pronto. Troca de ${itOutName} em ${itInName} registrada.`;
    if (command.cashIn.length > 0) {
      humanSummary += ` Você recebeu ${formatCurrencyFromCents(toCents(command.cashIn[0].amount))} de volta.`;
    }
  }

  return {
    success: true,
    dealId,
    humanSummary,
  };
}
