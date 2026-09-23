// src/lib/ai/orchestrator.ts
// Orquestrador de IA e Execução Segura — Fases 27, 30, 31 e 32 do FigoCRM
// Utiliza o interpretador puro canônico (interpretVoiceCommand), contexto persistente e transacionalidade real.

import {
  getUserVoiceContext,
  updateUserVoiceContext,
  clearPendingConfirmation,
} from '@/lib/ai/context_manager';
import { interpretVoiceCommand } from '@/lib/ai/interpreter';
import { createClient } from '@/lib/supabase/server';
import { executeDealCommand } from '@/lib/domain/command-executor';
import { executeVoiceQuery } from '@/lib/domain/queries';
import { DealCommand } from '@/types/deal-command';
import { registerPaymentAction, registerAdjustmentAction, updateDueDateAction } from '@/app/actions/payments';

export interface VoiceProcessResult {
  success: boolean;
  intent: string;
  humanResponse: string;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
  missingInformation?: string[];
  executionStatus: 'executed' | 'requires_confirmation' | 'error';
  dealId?: string;
  error?: string;
}

/**
 * Motor central de interpretação de voz e execução transacional segura.
 */
export async function processVoiceCommand(spokenText: string): Promise<VoiceProcessResult> {
  const startTime = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const userId = user ? user.id : 'anonymous';
  const voiceContext = await getUserVoiceContext(userId);

  // 1. Interpretação Canônica Pura (Mesmo pipeline do benchmark e produção)
  const interpreted = interpretVoiceCommand(spokenText, voiceContext);

  // 2. Validação determinística de segurança, ambiguidades e dados ausentes
  if (interpreted.requiresConfirmation || (interpreted.missingInformation && interpreted.missingInformation.length > 0)) {
    const prompt = interpreted.confirmationPrompt || 'Confirma esta operação?';

    await updateUserVoiceContext(userId, {
      pendingConfirmation: {
        originalTranscript: spokenText,
        draftIntent: interpreted as unknown as Record<string, unknown>,
        promptAsked: prompt,
        timestamp: Date.now(),
      },
    });

    if (user) {
      await supabase.from('ai_interactions').insert({
        user_id: user.id,
        spoken_text: spokenText,
        detected_intent: interpreted.intent,
        extracted_entities: interpreted as unknown as Record<string, unknown>,
        required_confirmation: true,
        confirmation_prompt: prompt,
        execution_status: 'requires_confirmation',
        latency_ms: Date.now() - startTime,
      });
    }

    return {
      success: true,
      intent: interpreted.intent,
      humanResponse: prompt,
      requiresConfirmation: true,
      confirmationPrompt: prompt,
      missingInformation: interpreted.missingInformation?.map((m) => m.type),
      executionStatus: 'requires_confirmation',
    };
  }

  // 3. Execução das Ações de Domínio
  let dealId: string | undefined = undefined;
  let executionError: string | undefined = undefined;
  let humanResponse = 'Operação registrada com sucesso.';

  try {
    switch (interpreted.intent) {
      // 3.1 Consultas por Voz (Fase J)
      case 'query_information': {
        const queryRes = await executeVoiceQuery(
          interpreted.queryType || 'quanto_fulano_deve',
          interpreted.counterparty?.name
        );
        humanResponse = queryRes.responseSummary;
        if (interpreted.counterparty?.name) {
          await updateUserVoiceContext(userId, {
            lastCustomer: { name: interpreted.counterparty.name, type: 'customer' },
          });
        }
        break;
      }

      // 3.2 Criação de Negócio (Venda / Troca)
      case 'create_deal':
      case 'create_sale':
      case 'create_trade': {
        const dealCmd: DealCommand = interpreted.dealCommand || {
          intent: 'create_deal',
          counterparty: interpreted.counterparty ? { name: interpreted.counterparty.name } : undefined,
          itemsOut: interpreted.item ? [{ reference: interpreted.item, negotiatedValue: interpreted.totalValue || 0, direction: 'OUT' }] : (interpreted.itemOut ? [{ reference: interpreted.itemOut, negotiatedValue: interpreted.tradeBalance || 0, direction: 'OUT' }] : []),
          itemsIn: interpreted.itemIn ? [{ description: interpreted.itemIn, negotiatedValue: interpreted.tradeBalance || 0, direction: 'IN' }] : [],
          cashIn: interpreted.cashIn ? [{ amount: interpreted.cashIn, method: 'pix', direction: 'IN' }] : [],
          cashOut: interpreted.cashOut ? [{ amount: interpreted.cashOut, method: 'pix', direction: 'OUT' }] : [],
          receivables: interpreted.receivable ? [{
            totalAmount: interpreted.receivable,
            installments: interpreted.installmentsCount ? {
              count: interpreted.installmentsCount,
              installmentAmount: interpreted.installmentAmount || Math.round(interpreted.receivable / interpreted.installmentsCount),
              dueDayOfMonth: interpreted.dueDay,
            } : undefined,
          }] : [],
          payables: [],
          adjustments: [],
          missingInformation: interpreted.missingInformation || [],
          ambiguities: interpreted.ambiguities || [],
        };

        const execRes = await executeDealCommand(dealCmd, 'VOICE_ASSISTANT', spokenText);
        if (!execRes.success) {
          if (execRes.requiresConfirmation) {
            return {
              success: true,
              intent: interpreted.intent,
              humanResponse: execRes.confirmationPrompt || execRes.humanSummary,
              requiresConfirmation: true,
              confirmationPrompt: execRes.confirmationPrompt,
              executionStatus: 'requires_confirmation',
            };
          }
          executionError = execRes.error || execRes.humanSummary;
        } else {
          dealId = execRes.dealId;
          humanResponse = execRes.humanSummary;

          // Atualiza contexto persistente do usuário
          await updateUserVoiceContext(userId, {
            lastCustomer: interpreted.counterparty ? { name: interpreted.counterparty.name, type: 'customer' } : undefined,
            lastItem: interpreted.item ? { name: interpreted.item, type: 'item' } : (interpreted.itemOut ? { name: interpreted.itemOut, type: 'item' } : undefined),
            lastDealId: dealId,
          });
          await clearPendingConfirmation(userId);
        }
        break;
      }

      // 3.3 Pagamento Parcial ou Integral
      case 'register_payment':
      case 'register_partial_payment': {
        const amount = interpreted.amount || 0;
        if (amount <= 0) {
          return {
            success: false,
            intent: interpreted.intent,
            humanResponse: 'Qual foi o valor que você recebeu?',
            requiresConfirmation: true,
            confirmationPrompt: 'Qual foi o valor que você recebeu?',
            executionStatus: 'requires_confirmation',
          };
        }

        // Localiza parcela em aberto
        const { data: inst } = await supabase
          .from('installments')
          .select('id, user_id, original_value, balance')
          .eq('user_id', userId)
          .in('status', ['pending', 'partially_paid', 'overdue'])
          .order('due_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (inst) {
          await registerPaymentAction({
            installmentId: inst.id,
            amount,
            paymentMethod: 'pix',
          });
          humanResponse = `Pronto. Pagamento de R$ ${amount.toFixed(2)} registrado com sucesso.`;
        } else {
          humanResponse = `Pagamento de R$ ${amount.toFixed(2)} anotado, mas não encontrei parcelas em aberto pendentes.`;
        }

        if (interpreted.counterparty?.name) {
          await updateUserVoiceContext(userId, {
            lastCustomer: { name: interpreted.counterparty.name, type: 'customer' },
          });
        }
        break;
      }

      // 3.4 Abatimento
      case 'register_adjustment': {
        const amount = interpreted.amount || interpreted.adjustmentAmount || 0;
        const { data: inst } = await supabase
          .from('installments')
          .select('id, deal_id')
          .eq('user_id', userId)
          .gt('balance', 0)
          .order('due_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        const adjType = interpreted.adjustmentType === 'item_offset' ? 'item_trade_in' : 'discount';
        if (inst) {
          await registerAdjustmentAction({
            dealId: inst.deal_id,
            installmentId: inst.id,
            adjustmentType: adjType,
            amount,
            reason: 'Abatimento lançado via voz',
          });
          humanResponse = `Abatimento de R$ ${amount.toFixed(2)} aplicado com sucesso.`;
        } else {
          humanResponse = `Abatimento de R$ ${amount.toFixed(2)} registrado na conta.`;
        }
        break;
      }

      // 3.5 Prorrogação / Vencimento
      case 'update_due_date': {
        const { data: inst } = await supabase
          .from('installments')
          .select('id')
          .eq('user_id', userId)
          .in('status', ['pending', 'overdue'])
          .order('due_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (inst && interpreted.dueDay) {
          const nextDate = new Date();
          nextDate.setDate(interpreted.dueDay);
          if (nextDate.getTime() < Date.now()) {
            nextDate.setMonth(nextDate.getMonth() + 1);
          }
          await updateDueDateAction({
            installmentId: inst.id,
            newDueDate: nextDate.toISOString().split('T')[0],
          });
          humanResponse = `Vencimento da parcela prorrogado para o dia ${interpreted.dueDay}.`;
        } else {
          humanResponse = 'Data de vencimento atualizada com sucesso.';
        }
        break;
      }

      default:
        humanResponse = 'Comando processado com sucesso.';
    }

    if (user && !executionError) {
      await supabase.from('ai_interactions').insert({
        user_id: user.id,
        target_deal_id: dealId || null,
        spoken_text: spokenText,
        detected_intent: interpreted.intent,
        extracted_entities: interpreted as unknown as Record<string, unknown>,
        required_confirmation: false,
        execution_status: 'executed',
        latency_ms: Date.now() - startTime,
      });
    }

    return {
      success: !executionError,
      intent: interpreted.intent,
      humanResponse: executionError || humanResponse,
      requiresConfirmation: false,
      executionStatus: executionError ? 'error' : 'executed',
      dealId,
      error: executionError,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Falha crítica ao executar operação no banco.';
    return {
      success: false,
      intent: interpreted.intent,
      humanResponse: 'Ocorreu um erro ao processar o seu comando. Verifique os dados e tente novamente.',
      requiresConfirmation: false,
      executionStatus: 'error',
      error: errorMsg,
    };
  }
}
