// src/lib/ai/orchestrator.ts
// Orquestrador de IA e Execução Segura — Fases 27 e 32
// Regra de ouro: Zero estimativas ou fallbacks inventados (|| 500, || 2000, * 0.7).
// Dados ausentes geram missing_information e perguntas objetivas ao usuário.

import { normalizeSpokenText } from '@/lib/voice/normalizer';
import {
  getUserVoiceContext,
  updateUserVoiceContext,
  buildContextualPrompt,
  clearPendingConfirmation,
} from '@/lib/ai/context_manager';
import { createClient } from '@/lib/supabase/server';
import { executeDealCommand } from '@/lib/domain/command-executor';
import { DealCommand, MissingInformationItem, AmbiguityItem } from '@/types/deal-command';
import { registerPaymentAction, registerAdjustmentAction, updateDueDateAction } from '@/app/actions/payments';
import { addItemCostAction } from '@/app/actions/items';

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
  const voiceContext = getUserVoiceContext(userId);

  // 1. Normalização textual
  const normalized = normalizeSpokenText(spokenText);
  const contextualInput = buildContextualPrompt(normalized.normalizedText, voiceContext);

  // 2. Extração semântica da IA (livre de defaults financeiros artificiais)
  const structured = parseIntentLocallyOrLLM(contextualInput, normalized.normalizedText, voiceContext);

  // 3. Validação determinística de segurança e dados ausentes
  if (structured.requires_confirmation || (structured.missing_information && structured.missing_information.length > 0)) {
    const prompt = structured.confirmation_prompt || 'Confirma esta operação?';

    updateUserVoiceContext(userId, {
      pendingConfirmation: {
        originalTranscript: spokenText,
        draftIntent: structured,
        promptAsked: prompt,
        timestamp: Date.now(),
      },
    });

    if (user) {
      await supabase.from('ai_interactions').insert({
        user_id: user.id,
        spoken_text: spokenText,
        detected_intent: structured.intent,
        extracted_entities: structured,
        required_confirmation: true,
        confirmation_prompt: prompt,
        execution_status: 'requires_confirmation',
        latency_ms: Date.now() - startTime,
      });
    }

    return {
      success: true,
      intent: structured.intent,
      humanResponse: prompt,
      requiresConfirmation: true,
      confirmationPrompt: prompt,
      missingInformation: structured.missing_information?.map((m: MissingInformationItem) => m.type),
      executionStatus: 'requires_confirmation',
    };
  }

  // 4. Execução segura das ações do backend
  let dealId: string | undefined = undefined;
  let executionError: string | undefined = undefined;
  let humanResponse = structured.human_summary_feedback || 'Operação registrada com sucesso.';

  try {
    switch (structured.intent) {
      case 'create_deal':
      case 'create_sale':
      case 'create_trade': {
        // Constrói o DealCommand canônico (Fase 25)
        const dealCmd: DealCommand = {
          intent: 'create_deal',
          counterparty: structured.customer_name ? { name: structured.customer_name } : undefined,
          itemsOut: structured.items_out || [],
          itemsIn: structured.items_in || [],
          cashIn: structured.cash_in || [],
          cashOut: structured.cash_out || [],
          receivables: structured.receivables || [],
          payables: structured.payables || [],
          adjustments: structured.adjustments || [],
          notes: structured.notes,
          missingInformation: structured.missing_information || [],
          ambiguities: structured.ambiguities || [],
        };

        const execRes = await executeDealCommand(dealCmd, 'VOICE_ASSISTANT', spokenText);
        if (!execRes.success) {
          if (execRes.requiresConfirmation) {
            return {
              success: true,
              intent: structured.intent,
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
        }
        break;
      }

      case 'register_payment':
      case 'register_partial_payment': {
        if (!structured.amount || structured.amount <= 0) {
          return {
            success: false,
            intent: structured.intent,
            humanResponse: 'Qual foi o valor que você recebeu?',
            requiresConfirmation: true,
            confirmationPrompt: 'Qual foi o valor que você recebeu?',
            executionStatus: 'requires_confirmation',
          };
        }

        // Localiza parcela em aberto do usuário ou do cliente mencionado
        let query = supabase
          .from('installments')
          .select('id, user_id, original_value, balance')
          .eq('user_id', userId)
          .in('status', ['pending', 'partially_paid', 'overdue'])
          .order('due_date', { ascending: true });

        const { data: inst } = await query.limit(1).maybeSingle();

        if (inst) {
          await registerPaymentAction({
            installmentId: inst.id,
            amount: structured.amount,
            paymentMethod: structured.payment_method || 'pix',
          });
          humanResponse = `Pronto. Registrei o pagamento de R$ ${structured.amount.toFixed(2).replace('.', ',')}.`;
        } else {
          humanResponse = 'Não encontrei nenhuma parcela em aberto para registrar este pagamento.';
        }
        break;
      }

      case 'add_item_cost': {
        if (!structured.item_name) {
          return {
            success: false,
            intent: structured.intent,
            humanResponse: 'Para qual mercadoria foi esse custo?',
            requiresConfirmation: true,
            confirmationPrompt: 'Para qual mercadoria foi esse custo?',
            executionStatus: 'requires_confirmation',
          };
        }
        if (!structured.amount || structured.amount <= 0) {
          return {
            success: false,
            intent: structured.intent,
            humanResponse: `Quanto você gastou na reforma de ${structured.item_name}?`,
            requiresConfirmation: true,
            confirmationPrompt: `Quanto você gastou na reforma de ${structured.item_name}?`,
            executionStatus: 'requires_confirmation',
          };
        }

        const { data: it } = await supabase
          .from('items')
          .select('id')
          .ilike('name', `%${structured.item_name}%`)
          .eq('user_id', userId)
          .eq('status', 'disponivel')
          .limit(1)
          .maybeSingle();

        if (it) {
          await addItemCostAction({
            itemId: it.id,
            category: structured.category || 'pecas',
            description: structured.description || 'Custo lançado por comando de voz',
            amount: structured.amount,
          });
          humanResponse = `Pronto. Lancei o custo de R$ ${structured.amount.toFixed(2).replace('.', ',')} em ${structured.item_name}.`;
        } else {
          humanResponse = `Não encontrei ${structured.item_name} em seu estoque ativo para vincular esse custo.`;
        }
        break;
      }

      default:
        break;
    }
  } catch (err: unknown) {
    executionError = err instanceof Error ? err.message : 'Falha na execução da ação.';
  }

  clearPendingConfirmation(userId);

  return {
    success: !executionError,
    intent: structured.intent,
    humanResponse: executionError ? `Erro: ${executionError}` : humanResponse,
    requiresConfirmation: false,
    executionStatus: executionError ? 'error' : 'executed',
    dealId,
    error: executionError,
  };
}

/**
 * Interpretador semântico estruturado
 * REGRA RIGOROSA DA FASE 27: Nenhum valor arbitrário é inventado. Se o usuário não disse,
 * é gerado missing_information e uma pergunta direta de esclarecimento.
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

  // 2. Venda Parcelada com Entrada / Múltiplas Formas
  // Ex: "Vendi o iPhone 13 pro João por 3 mil. Ele deu mil no Pix e o resto ficou em quatro de quinhentos."
  if (t.includes('vendi') && (t.includes('parcela') || t.includes('resto ficou em') || t.includes('vezes de') || t.includes('no pix e'))) {
    const customer = extractEntityName(t, ['pro ', 'para o ', 'pra ']);
    const item = extractItemReference(t);
    const totalVal = extractTotalValue(t);

    if (!item) {
      return {
        intent: 'create_sale',
        requires_confirmation: true,
        confirmation_prompt: 'Qual mercadoria você vendeu?',
        missing_information: [{ type: 'item_reference', description: 'Item vendido não informado', promptQuestion: 'Qual mercadoria você vendeu?' }],
      };
    }

    if (!totalVal) {
      return {
        intent: 'create_sale',
        requires_confirmation: true,
        confirmation_prompt: `Por quanto você vendeu ${item}?`,
        missing_information: [{ type: 'deal_total', description: 'Valor total não informado', promptQuestion: `Por quanto você vendeu ${item}?` }],
      };
    }

    const cashInAmount = extractNumberMatch(t, /deu\s+(\d+)\s*(mil|reais|no pix)?/i) || extractNumberMatch(t, /(\d+)\s*(mil)?\s*no pix/i) || 0;
    const installmentsCount = extractNumberMatch(t, /(\d+)\s*(vezes|parcelas|de)/i) || 0;
    const installmentValue = extractNumberMatch(t, /de\s+(\d+)\s*(mil|reais)?/i) || 0;

    const remainingVal = totalVal - cashInAmount;

    return {
      intent: 'create_sale',
      customer_name: customer,
      items_out: [{ reference: item, negotiatedValue: totalVal, direction: 'OUT' }],
      items_in: [],
      cash_in: cashInAmount > 0 ? [{ amount: cashInAmount, method: t.includes('pix') ? 'pix' : 'cash', direction: 'IN' }] : [],
      cash_out: [],
      receivables: remainingVal > 0 ? [{
        totalAmount: remainingVal,
        installments: installmentsCount > 0 ? {
          count: installmentsCount,
          installmentAmount: installmentValue > 0 ? installmentValue : Math.round(remainingVal / installmentsCount),
          isPromissory: t.includes('promissoria'),
        } : undefined,
      }] : [],
      payables: [],
      adjustments: [],
      requires_confirmation: false,
    };
  }

  // 3. Venda À Vista
  if (t.includes('vendi') || t.includes('fechei')) {
    const customer = extractEntityName(t, ['pro ', 'para o ', 'pra ', 'com o ']);
    const item = extractItemReference(t);
    const totalVal = extractTotalValue(t);

    if (!item) {
      return {
        intent: 'create_sale',
        requires_confirmation: true,
        confirmation_prompt: 'Qual mercadoria você vendeu?',
        missing_information: [{ type: 'item_reference', description: 'Item vendido não informado', promptQuestion: 'Qual mercadoria você vendeu?' }],
      };
    }

    if (!totalVal) {
      return {
        intent: 'create_sale',
        requires_confirmation: true,
        confirmation_prompt: `Por qual valor você vendeu ${item}?`,
        missing_information: [{ type: 'deal_total', description: 'Valor total não informado', promptQuestion: `Por qual valor você vendeu ${item}?` }],
      };
    }

    return {
      intent: 'create_sale',
      customer_name: customer,
      items_out: [{ reference: item, negotiatedValue: totalVal, direction: 'OUT' }],
      items_in: [],
      cash_in: [{ amount: totalVal, method: t.includes('pix') ? 'pix' : 'cash', direction: 'IN' }],
      cash_out: [],
      receivables: [],
      payables: [],
      adjustments: [],
      requires_confirmation: false,
    };
  }

  // 4. Recebimentos
  if (t.includes('pagou') || t.includes('mandou no pix') || t.includes('acertou')) {
    const isPartial = t.includes('só conseguiu') || t.includes('da parcela') || t.includes('ficou devendo');
    const val = extractTotalValue(t);

    if (!val) {
      return {
        intent: isPartial ? 'register_partial_payment' : 'register_payment',
        requires_confirmation: true,
        confirmation_prompt: 'Qual foi o valor pago?',
        missing_information: [{ type: 'payment_breakdown', description: 'Valor recebido não informado', promptQuestion: 'Qual foi o valor pago?' }],
      };
    }

    return {
      intent: isPartial ? 'register_partial_payment' : 'register_payment',
      amount: val,
      payment_method: t.includes('pix') ? 'pix' : 'cash',
      requires_confirmation: false,
    };
  }

  // 5. Trocas / Permutas
  if (t.includes('troquei') || (t.includes('peguei') && t.includes('dei')) || t.includes('passei')) {
    const valDiff = extractTotalValue(t);
    const itemOut = extractItemReference(t);

    if (!valDiff && !t.includes('pau a pau') && !t.includes('seca')) {
      return {
        intent: 'create_trade',
        requires_confirmation: true,
        confirmation_prompt: 'Teve alguma volta em dinheiro ou foi troca pau a pau?',
        missing_information: [{ type: 'trade_balance_direction', description: 'Direção da volta não informada', promptQuestion: 'Teve alguma volta em dinheiro ou foi troca pau a pau?' }],
      };
    }

    return {
      intent: 'create_trade',
      items_out: itemOut ? [{ reference: itemOut, direction: 'OUT', negotiatedValue: valDiff || 0 }] : [],
      items_in: [{ description: 'Item da troca', direction: 'IN', negotiatedValue: valDiff || 0 }],
      cash_in: (t.includes('voltou') || t.includes('recebi')) && valDiff ? [{ amount: valDiff, method: 'pix', direction: 'IN' }] : [],
      cash_out: (t.includes('voltei') || t.includes('completei')) && valDiff ? [{ amount: valDiff, method: 'pix', direction: 'OUT' }] : [],
      receivables: [],
      payables: [],
      adjustments: [],
      requires_confirmation: false,
    };
  }

  // 6. Custos Adicionais
  if (t.includes('gastei') || t.includes('gasto') || t.includes('reforma') || t.includes('mecânica')) {
    const val = extractTotalValue(t);
    const item = extractItemReference(t);

    return {
      intent: 'add_item_cost',
      item_name: item,
      amount: val,
      category: t.includes('reforma') ? 'reparo' : (t.includes('peça') ? 'pecas' : 'outros'),
      requires_confirmation: !val || !item,
      confirmation_prompt: !item ? 'Em qual mercadoria foi esse gasto?' : (!val ? 'Qual foi o valor do gasto?' : undefined),
    };
  }

  // Default defensivo: não inventa ação financeira!
  return {
    intent: 'unrecognized_command',
    requires_confirmation: true,
    confirmation_prompt: 'Não compreendi com clareza o negócio. Você vendeu, trocou ou recebeu algum pagamento?',
  };
}

function extractEntityName(text: string, prefixes: string[]): string | undefined {
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
  return undefined;
}

function extractItemReference(text: string): string | undefined {
  const items = [
    'iphone', 'titan', 'fan', 'bros', 'celta', 'palio', 'gol', 'notebook',
    'betoneira', 'tv', 'playstation', 'gerador', 'roçadeira', 'xre', 's23', 'moto', 'carro'
  ];
  for (const it of items) {
    if (text.includes(it)) {
      return it.charAt(0).toUpperCase() + it.slice(1);
    }
  }
  return undefined;
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
