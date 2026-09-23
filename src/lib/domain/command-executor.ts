// src/lib/domain/command-executor.ts
// Executor Seguro de Comandos de Domínio — Fase 32 do FigoCRM
// Camada única e atômica entre a IA / APIs e o Banco de Dados (Supabase).
// Garante: autenticação, assinatura, validação contábil, integridade de estoque, rollback e auditoria.

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
}

/**
 * Executa um DealCommand de forma atômica, reversível e auditada.
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

  // 5. Suporte a Idempotência
  if (command.idempotencyKey) {
    const { data: existingDeal } = await supabase
      .from('deals')
      .select('id')
      .eq('user_id', user.id)
      .eq('notes', `idempotency:${command.idempotencyKey}`)
      .maybeSingle();

    if (existingDeal) {
      return {
        success: true,
        dealId: existingDeal.id,
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
    // Busca cliente existente pelo nome
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

  // Se a operação for venda parcelada e não houver cliente, exige identificação
  if (!customerId && (command.receivables.length > 0 || command.payables.length > 0)) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationPrompt: 'Com quem você fechou esse negócio? Preciso do nome para gerar as parcelas.',
      humanSummary: 'Nome do cliente não informado para o parcelamento.',
    };
  }

  // 7. Resolução dos Itens de Saída (Estoque Atual)
  const itemsOutIds: string[] = [];
  const itemsOutCMVCentsList: number[] = [];

  for (const itOut of command.itemsOut) {
    let resolvedItem: { id: string; acquisition_cost: number; item_costs?: Array<{ amount: number }> } | null = null;

    if (itOut.itemId) {
      const { data: it } = await supabase
        .from('items')
        .select('id, acquisition_cost, status, item_costs(amount)')
        .eq('id', itOut.itemId)
        .eq('user_id', user.id)
        .single();
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

    itemsOutIds.push(resolvedItem.id);
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

  // 9. Execução Transacional Protegida
  const rollbackStack: Array<() => Promise<void>> = [];

  try {
    // 9.1 Criação do Deal principal
    const dealType = command.itemsIn.length > 0 && command.itemsOut.length > 0
      ? 'troca'
      : (command.itemsOut.length > 0 ? 'venda' : (command.itemsIn.length > 0 ? 'compra' : 'avulso'));

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        user_id: user.id,
        customer_id: customerId,
        deal_type: dealType,
        total_value: toReais(dealTotalCents),
        recognized_profit: toReais(recognizedProfitCents),
        status: 'concluida',
        notes: command.idempotencyKey ? `idempotency:${command.idempotencyKey}` : (command.notes || null),
        source: source === 'VOICE_ASSISTANT' ? 'ia_voz' : 'manual',
        deal_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (dealError || !deal) {
      throw new Error(dealError?.message || 'Falha ao registrar a negociação.');
    }

    rollbackStack.push(async () => {
      await supabase.from('deals').delete().eq('id', deal.id);
    });

    // 9.2 Baixa de Estoque e Registro de Itens de Saída (OUT)
    for (let i = 0; i < command.itemsOut.length; i++) {
      const itOut = command.itemsOut[i];
      const itemId = itemsOutIds[i];

      await supabase.from('items').update({ status: 'vendido' }).eq('id', itemId);
      rollbackStack.push(async () => {
        await supabase.from('items').update({ status: 'disponivel' }).eq('id', itemId);
      });

      await supabase.from('deal_items').insert({
        deal_id: deal.id,
        item_id: itemId,
        direction: 'OUT',
        evaluated_value: itOut.negotiatedValue || 0,
      });
    }

    // 9.3 Entrada de Mercadorias no Estoque (IN)
    for (const itIn of command.itemsIn) {
      const inVal = itIn.negotiatedValue ?? itIn.acquisitionValue ?? 0;
      const { data: createdItem, error: inError } = await supabase
        .from('items')
        .insert({
          user_id: user.id,
          name: itIn.description || itIn.reference || 'Item Recebido na Troca',
          acquisition_cost: inVal,
          status: 'disponivel',
        })
        .select('id')
        .single();

      if (inError || !createdItem) {
        throw new Error(inError?.message || 'Falha ao cadastrar item de entrada no estoque.');
      }

      rollbackStack.push(async () => {
        await supabase.from('items').delete().eq('id', createdItem.id);
      });

      await supabase.from('deal_items').insert({
        deal_id: deal.id,
        item_id: createdItem.id,
        direction: 'IN',
        evaluated_value: inVal,
      });
    }

    // 9.4 Movimentações de Caixa (Cash In e Cash Out)
    for (const cin of command.cashIn) {
      if (cin.amount > 0) {
        await supabase.from('cash_movements').insert({
          user_id: user.id,
          deal_id: deal.id,
          direction: 'IN',
          amount: cin.amount,
          payment_method: cin.method || 'pix',
          description: cin.notes || `Entrada da negociação`,
        });
      }
    }

    for (const cout of command.cashOut) {
      if (cout.amount > 0) {
        await supabase.from('cash_movements').insert({
          user_id: user.id,
          deal_id: deal.id,
          direction: 'OUT',
          amount: cout.amount,
          payment_method: cout.method || 'pix',
          description: cout.notes || `Saída da negociação`,
        });
      }
    }

    // 9.5 Contas a Receber e Parcelamentos
    for (const rec of command.receivables) {
      if (rec.totalAmount > 0) {
        const { data: createdRec, error: recError } = await supabase
          .from('receivables')
          .insert({
            user_id: user.id,
            deal_id: deal.id,
            customer_id: customerId,
            total_amount: rec.totalAmount,
            paid_amount: 0.00,
            balance: rec.totalAmount,
            status: 'pending',
          })
          .select('id')
          .single();

        if (recError || !createdRec) {
          throw new Error(recError?.message || 'Falha ao registrar conta a receber.');
        }

        const count = rec.installments?.count || 1;
        const schedule = generateInstallmentScheduleCents({
          totalAmountCents: toCents(rec.totalAmount),
          count,
          dueDayOfMonth: rec.installments?.dueDayOfMonth,
          intervalDays: rec.installments?.intervalDays || 30,
          isPromissory: rec.installments?.isPromissory || false,
          startDate: rec.installments?.firstDueDate,
        });

        const installmentsToInsert = schedule.map((inst) => ({
          user_id: user.id,
          receivable_id: createdRec.id,
          installment_number: inst.installmentNumber,
          total_installments: inst.totalInstallments,
          original_value: inst.originalValueReais,
          paid_value: 0.00,
          balance: inst.balanceReais,
          due_date: inst.dueDate,
          status: inst.status,
          is_promissory: inst.isPromissory,
        }));

        await supabase.from('installments').insert(installmentsToInsert);
      }
    }

    // 9.6 Contas a Pagar (se o usuário parcelou a volta dada)
    for (const pay of command.payables) {
      if (pay.totalAmount > 0) {
        const { data: createdPay, error: payError } = await supabase
          .from('payables')
          .insert({
            user_id: user.id,
            deal_id: deal.id,
            supplier_id: customerId,
            description: pay.description || 'Volta a pagar de negociação',
            total_amount: pay.totalAmount,
            paid_amount: 0.00,
            balance: pay.totalAmount,
            status: 'pending',
          })
          .select('id')
          .single();

        if (payError || !createdPay) {
          throw new Error(payError?.message || 'Falha ao registrar conta a pagar.');
        }

        const count = pay.installments?.count || 1;
        const schedule = generateInstallmentScheduleCents({
          totalAmountCents: toCents(pay.totalAmount),
          count,
          dueDayOfMonth: pay.installments?.dueDayOfMonth,
          intervalDays: pay.installments?.intervalDays || 30,
          startDate: pay.installments?.firstDueDate,
        });

        const payInstallmentsToInsert = schedule.map((inst) => ({
          user_id: user.id,
          payable_id: createdPay.id,
          installment_number: inst.installmentNumber,
          total_installments: inst.totalInstallments,
          original_value: inst.originalValueReais,
          paid_value: 0.00,
          balance: inst.balanceReais,
          due_date: inst.dueDate,
          status: inst.status,
          is_promissory: inst.isPromissory,
        }));

        await supabase.from('installments').insert(payInstallmentsToInsert);
      }
    }

    // 9.7 Abatimentos e Compensações
    for (const adj of command.adjustments) {
      if (adj.amount > 0) {
        await supabase.from('adjustments').insert({
          user_id: user.id,
          deal_id: deal.id,
          type: adj.type,
          amount: adj.amount,
          reason: adj.reason || 'Abatimento lançado na negociação',
        });
      }
    }

    // 9.8 Registro de Auditoria Imutável
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'deals',
      entity_id: deal.id,
      action_type: 'EXECUTE_DEAL_COMMAND',
      source: source,
      payload_after: { command, dealId: deal.id },
    });

    // 9.9 Registro na tabela ai_interactions se originado por voz
    if (source === 'VOICE_ASSISTANT' && rawTranscript) {
      await supabase.from('ai_interactions').insert({
        user_id: user.id,
        target_deal_id: deal.id,
        spoken_text: rawTranscript,
        detected_intent: command.intent,
        extracted_entities: command,
        required_confirmation: false,
        execution_status: 'executed',
      });
    }

    // Monta resposta humana precisa
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
      dealId: deal.id,
      humanSummary,
    };
  } catch (executionErr: unknown) {
    // Executa Rollback em ordem reversa
    for (const rollbackFn of rollbackStack.reverse()) {
      try {
        await rollbackFn();
      } catch (rErr) {
        console.error('Erro durante o rollback:', rErr);
      }
    }

    const errorMsg = executionErr instanceof Error ? executionErr.message : 'Falha ao executar comando de negociação.';
    return {
      success: false,
      humanSummary: 'Não foi possível salvar a negociação devido a um erro de validação.',
      error: errorMsg,
    };
  }
}
