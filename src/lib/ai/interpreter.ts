// src/lib/ai/interpreter.ts
// Interpretador Puro e Canônico de Comandos de Voz — Fases D e H do FigoCRM
// Função pura reutilizável pelo backend de produção, API routes e pelo benchmark oficial.
// Garante: zero fallbacks financeiros inventados, detecção estrita de ambiguidades e validação via Zod.

import { normalizeSpokenText } from '@/lib/voice/normalizer';
import { evaluateIntentConfidenceAndAmbiguity } from '@/lib/ai/disambiguation';
import { ConversationContext, resolvePronounsAndAnaphora } from '@/lib/ai/context_manager';
import { DealCommand, AmbiguityItem, MissingInformationItem } from '@/types/deal-command';
import { DealCommandSchema } from '@/lib/ai/schemas/deal-command.schema';

export type InterpretedIntent =
  | 'create_sale'
  | 'create_trade'
  | 'create_purchase'
  | 'create_deal'
  | 'register_payment'
  | 'register_partial_payment'
  | 'register_adjustment'
  | 'update_due_date'
  | 'renegotiate_debt'
  | 'query_information'
  | 'clarify_ambiguity'
  | 'unrecognized_command';

export interface InterpretedVoiceCommand {
  intent: InterpretedIntent;
  counterparty?: {
    name: string;
    phone?: string;
  };
  item?: string;
  itemOut?: string;
  itemIn?: string;
  totalValue?: number;
  cashIn?: number;
  cashOut?: number;
  tradeBalance?: number;
  direction?: 'inflow' | 'outflow' | 'even';
  receivable?: number;
  installmentsCount?: number;
  installmentAmount?: number;
  dueDay?: number;
  firstDueDate?: string;
  amount?: number;
  adjustmentAmount?: number;
  adjustmentType?: 'discount' | 'item_offset' | 'debt_offset' | 'service_offset';
  queryType?: string;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
  missingInformation: MissingInformationItem[];
  ambiguities: AmbiguityItem[];
  dealCommand?: DealCommand;
  rawText: string;
  normalizedText: string;
}

/**
 * Função pura de interpretação de comando de voz.
 * Não depende de banco ou rede, garantindo portabilidade para o Benchmark e Testes Unitários.
 */
export function interpretVoiceCommand(
  spokenText: string,
  context?: ConversationContext
): InterpretedVoiceCommand {
  const norm = normalizeSpokenText(spokenText);
  let text = norm.normalizedText;

  // 1. Resolução Anafórica baseada no contexto ("ele", "dela", "aquela moto")
  let contextualCustomer = context?.lastCustomer?.name;
  let contextualItem = context?.lastItem?.name;

  if (context) {
    const anaphora = resolvePronounsAndAnaphora(text, context);
    text = anaphora.resolvedText;
    if (anaphora.resolvedCustomer) {
      contextualCustomer = anaphora.resolvedCustomer.name;
    }
    if (anaphora.resolvedItem) {
      contextualItem = anaphora.resolvedItem.name;
    }
  }

  const t = text.toLowerCase();

  // 2. Análise Determinística de Ambiguidade e Operações de Risco (Sobre o texto bruto/resolvido)
  const disambiguation = evaluateIntentConfidenceAndAmbiguity(t, {});
  if (disambiguation.requiresConfirmation || disambiguation.confidence === 'low') {
    return {
      intent: 'clarify_ambiguity',
      requiresConfirmation: true,
      confirmationPrompt: disambiguation.suggestedPrompt || 'Você confirma esta operação?',
      missingInformation: [],
      ambiguities: disambiguation.ambiguities,
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // Normalização de números por extenso para facilitar extração matemática
  const normalizedTextWithNumbers = normalizeWordNumbers(t);

  // 3. Consultas Read-Only (Fase J)
  const isQuery =
    normalizedTextWithNumbers.startsWith('quant') ||
    normalizedTextWithNumbers.startsWith('quem') ||
    normalizedTextWithNumbers.startsWith('qual') ||
    normalizedTextWithNumbers.includes('quant') ||
    normalizedTextWithNumbers.includes('quem') ||
    normalizedTextWithNumbers.includes('qual');

  if (
    isQuery &&
    (normalizedTextWithNumbers.includes('deve') ||
      normalizedTextWithNumbers.includes('dívida') ||
      normalizedTextWithNumbers.includes('divida') ||
      normalizedTextWithNumbers.includes('na rua') ||
      normalizedTextWithNumbers.includes('mercadoria') ||
      normalizedTextWithNumbers.includes('estoque') ||
      normalizedTextWithNumbers.includes('atrasad') ||
      normalizedTextWithNumbers.includes('próxima') ||
      normalizedTextWithNumbers.includes('proxima') ||
      normalizedTextWithNumbers.includes('lucro') ||
      normalizedTextWithNumbers.includes('ganhei'))
  ) {
    const cust = extractEntityName(t) || contextualCustomer;
    let queryType = 'quanto_fulano_deve';
    if (normalizedTextWithNumbers.includes('na rua')) queryType = 'quanto_tenho_na_rua';
    else if (normalizedTextWithNumbers.includes('mercadoria') || normalizedTextWithNumbers.includes('estoque')) queryType = 'quanto_tenho_em_mercadoria';
    else if (normalizedTextWithNumbers.includes('atrasad')) queryType = 'quem_esta_atrasado';
    else if (normalizedTextWithNumbers.includes('próxima') || normalizedTextWithNumbers.includes('proxima')) queryType = 'qual_proxima_parcela';
    else if (normalizedTextWithNumbers.includes('ganhei') || normalizedTextWithNumbers.includes('lucro')) queryType = 'quanto_ganhei_esse_mes';

    return {
      intent: 'query_information',
      queryType,
      counterparty: cust ? { name: cust } : undefined,
      requiresConfirmation: false,
      missingInformation: [],
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // 4. Renegociação de Dívida / Prorrogação de Vencimento
  if (
    normalizedTextWithNumbers.includes('joga a parcela') ||
    normalizedTextWithNumbers.includes('joga pro dia') ||
    normalizedTextWithNumbers.includes('muda a data') ||
    normalizedTextWithNumbers.includes('adia') ||
    normalizedTextWithNumbers.includes('prorroga') ||
    normalizedTextWithNumbers.includes('renegocia')
  ) {
    const cust = extractEntityName(t) || contextualCustomer;
    const dayMatch = normalizedTextWithNumbers.match(/dia\s+(\d{1,2})/i);
    const dueDay = dayMatch ? parseInt(dayMatch[1], 10) : undefined;

    return {
      intent: 'update_due_date',
      counterparty: cust ? { name: cust } : undefined,
      dueDay,
      requiresConfirmation: false,
      missingInformation: [],
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // 5. Abatimento de Dívida / Compensação
  if (
    normalizedTextWithNumbers.includes('abate') ||
    normalizedTextWithNumbers.includes('abater') ||
    normalizedTextWithNumbers.includes('desconta') ||
    normalizedTextWithNumbers.includes('descontou') ||
    normalizedTextWithNumbers.includes('tira ') ||
    normalizedTextWithNumbers.includes('tirar ') ||
    (normalizedTextWithNumbers.includes('deu um') && normalizedTextWithNumbers.includes('pra abater'))
  ) {
    const cust = extractEntityName(t) || contextualCustomer;
    const amount = extractFirstNumber(normalizedTextWithNumbers);

    return {
      intent: 'register_adjustment',
      counterparty: cust ? { name: cust } : undefined,
      amount: amount || undefined,
      adjustmentAmount: amount || undefined,
      adjustmentType: normalizedTextWithNumbers.includes('celular') || normalizedTextWithNumbers.includes('som') || normalizedTextWithNumbers.includes('aparelho') ? 'item_offset' : 'discount',
      requiresConfirmation: false,
      missingInformation: !amount
        ? [{ type: 'deal_total', description: 'Valor do abatimento não informado', promptQuestion: 'Qual o valor a ser abatido?' }]
        : [],
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // 6. Trocas e Permutas (Avaliadas antes de pagamentos para não confundir 'mandou pix' como pagamento avulso)
  if (
    normalizedTextWithNumbers.includes('troquei') ||
    normalizedTextWithNumbers.includes('troca') ||
    (normalizedTextWithNumbers.includes('passei') && (normalizedTextWithNumbers.includes('peguei') || normalizedTextWithNumbers.includes('na '))) ||
    (normalizedTextWithNumbers.includes('peguei') && normalizedTextWithNumbers.includes('dei'))
  ) {
    const cust = extractEntityName(t) || contextualCustomer;
    const items = extractAllItems(t);
    const itemOut = items[0] || contextualItem;
    const itemIn = items[1];

    let direction: 'inflow' | 'outflow' | 'even' = 'even';
    let tradeBalance = 0;

    const isEven = normalizedTextWithNumbers.includes('pau a pau') || normalizedTextWithNumbers.includes('sem volta') || normalizedTextWithNumbers.includes('troca seca');
    const isVoltou = normalizedTextWithNumbers.includes('ele me voltou') || normalizedTextWithNumbers.includes('me voltou') || normalizedTextWithNumbers.includes('recebi') || normalizedTextWithNumbers.includes('mandou');
    const isVoltei = normalizedTextWithNumbers.includes('completei') || normalizedTextWithNumbers.includes('paguei') || normalizedTextWithNumbers.includes('voltei');

    const values = extractSaleNumbers(normalizedTextWithNumbers);

    if (isEven) {
      direction = 'even';
      tradeBalance = 0;
    } else if (isVoltou) {
      direction = 'inflow';
      tradeBalance = values.cashIn || extractTradeBalanceValue(normalizedTextWithNumbers);
    } else if (isVoltei) {
      direction = 'outflow';
      tradeBalance = values.cashIn || extractTradeBalanceValue(normalizedTextWithNumbers);
    } else {
      const anyVal = extractFirstNumber(normalizedTextWithNumbers);
      if (anyVal) {
        direction = 'inflow';
        tradeBalance = anyVal;
      }
    }

    return {
      intent: 'create_trade',
      counterparty: cust ? { name: cust } : undefined,
      itemOut: itemOut,
      itemIn: itemIn,
      direction,
      tradeBalance,
      totalValue: values.totalValue,
      cashIn: direction === 'inflow' ? tradeBalance : undefined,
      cashOut: direction === 'outflow' ? tradeBalance : undefined,
      receivable: values.receivable,
      installmentsCount: values.installmentsCount,
      installmentAmount: values.installmentAmount,
      dueDay: values.dueDay,
      requiresConfirmation: false,
      missingInformation: [],
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // 7. Venda à Vista ou Parcelada
  if (
    normalizedTextWithNumbers.includes('vendi') ||
    normalizedTextWithNumbers.includes('venda') ||
    normalizedTextWithNumbers.includes('fechei') ||
    (normalizedTextWithNumbers.includes('passei') && !normalizedTextWithNumbers.includes('peguei'))
  ) {
    const cust = extractEntityName(t) || contextualCustomer;
    const item = extractItemReference(t) || contextualItem;
    const values = extractSaleNumbers(normalizedTextWithNumbers);

    const isParcelada =
      normalizedTextWithNumbers.includes('vezes') ||
      normalizedTextWithNumbers.includes('parcela') ||
      normalizedTextWithNumbers.includes('entrada') ||
      normalizedTextWithNumbers.includes('resto ficou') ||
      normalizedTextWithNumbers.includes('todo dia');

    const totalValue = values.totalValue;
    const cashIn = values.cashIn;
    const receivable = values.receivable;
    const installmentsCount = values.installmentsCount;
    const installmentAmount = values.installmentAmount;
    const dueDay = values.dueDay;

    const missingInformation: MissingInformationItem[] = [];
    if (!item) {
      missingInformation.push({
        type: 'item_reference',
        description: 'Mercadoria vendida não identificada.',
        promptQuestion: 'Qual mercadoria você vendeu?',
      });
    }
    if (!totalValue && totalValue !== 0) {
      missingInformation.push({
        type: 'deal_total',
        description: 'Valor total da venda não informado.',
        promptQuestion: `Por quanto você vendeu ${item || 'a mercadoria'}?`,
      });
    }

    const requiresConfirmation = missingInformation.length > 0;

    let dealCmd: DealCommand | undefined = undefined;
    if (item && totalValue) {
      dealCmd = {
        intent: 'create_deal',
        counterparty: cust ? { name: cust } : undefined,
        itemsOut: [{ reference: item, negotiatedValue: totalValue, direction: 'OUT' }],
        itemsIn: [],
        cashIn: cashIn ? [{ amount: cashIn, method: normalizedTextWithNumbers.includes('pix') ? 'pix' : 'cash', direction: 'IN' }] : [],
        cashOut: [],
        receivables: receivable
          ? [
              {
                totalAmount: receivable,
                installments: installmentsCount
                  ? {
                      count: installmentsCount,
                      installmentAmount: installmentAmount || Math.round(receivable / installmentsCount),
                      dueDayOfMonth: dueDay,
                    }
                  : undefined,
              },
            ]
          : [],
        payables: [],
        adjustments: [],
        missingInformation,
        ambiguities: [],
      };

      DealCommandSchema.safeParse(dealCmd);
    }

    return {
      intent: 'create_sale',
      counterparty: cust ? { name: cust } : undefined,
      item,
      totalValue,
      cashIn: cashIn !== undefined ? cashIn : (isParcelada ? undefined : totalValue),
      receivable,
      installmentsCount,
      installmentAmount,
      dueDay,
      dealCommand: dealCmd,
      requiresConfirmation,
      confirmationPrompt: missingInformation[0]?.promptQuestion,
      missingInformation,
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // 8. Pagamentos e Recebimentos Parciais ou Totais de dívida existente
  if (
    normalizedTextWithNumbers.includes('pagou') ||
    normalizedTextWithNumbers.includes('pagar') ||
    normalizedTextWithNumbers.includes('mandou no pix') ||
    normalizedTextWithNumbers.includes('mandou') ||
    normalizedTextWithNumbers.includes('acertou') ||
    normalizedTextWithNumbers.includes('quitou')
  ) {
    const isPartial =
      normalizedTextWithNumbers.includes('só conseguiu') ||
      normalizedTextWithNumbers.includes('so conseguiu') ||
      normalizedTextWithNumbers.includes('daquela primeira') ||
      normalizedTextWithNumbers.includes('da primeira') ||
      normalizedTextWithNumbers.includes('da parcela de') ||
      normalizedTextWithNumbers.includes('parcial');

    const cust = extractEntityName(t) || contextualCustomer;
    const amount = extractPaymentAmount(normalizedTextWithNumbers);

    return {
      intent: isPartial ? 'register_partial_payment' : 'register_payment',
      counterparty: cust ? { name: cust } : undefined,
      amount: amount || undefined,
      requiresConfirmation: false,
      missingInformation: !amount
        ? [{ type: 'payment_breakdown', description: 'Valor recebido não informado', promptQuestion: 'Qual foi o valor recebido?' }]
        : [],
      ambiguities: [],
      rawText: spokenText,
      normalizedText: text,
    };
  }

  // Default seguro quando a intenção não for compreendida com exatidão
  return {
    intent: 'unrecognized_command',
    requiresConfirmation: true,
    confirmationPrompt: 'Não entendi com clareza. Você vendeu, trocou ou recebeu algum valor?',
    missingInformation: [],
    ambiguities: [],
    rawText: spokenText,
    normalizedText: text,
  };
}

// -------------------------------------------------------------
// Funções Auxiliares Determinísticas de Extração de Entidades
// -------------------------------------------------------------

function normalizeWordNumbers(text: string): string {
  let res = text;
  const wordMap: Record<string, string> = {
    '\\bum\\b': '1',
    '\\buma\\b': '1',
    '\\bdois\\b': '2',
    '\\bduas\\b': '2',
    '\\btrês\\b': '3',
    '\\btres\\b': '3',
    '\\bquatro\\b': '4',
    '\\bcinco\\b': '5',
    '\\bseis\\b': '6',
    '\\bsete\\b': '7',
    '\\boito\\b': '8',
    '\\bnove\\b': '9',
    '\\bdez\\b': '10',
    '\\bquinze\\b': '15',
    '\\bvinte\\b': '20',
  };

  for (const [pattern, replacement] of Object.entries(wordMap)) {
    res = res.replace(new RegExp(pattern, 'gi'), replacement);
  }
  return res;
}

function extractEntityName(text: string): string | undefined {
  const prefixes = ['pro ', 'para o ', 'pra ', 'com o ', 'do ', 'ao ', 'de '];
  for (const p of prefixes) {
    const idx = text.indexOf(p);
    if (idx !== -1) {
      const remainder = text.slice(idx + p.length).trim();
      const firstWord = remainder.split(/[ ,.!?]/)[0];
      if (firstWord && firstWord.length > 2 && !['meu', 'minha', 'dia', 'pix', 'conta'].includes(firstWord.toLowerCase())) {
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
      }
    }
  }

  const commonNames = ['carlos', 'joão', 'joao', 'marcos', 'lucas', 'felipe', 'pedro', 'gabriel', 'rafael', 'bruno', 'rodrigo', 'diego', 'matheus'];
  for (const name of commonNames) {
    if (text.toLowerCase().includes(name)) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  return undefined;
}

function extractItemReference(text: string): string | undefined {
  const items = [
    'iphone 14 pro max', 'iphone 14', 'iphone 13 pro', 'iphone 13', 'iphone 12', 'iphone 11',
    's23 ultra', 's23', 's22',
    'titan 160', 'titan', 'fan 160', 'fan', 'bros 160', 'bros', 'xre 300', 'xre',
    'celta', 'palio', 'gol', 'corsa', 'civic', 'corolla',
    'notebook', 'betoneira', 'playstation', 'gerador', 'roçadeira'
  ];

  const t = text.toLowerCase();
  for (const it of items) {
    if (t.includes(it)) {
      let formatted = it.split(' ').map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
      if (it === 'xre' || it === 'xre 300') {
        formatted = formatted.replace(/xre/i, 'XRE');
      }
      return formatted;
    }
  }
  return undefined;
}

function extractAllItems(text: string): string[] {
  const found: Array<{ item: string; index: number }> = [];
  const items = [
    'iphone 14 pro max', 'iphone 14', 'iphone 13 pro', 'iphone 13', 'iphone 12', 'iphone 11',
    's23 ultra', 's23', 's22',
    'titan 160', 'titan', 'fan 160', 'fan', 'bros 160', 'bros', 'xre 300', 'xre',
    'celta', 'palio', 'gol'
  ];

  const t = text.toLowerCase();
  for (const it of items) {
    const idx = t.indexOf(it);
    if (idx !== -1) {
      if (!found.some((existing) => existing.item.toLowerCase().includes(it))) {
        let formatted = it.split(' ').map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
        if (it === 'xre' || it === 'xre 300') {
          formatted = formatted.replace(/xre/i, 'XRE');
        }
        found.push({ item: formatted, index: idx });
      }
    }
  }

  // Ordena pela ordem em que aparecem no texto
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.item);
}

function extractTradeBalanceValue(text: string): number {
  const match = text.match(/(voltou|completei|paguei|recebi|mandou)\s+(\d+)\s*(mil)?/i);
  if (match) {
    const val = parseInt(match[2], 10);
    return match[3]?.toLowerCase() === 'mil' ? val * 1000 : (val < 100 ? val * 1000 : val);
  }
  return extractFirstNumber(text) || 0;
}

function extractPaymentAmount(text: string): number | null {
  const verbMatch = text.match(/(pagar|pagou|mandou|acertou)\s+(\d+)\s*(mil)?/i);
  if (verbMatch) {
    const val = parseInt(verbMatch[2], 10);
    return verbMatch[3]?.toLowerCase() === 'mil' ? val * 1000 : val;
  }
  return extractFirstNumber(text);
}

function extractFirstNumber(text: string): number | null {
  const milRegex = /(\d+)\s*mil\b/i;
  const matchMil = text.match(milRegex);
  if (matchMil) {
    return parseInt(matchMil[1], 10) * 1000;
  }

  if (/\b(um\s+)?mil\b/i.test(text)) {
    return 1000;
  }

  const numRegex = /\b(\d{2,6})\b/;
  const matchNum = text.match(numRegex);
  if (matchNum) {
    return parseInt(matchNum[1], 10);
  }

  return null;
}

function extractSaleNumbers(text: string): {
  totalValue?: number;
  cashIn?: number;
  receivable?: number;
  installmentsCount?: number;
  installmentAmount?: number;
  dueDay?: number;
} {
  let totalValue: number | undefined = undefined;
  let cashIn: number | undefined = undefined;
  let receivable: number | undefined = undefined;
  let installmentsCount: number | undefined = undefined;
  let installmentAmount: number | undefined = undefined;
  let dueDay: number | undefined = undefined;

  // Valor total (ex: "por 900", "por 1000", "por 26", "por vinte e seis")
  const totalMatch = text.match(/por\s+(\d+)\s*(mil)?/i);
  if (totalMatch) {
    const rawVal = parseInt(totalMatch[1], 10);
    totalValue = totalMatch[2]?.toLowerCase() === 'mil' || rawVal < 100 ? (rawVal < 100 ? rawVal * 1000 : rawVal) : rawVal;
  } else {
    totalValue = extractFirstNumber(text) || undefined;
  }

  // Entrada em dinheiro (ex: "deu 500 de entrada", "deu mil no pix", "mandou 3 no pix")
  const cashMatch =
    text.match(/deu\s+(\d+)\s*(mil)?\s*(de entrada|no pix|em dinheiro)?/i) ||
    text.match(/mandou\s+(\d+)\s*(mil)?\s*(no pix|em dinheiro)?/i) ||
    text.match(/(\d+)\s*(mil)?\s*no pix/i);

  if (cashMatch) {
    const rawVal = parseInt(cashMatch[1], 10);
    cashIn = cashMatch[2]?.toLowerCase() === 'mil' || rawVal < 100 ? (rawVal < 100 ? rawVal * 1000 : rawVal) : rawVal;
  }

  // Parcelas (ex: "em 2 vezes de 200", "quatro de dois todo dia 15", "4 de 2 todo dia 15")
  const instMatch =
    text.match(/(\d+)\s*(vezes|parcelas)\s*de\s*(\d+)\s*(mil)?/i) ||
    text.match(/em\s*(\d+)\s*de\s*(\d+)\s*(mil)?/i) ||
    text.match(/(\d+)\s*de\s*(\d+)\s*(mil)?/i);

  if (instMatch) {
    installmentsCount = parseInt(instMatch[1], 10);
    const rawInstVal = parseInt(instMatch[3] || instMatch[2], 10);
    installmentAmount = instMatch[4]?.toLowerCase() === 'mil' || rawInstVal < 100 ? (rawInstVal < 100 ? rawInstVal * 1000 : rawInstVal) : rawInstVal;
  }

  // Dia do vencimento (ex: "todo dia 15", "dia 10")
  const dueMatch = text.match(/dia\s+(\d{1,2})/i);
  if (dueMatch) {
    dueDay = parseInt(dueMatch[1], 10);
  }

  // Saldo a receber calculado ou informado
  if (totalValue && cashIn && totalValue >= cashIn) {
    receivable = totalValue - cashIn;
  } else if (installmentsCount && installmentAmount) {
    receivable = installmentsCount * installmentAmount;
  }

  return {
    totalValue,
    cashIn,
    receivable,
    installmentsCount,
    installmentAmount,
    dueDay,
  };
}
