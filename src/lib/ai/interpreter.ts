// src/lib/ai/interpreter.ts
// Parser determinístico de comandos de voz (regras/regex).
// NÃO é o interpretador principal de produção: o pipeline usa interpretVoiceCommandWithLLM (interpret.ts).
// Este parser continua como guardrail e fallback quando o provedor de LLM está indisponível,
// e é medido separadamente pelo benchmark `test:benchmark:rules`.
// Função pura (sem banco/rede). Nunca inventa valores: o que não foi dito fica undefined.

import { normalizeSpokenText } from '@/lib/voice/normalizer';
import { evaluateIntentConfidenceAndAmbiguity } from '@/lib/ai/disambiguation';
import { ConversationContext, resolvePronounsAndAnaphora } from '@/lib/ai/context_manager';
import { AmbiguityItem, MissingInformationItem, PaymentMethodType } from '@/types/deal-command';
import type { InstallmentReference } from '@/lib/domain/financial-target-resolver';

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

export type InterpretationSource = 'llm' | 'rules' | 'rules_fallback' | 'guardrail' | 'resume';

export interface InterpretationMeta {
  source: InterpretationSource;
  provider?: 'openai' | 'gemini';
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  repairAttempted?: boolean;
  validationErrors?: string[];
  fallbackReason?: string;
}

export interface InterpretedVoiceCommand {
  intent: InterpretedIntent;
  counterparty?: {
    name: string;
    phone?: string;
  };
  item?: string;
  itemOut?: string;
  itemIn?: string;
  /** Valor negociado do item que sai (venda/troca). */
  totalValue?: number;
  /** Valor atribuído ao item recebido na troca. */
  itemInValue?: number;
  cashIn?: number;
  cashOut?: number;
  paymentMethod?: PaymentMethodType;
  tradeBalance?: number;
  direction?: 'inflow' | 'outflow' | 'even';
  receivable?: number;
  payable?: number;
  installmentsCount?: number;
  installmentAmount?: number;
  dueDay?: number;
  /** 0 = próxima ocorrência do dia, 1 = mês que vem... (mudança de vencimento) */
  dueMonthOffset?: number;
  firstDueDate?: string;
  amount?: number;
  adjustmentAmount?: number;
  adjustmentType?: 'discount' | 'item_offset' | 'debt_offset' | 'service_offset';
  /** Pagamento: valor explícito, parcela inteira ou saldo total da dívida ("quitou o resto"). */
  paymentScope?: 'amount' | 'installment_full' | 'debt_full';
  installmentRef?: InstallmentReference;
  /** Referência da dívida pela mercadoria ("a dívida da moto"). */
  debtHint?: string;
  queryType?: string;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
  missingInformation: MissingInformationItem[];
  ambiguities: AmbiguityItem[];
  /** IDs escolhidos pelo usuário em desambiguações anteriores (preenchido pelo orquestrador). */
  resolvedRefs?: {
    customerId?: string;
    itemOutIds?: Record<number, string>;
    receivableId?: string;
  };
  interpretation?: InterpretationMeta;
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
    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
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
    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
    const dayMatch = normalizedTextWithNumbers.match(/dia\s+(\d{1,2})/i);
    const dueDay = dayMatch ? parseInt(dayMatch[1], 10) : undefined;
    const dueMonthOffset = /(m[eê]s que vem|pr[oó]ximo m[eê]s)/.test(normalizedTextWithNumbers) ? 1 : undefined;

    return {
      intent: 'update_due_date',
      counterparty: cust ? { name: cust } : undefined,
      dueDay,
      dueMonthOffset,
      installmentRef: extractInstallmentRef(normalizedTextWithNumbers),
      requiresConfirmation: !dueDay,
      missingInformation: dueDay
        ? []
        : [{ type: 'installment_due_date', description: 'Nova data não informada', promptQuestion: 'Para qual dia fica o vencimento?' }],
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
    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
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
    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
    const structured = extractTradeItemsByStructure(t);
    const items = structured ? [structured.itemOut, structured.itemIn] : extractAllItems(t, cust);
    const itemOut = items[0] || contextualItem;
    const itemIn = items[1];

    let direction: 'inflow' | 'outflow' | 'even' = 'even';

    const isEven = normalizedTextWithNumbers.includes('pau a pau') || normalizedTextWithNumbers.includes('sem volta') || normalizedTextWithNumbers.includes('troca seca');
    const isVoltou = normalizedTextWithNumbers.includes('ele me voltou') || normalizedTextWithNumbers.includes('me voltou') || normalizedTextWithNumbers.includes('recebi') || normalizedTextWithNumbers.includes('mandou');
    const isVoltei = normalizedTextWithNumbers.includes('completei') || normalizedTextWithNumbers.includes('paguei') || normalizedTextWithNumbers.includes('voltei');

    // "por N" em ordem: 1º = valor do item que sai, 2º = valor do item que entra
    const porValues = [...normalizedTextWithNumbers.matchAll(/por\s+(\d+)\s*(mil)?/gi)].map((m) => scaleShorthand(parseInt(m[1], 10), m[2]));
    const totalValue = porValues[0];
    const itemInValue = porValues[1];
    const values = extractSaleNumbers(normalizedTextWithNumbers);
    const schedule = values.installmentsCount && values.installmentAmount
      ? { installmentsCount: values.installmentsCount, installmentAmount: values.installmentAmount }
      : undefined;

    let tradeBalance = 0;
    if (isEven) {
      direction = 'even';
    } else if (isVoltou || isVoltei) {
      direction = isVoltou ? 'inflow' : 'outflow';
      tradeBalance = totalValue !== undefined && itemInValue !== undefined
        ? Math.abs(totalValue - itemInValue)
        : values.cashIn || extractTradeBalanceValue(normalizedTextWithNumbers);
    } else {
      const anyVal = extractFirstNumber(normalizedTextWithNumbers);
      if (anyVal) {
        direction = 'inflow';
        tradeBalance = anyVal;
      }
    }

    // Dinheiro no ato: explícito na fala; sem parcelas, a volta inteira foi paga no ato
    const explicitCash = values.cashIn;
    const cashNow = explicitCash ?? (schedule ? undefined : tradeBalance || undefined);
    const receivable = direction === 'inflow' && schedule ? schedule.installmentsCount * schedule.installmentAmount : undefined;

    return {
      intent: 'create_trade',
      counterparty: cust ? { name: cust } : undefined,
      itemOut: itemOut,
      itemIn: itemIn,
      direction,
      tradeBalance,
      totalValue,
      itemInValue,
      cashIn: direction === 'inflow' ? cashNow : undefined,
      cashOut: direction === 'outflow' ? cashNow : undefined,
      paymentMethod: extractPaymentMethod(normalizedTextWithNumbers),
      receivable,
      installmentsCount: schedule?.installmentsCount,
      installmentAmount: schedule?.installmentAmount,
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
    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
    const item = extractItemReference(t, cust) || contextualItem;
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
    const paymentMethod = extractPaymentMethod(normalizedTextWithNumbers);
    // Venda sem parcelamento só tem entrada no ato se a forma de pagamento foi dita
    const cashNow = cashIn !== undefined ? cashIn : !isParcelada && paymentMethod ? totalValue : undefined;

    return {
      intent: 'create_sale',
      counterparty: cust ? { name: cust } : undefined,
      item,
      totalValue,
      cashIn: cashNow,
      paymentMethod,
      receivable,
      installmentsCount,
      installmentAmount,
      dueDay,
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

    const cust = withSurname(extractEntityName(t), spokenText) || contextualCustomer;
    const amount = extractPaymentAmount(normalizedTextWithNumbers);
    const installmentRef = extractInstallmentRef(normalizedTextWithNumbers);
    const settlesDebt = /\b(quitou|quitar|acertou tudo|pagou tudo|o resto|tudo que devia)\b/.test(normalizedTextWithNumbers);
    const paymentScope: InterpretedVoiceCommand['paymentScope'] = amount
      ? 'amount'
      : settlesDebt && !installmentRef
        ? 'debt_full'
        : /\bparcela\b/.test(normalizedTextWithNumbers) || installmentRef
          ? 'installment_full'
          : undefined;

    return {
      intent: isPartial ? 'register_partial_payment' : 'register_payment',
      counterparty: cust ? { name: cust } : undefined,
      amount: amount || undefined,
      paymentScope,
      installmentRef,
      paymentMethod: extractPaymentMethod(normalizedTextWithNumbers),
      requiresConfirmation: !paymentScope,
      missingInformation: !paymentScope
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

function scaleShorthand(value: number, milSuffix?: string): number {
  // Convenção do setor: "por 26" (sem unidade) em negócio de veículo = 26 mil
  return milSuffix?.toLowerCase() === 'mil' || value < 100 ? value * 1000 : value;
}

function extractPaymentMethod(text: string): PaymentMethodType | undefined {
  if (/\bpix\b/.test(text)) return 'pix';
  if (/transfer[eê]ncia|\bted\b|\bdoc\b/.test(text)) return 'bank_transfer';
  if (/cart[aã]o/.test(text)) return 'card';
  if (/dinheiro|esp[eé]cie|[aà] vista/.test(text)) return 'cash';
  return undefined;
}

function extractInstallmentRef(text: string): InstallmentReference | undefined {
  if (/\b(primeira|1a)\b/.test(text)) return 'first';
  if (/[uú]ltima\b/.test(text)) return 'last';
  if (/\b(atrasada|vencida)\b/.test(text)) return 'overdue';
  if (/\bpr[oó]xima\b/.test(text)) return 'next';
  const n = text.match(/parcela\s+(\d{1,2})\b/);
  return n ? parseInt(n[1], 10) : undefined;
}

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

// Palavras que aparecem depois de "de/do/pra/pro" e nunca são nome de cliente
const NOT_A_NAME = new Set([
  'mil', 'um', 'uma', 'dois', 'duas', 'tres', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'meu', 'minha', 'dele', 'dela', 'ele', 'ela', 'que', 'dia', 'pix', 'conta', 'dívida', 'divida', 'parcela',
  'parcelas', 'volta', 'entrada', 'resto', 'total', 'dinheiro', 'cartão', 'cartao', 'vez', 'vezes', 'mês', 'mes',
  'hoje', 'amanhã', 'amanha', 'estoque', 'abater', 'pagar', 'quitar', 'receber', 'acertar', 'depois', 'novo', 'nova',
  'moto', 'carro', 'celular', 'aparelho', 'lucro', 'rua', 'mercadoria', 'manutenção', 'manutencao', 'desconto',
]);

const COMMON_NAMES = ['carlos', 'joão', 'joao', 'marcos', 'lucas', 'felipe', 'pedro', 'gabriel', 'rafael', 'bruno', 'rodrigo', 'diego', 'matheus'];

function extractEntityName(text: string): string | undefined {
  const t = text.toLowerCase();
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  for (const name of COMMON_NAMES) {
    if (new RegExp(String.raw`(^|[^\p{L}])${name}([^\p{L}]|$)`, 'u').test(t)) return cap(name);
  }

  const prefixes = ['pro ', 'para o ', 'pra ', 'com o ', 'do ', 'ao ', 'de '];
  for (const p of prefixes) {
    let idx = t.indexOf(p);
    while (idx !== -1) {
      const word = t.slice(idx + p.length).trim().split(/[ ,.!?]/)[0];
      const startsWord = idx === 0 || /[^\p{L}]/u.test(t[idx - 1]);
      if (startsWord && word.length > 2 && /^\p{L}+$/u.test(word) && !NOT_A_NAME.has(word)) return cap(word);
      idx = t.indexOf(p, idx + 1);
    }
  }
  return undefined;
}

const formatItem = (raw: string) =>
  raw
    .trim()
    .split(/\s+/)
    .map((w) => (w === 'xre' ? 'XRE' : w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');

/**
 * Itens de uma troca pela estrutura da frase:
 *   "troquei/passei meu A no/na B do X"      → saída A, entrada B
 *   "peguei o/a B do X, dei meu/minha A"     → saída A, entrada B
 */
function extractTradeItemsByStructure(text: string): { itemOut: string; itemIn: string } | undefined {
  const piece = '([^,.;]{2,40}?)';
  const direct = text.match(new RegExp(String.raw`(?:troquei|passei)\s+(?:o\s+|a\s+)?(?:meu|minha)?\s*${piece}\s+(?:no|na|pelo|pela)\s+(?:o\s+|a\s+)?${piece}\s+(?:do|da|de)\s+\p{L}+`, 'u'));
  if (direct) return { itemOut: formatItem(direct[1]), itemIn: formatItem(direct[2]) };
  const reverse = text.match(new RegExp(String.raw`peguei\s+(?:o|a)\s+${piece}\s+(?:do|da|de)\s+\p{L}+[^.]*?\bdei\s+(?:o\s+|a\s+)?(?:meu|minha)?\s*${piece}(?:\s+e\s|[,.;]|$)`, 'u'));
  if (reverse) return { itemOut: formatItem(reverse[2]), itemIn: formatItem(reverse[1]) };
  return undefined;
}

/** Completa o primeiro nome com sobrenome falado com inicial maiúscula ("João Pereira"). */
function withSurname(firstName: string | undefined, originalText: string): string | undefined {
  if (!firstName) return undefined;
  const idx = originalText.toLowerCase().indexOf(firstName.toLowerCase());
  if (idx < 0) return firstName;
  const match = originalText.slice(idx + firstName.length).match(/^\s+(\p{Lu}\p{Ll}{2,})/u);
  return match ? `${firstName} ${match[1]}` : firstName;
}

/** "iPhone 13 pro Carlos": o "pro" é preposição, não o modelo Pro. */
function isPrepositionPro(item: string, text: string, customer?: string): boolean {
  if (!item.endsWith(' pro') || !customer) return false;
  return text.includes(`pro ${customer.split(' ')[0].toLowerCase()}`);
}

function extractItemReference(text: string, customer?: string): string | undefined {
  const items = [
    'iphone 14 pro max', 'iphone 14', 'iphone 13 pro', 'iphone 13', 'iphone 12', 'iphone 11',
    's23 ultra', 's23', 's22',
    'titan 160', 'titan', 'fan 160', 'fan', 'bros 160', 'bros', 'xre 300', 'xre',
    'celta', 'palio', 'gol', 'corsa', 'civic', 'corolla',
    'notebook', 'betoneira', 'playstation', 'gerador', 'roçadeira'
  ];

  const t = text.toLowerCase();
  for (const it of items) {
    if (t.includes(it) && !isPrepositionPro(it, t, customer)) {
      let formatted = it.split(' ').map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
      if (it === 'xre' || it === 'xre 300') {
        formatted = formatted.replace(/xre/i, 'XRE');
      }
      return formatted;
    }
  }
  return undefined;
}

function extractAllItems(text: string, customer?: string): string[] {
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
    if (idx !== -1 && !isPrepositionPro(it, t, customer)) {
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
