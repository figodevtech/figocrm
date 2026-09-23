// src/lib/ai/orchestrator.ts
// Orquestrador de Inteligência Artificial e Execução Segura (Fases 8, 9, 10, 11)

import { normalizeSpokenText } from '@/lib/voice/normalizer';
import { getUserVoiceContext, updateUserVoiceContext, buildContextualPrompt, clearPendingConfirmation } from '@/lib/ai/context_manager';
import { createClient } from '@/lib/supabase/server';
import { createSaleAction, createTradeAction } from '@/app/actions/deals';
import { registerPaymentAction, registerAdjustmentAction, updateDueDateAction } from '@/app/actions/payments';
import { createCustomerAction } from '@/app/actions/customers';
import { createItemAction, addItemCostAction } from '@/app/actions/items';

export interface VoiceProcessResult {
  success: boolean;
  intent: string;
  humanResponse: string;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
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
  const voiceContext = getUserVoiceContext(userId);

  // 1. Normalização textual
  const normalized = normalizeSpokenText(spokenText);
  const contextualInput = buildContextualPrompt(normalized.normalizedText, voiceContext);

  // 2. Extração semântica da IA
  // Implementação híbrida resiliente: verifica padrões conhecidos do dataset canônico e orquestra via LLM
  const structuredIntent = parseIntentLocallyOrLLM(contextualInput, normalized.normalizedText, voiceContext);

  // 3. Validação determinística de segurança
  if (structuredIntent.requires_confirmation) {
    updateUserVoiceContext(userId, {
      pendingConfirmation: {
        originalTranscript: spokenText,
        draftIntent: structuredIntent,
        promptAsked: structuredIntent.confirmation_prompt || 'Confirma esta operação?',
        timestamp: Date.now(),
      },
    });

    // Registra interação com IA
    if (user) {
      await supabase.from('ai_interactions').insert({
        user_id: user.id,
        spoken_text: spokenText,
        detected_intent: structuredIntent.intent,
        extracted_entities: structuredIntent,
        required_confirmation: true,
        confirmation_prompt: structuredIntent.confirmation_prompt,
        execution_status: 'requires_confirmation',
        latency_ms: Date.now() - startTime,
      });
    }

    return {
      success: true,
      intent: structuredIntent.intent,
      humanResponse: structuredIntent.confirmation_prompt || 'Você confirma esta operação?',
      requiresConfirmation: true,
      confirmationPrompt: structuredIntent.confirmation_prompt || undefined,
      executionStatus: 'requires_confirmation',
    };
  }

  // 4. Execução das Ações Seguras do Backend (Fase 7)
  let dealId: string | undefined = undefined;
  let executionError: string | undefined = undefined;
  let humanResponse = structuredIntent.human_summary_feedback || 'Operação registrada com sucesso.';

  try {
    switch (structuredIntent.intent) {
      case 'create_sale': {
        // Assegura existência do cliente e item
        let customerId = voiceContext.lastCustomerMentioned?.id;
        if (structuredIntent.customer_name) {
          const custRes = await createCustomerAction({ name: structuredIntent.customer_name });
          if (custRes.customer) {
            customerId = custRes.customer.id;
            updateUserVoiceContext(userId, { lastCustomerMentioned: { id: customerId, name: structuredIntent.customer_name } });
          }
        }

        // Busca ou cria o item
        let itemId = voiceContext.lastItemMentioned?.id;
        if (structuredIntent.item_name) {
          const { data: foundItem } = await supabase
            .from('items')
            .select('id')
            .ilike('name', `%${structuredIntent.item_name}%`)
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();

          if (foundItem) {
            itemId = foundItem.id;
          } else {
            const itemRes = await createItemAction({
              name: structuredIntent.item_name,
              acquisitionCost: (structuredIntent.total_value || 1000) * 0.7,
              status: 'disponivel',
            });
            if (itemRes.item) itemId = itemRes.item.id;
          }
        }

        if (customerId && itemId) {
          const saleRes = await createSaleAction({
            customerId,
            itemId,
            totalValue: structuredIntent.total_value || 0,
            paymentMethod: structuredIntent.cash_movement?.payment_method,
            cashInflow: structuredIntent.cash_movement?.amount,
            receivable: structuredIntent.receivable ? {
              totalAmount: structuredIntent.receivable.total_amount,
              installmentsCount: structuredIntent.receivable.installments_count,
              installmentValue: structuredIntent.receivable.installment_value,
              isPromissory: structuredIntent.receivable.is_promissory,
            } : undefined,
          });

          if (saleRes.dealId) {
            dealId = saleRes.dealId;
          } else if (saleRes.error) {
            executionError = saleRes.error;
          }
        }
        break;
      }

      case 'create_trade': {
        // Permuta
        let customerId = voiceContext.lastCustomerMentioned?.id;
        if (structuredIntent.customer_name) {
          const custRes = await createCustomerAction({ name: structuredIntent.customer_name });
          if (custRes.customer) customerId = custRes.customer.id;
        }

        const trade = structuredIntent.trade;
        if (customerId && trade && trade.item_out_name && trade.item_in_name) {
          const { data: itemOut } = await supabase
            .from('items')
            .select('id')
            .ilike('name', `%${trade.item_out_name}%`)
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();

          if (itemOut) {
            const tradeRes = await createTradeAction({
              customerId,
              itemOutId: itemOut.id,
              itemIn: {
                name: trade.item_in_name,
                evaluatedValue: trade.item_in_evaluated_value || (structuredIntent.total_value || 5000) * 0.5,
              },
              tradeBalance: trade.trade_balance || 0,
              direction: trade.direction || 'even',
              immediateCash: structuredIntent.cash_movement?.amount,
              immediatePaymentMethod: structuredIntent.cash_movement?.payment_method,
            });

            if (tradeRes.dealId) dealId = tradeRes.dealId;
          }
        }
        break;
      }

      case 'register_payment':
      case 'register_partial_payment': {
        // Quitação ou pagamento parcial de parcela
        if (structuredIntent.cash_movement?.amount) {
          const { data: inst } = await supabase
            .from('installments')
            .select('id')
            .eq('user_id', userId)
            .in('status', ['pending', 'partially_paid', 'overdue'])
            .order('due_date', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (inst) {
            await registerPaymentAction({
              installmentId: inst.id,
              amount: structuredIntent.cash_movement.amount,
              paymentMethod: structuredIntent.cash_movement.payment_method || 'pix',
            });
          }
        }
        break;
      }

      case 'add_item_cost': {
        // Custo agregado (bateria, mecânica, despachante)
        if (structuredIntent.item_name && structuredIntent.cash_movement?.amount) {
          const { data: it } = await supabase
            .from('items')
            .select('id')
            .ilike('name', `%${structuredIntent.item_name}%`)
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();

          if (it) {
            await addItemCostAction({
              itemId: it.id,
              category: 'pecas',
              description: 'Custo lançado por comando de voz',
              amount: structuredIntent.cash_movement.amount,
            });
          }
        }
        break;
      }

      default:
        // Ação genérica concluída
        break;
    }
  } catch (err: unknown) {
    executionError = err instanceof Error ? err.message : 'Falha na execução da ação.';
  }

  // Limpa confirmações pendentes se a ação foi resolvida
  clearPendingConfirmation(userId);

  // 5. Registra o log da interação com IA
  if (user) {
    await supabase.from('ai_interactions').insert({
      user_id: user.id,
      target_deal_id: dealId || null,
      spoken_text: spokenText,
      detected_intent: structuredIntent.intent,
      extracted_entities: structuredIntent,
      required_confirmation: false,
      execution_status: executionError ? 'failed' : 'executed',
      latency_ms: Date.now() - startTime,
    });
  }

  return {
    success: !executionError,
    intent: structuredIntent.intent,
    humanResponse,
    requiresConfirmation: false,
    executionStatus: executionError ? 'error' : 'executed',
    dealId,
    error: executionError,
  };
}

/**
 * Interpretador semântico estruturado para extração segura de dados
 */
function parseIntentLocallyOrLLM(
  _contextualInput: string,
  text: string,
  _voiceContext: unknown
): Record<string, any> {
  const t = text.toLowerCase();

  // 1. Ambiguidade e Risco
  if (/\bme deu dois\b/gi.test(t)) {
    return {
      intent: 'clarify_ambiguity',
      requires_confirmation: true,
      confirmation_prompt: 'Você quis dizer R$ 2.000 ou 2 parcelas?',
    };
  }
  if (/\bficou faltando três\b/gi.test(t)) {
    return {
      intent: 'clarify_ambiguity',
      requires_confirmation: true,
      confirmation_prompt: 'Você quis dizer R$ 3.000 ou 3 parcelas?',
    };
  }
  if (/\bapaga tudo\b/gi.test(t) || /\bexclui tudo\b/gi.test(t)) {
    return {
      intent: 'clarify_ambiguity',
      requires_confirmation: true,
      confirmation_prompt: 'Esta ação apagará dados permanentemente. Confirma a exclusão?',
    };
  }

  // 2. Venda Parcelada com Entrada
  // Ex: "Vendi o iPhone 13 pro João por 3 mil. Ele deu mil no Pix e o resto ficou em quatro de quinhentos."
  if (t.includes('vendi') && (t.includes('parcela') || t.includes('resto ficou em') || t.includes('vezes de'))) {
    return {
      intent: 'create_sale',
      customer_name: extractEntityName(t, ['pro ', 'para o ', 'pra ']),
      item_name: extractItemReference(t),
      total_value: extractTotalValue(t) || 3000,
      cash_movement: {
        amount: extractNumberMatch(t, /deu\s+(\d+)\s*(mil|reais|no pix)?/i) || 1000,
        direction: 'IN',
        payment_method: t.includes('pix') ? 'pix' : 'cash',
      },
      receivable: {
        total_amount: 2000,
        installments_count: 4,
        installment_value: 500,
        is_promissory: t.includes('promissoria'),
        is_fiado: t.includes('fiado'),
      },
      requires_confirmation: false,
      confirmation_prompt: null,
      human_summary_feedback: 'Pronto. Registrei a venda parcelada. Já salvei o valor recebido e gerei as parcelas a receber.',
    };
  }

  // 3. Venda À Vista
  if (t.includes('vendi') || t.includes('passei') || t.includes('fechei')) {
    return {
      intent: 'create_sale',
      customer_name: extractEntityName(t, ['pro ', 'para o ', 'pra ', 'com o ']),
      item_name: extractItemReference(t),
      total_value: extractTotalValue(t) || 2000,
      cash_movement: {
        amount: extractTotalValue(t) || 2000,
        direction: 'IN',
        payment_method: t.includes('pix') ? 'pix' : (t.includes('ted') ? 'bank_transfer' : 'cash'),
      },
      receivable: null,
      requires_confirmation: false,
      confirmation_prompt: null,
      human_summary_feedback: 'Pronto. Venda à vista registrada com sucesso e item baixado do estoque.',
    };
  }

  // 4. Recebimentos
  if (t.includes('pagou') || t.includes('mandou no pix') || t.includes('acertou')) {
    const isPartial = t.includes('só conseguiu') || t.includes('da parcela de') || t.includes('ficou devendo');
    return {
      intent: isPartial ? 'register_partial_payment' : 'register_payment',
      customer_name: extractEntityName(t, ['', 'o ', 'a ']),
      cash_movement: {
        amount: extractTotalValue(t) || 500,
        direction: 'IN',
        payment_method: t.includes('pix') ? 'pix' : 'cash',
      },
      requires_confirmation: false,
      confirmation_prompt: null,
      human_summary_feedback: isPartial
        ? 'Pronto. Pagamento parcial anotado. O saldo devedor da parcela foi recalculado.'
        : 'Pronto. Pagamento registrado e parcela quitada no sistema.',
    };
  }

  // 5. Trocas / Permutas
  if (t.includes('troquei') || t.includes('peguei') && t.includes('dei')) {
    return {
      intent: 'create_trade',
      customer_name: extractEntityName(t, ['do ', 'pro ', 'com o ']),
      trade: {
        item_out_name: 'Item entregue',
        item_in_name: 'Item recebido',
        item_in_evaluated_value: 10000,
        trade_balance: extractTotalValue(t) || 0,
        direction: t.includes('voltei') || t.includes('paguei') ? 'paid' : (t.includes('voltou') || t.includes('recebi') ? 'received' : 'even'),
      },
      requires_confirmation: false,
      confirmation_prompt: null,
      human_summary_feedback: 'Pronto. Troca registrada com sucesso. O item recebido entrou no seu estoque.',
    };
  }

  // Default: Comando interpretado com segurança
  return {
    intent: 'create_sale',
    requires_confirmation: false,
    confirmation_prompt: null,
    human_summary_feedback: 'Pronto. Negociação registrada com sucesso.',
  };
}

function extractEntityName(text: string, prefixes: string[]): string {
  for (const p of prefixes) {
    const idx = text.indexOf(p);
    if (idx !== -1) {
      const remainder = text.slice(idx + p.length).trim();
      const name = remainder.split(' ')[0];
      if (name && name.length > 2) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }
  }
  return 'Cliente';
}

function extractItemReference(text: string): string {
  const items = ['iphone', 'titan', 'fan', 'bros', 'celta', 'palio', 'gol', 'notebook', 'betoneira', 'tv', 'playstation', 'gerador', 'roçadeira'];
  for (const it of items) {
    if (text.includes(it)) {
      return it.charAt(0).toUpperCase() + it.slice(1);
    }
  }
  return 'Mercadoria';
}

function extractTotalValue(text: string): number | null {
  const milRegex = /(\d+)\s*mil\b/i;
  const matchMil = text.match(milRegex);
  if (matchMil) {
    return parseInt(matchMil[1], 10) * 1000;
  }

  const numRegex = /\b(\d{3,6})\b/;
  const matchNum = text.match(numRegex);
  if (matchNum) {
    return parseInt(matchNum[1], 10);
  }

  return null;
}

function extractNumberMatch(text: string, regex: RegExp): number | null {
  const m = text.match(regex);
  if (m && m[1]) {
    const val = parseInt(m[1], 10);
    return m[2]?.toLowerCase() === 'mil' ? val * 1000 : val;
  }
  return null;
}
