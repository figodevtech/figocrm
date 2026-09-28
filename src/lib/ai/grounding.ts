// src/lib/ai/grounding.ts
// Verificações determinísticas aplicadas à saída da LLM (e do fallback) antes da execução:
//  1. Grounding: todo valor/nome precisa estar na fala (ou no contexto) ou ser derivável dela.
//  2. Completude: campos obrigatórios por intenção viram missingInformation, nunca default inventado.

import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import type { ConversationContext } from '@/lib/ai/context_manager';
import type { AmbiguityItem, MissingInformationItem } from '@/types/deal-command';
import { extractSpokenNumbers, extractSpokenNumbersDetailed } from '@/lib/voice/numbers';
import { inferTradeBalanceDirection } from '@/lib/ai/trade-direction';
import { nameTokens, referenceMatchesName } from '@/lib/domain/entity-resolver';
import { toCents } from '@/lib/finance/money';

export interface GroundingIssue {
  field: string;
  value: string | number;
}

const MONETARY_FIELDS = [
  'totalValue',
  'itemInValue',
  'cashIn',
  'cashOut',
  'tradeBalance',
  'receivable',
  'payable',
  'installmentAmount',
  'amount',
  'interestAmount',
] as const;

// Palavras que costumam abrir frase com maiúscula e não são nomes de pessoa
const SENTENCE_STARTERS = new Set(
  (
    'ele ela eles elas o a os as um uma e mas porque pro pra com do da no na me eu hoje ontem agora entao so ' +
    'quitou pagou mandou acertou vendi passei troquei peguei comprei dei fechei recebi abate abati tira desconta ' +
    'joga muda adia prorroga renegocia quanto quantos quantas quem qual ficou ficaram apaga zera exclui deixa deu ' +
    'pix real reais mil'
  ).split(' ')
);

/** Há na fala um nome próprio (maiúscula) diferente do cliente em contexto? */
export function mentionsOtherName(spokenText: string, contextName: string): boolean {
  const contextTokens = new Set(nameTokens(contextName));
  const words = spokenText.split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => {
    if (!/^\p{Lu}\p{Ll}{2,}$/u.test(w)) return false;
    const norm = nameTokens(w)[0];
    return !!norm && !SENTENCE_STARTERS.has(norm) && !contextTokens.has(norm);
  });
}

export function checkGrounding(
  cmd: InterpretedVoiceCommand,
  spokenText: string,
  context?: ConversationContext
): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  // Numa resposta a pergunta pendente, a fala original também é fonte válida
  const sourceText = [spokenText, context?.pendingConfirmation?.originalTranscript || ''].join(' \n ');

  const spokenCents = new Set<number>();
  for (const { value, literal } of extractSpokenNumbersDetailed(sourceText)) {
    if (value <= 0) continue;
    spokenCents.add(toCents(value));
    if (value < 1000 && !literal) spokenCents.add(toCents(value * 1000));
  }
  const countSpoken = cmd.installmentsCount !== undefined && extractSpokenNumbers(sourceText).includes(cmd.installmentsCount);
  // Apenas relações financeiras fechadas podem encadear derivações. Uma entrada inventada
  // não autoriza um resto inventado; a divisão só usa resto já ancorado/derivado e contagem dita.
  const saleRemainder = cmd.intent === 'create_sale' && cmd.totalValue !== undefined && cmd.cashIn !== undefined
    && spokenCents.has(toCents(cmd.totalValue)) && spokenCents.has(toCents(cmd.cashIn))
    ? toCents(cmd.totalValue) - toCents(cmd.cashIn) : undefined;
  const receivableCents = cmd.receivable === undefined ? undefined : toCents(cmd.receivable);
  const multipliedReceivable = countSpoken && cmd.installmentAmount !== undefined && spokenCents.has(toCents(cmd.installmentAmount))
    ? cmd.installmentsCount! * toCents(cmd.installmentAmount) : undefined;
  const tradeOut = cmd.intent === 'create_trade' && cmd.itemInValue !== undefined && cmd.tradeBalance !== undefined
    && spokenCents.has(toCents(cmd.itemInValue)) && spokenCents.has(toCents(cmd.tradeBalance))
    ? toCents(cmd.itemInValue) + (cmd.direction === 'inflow' ? toCents(cmd.tradeBalance) : -toCents(cmd.tradeBalance)) : undefined;
  const tradeIn = cmd.intent === 'create_trade' && cmd.totalValue !== undefined && cmd.tradeBalance !== undefined
    && spokenCents.has(toCents(cmd.totalValue)) && spokenCents.has(toCents(cmd.tradeBalance))
    ? toCents(cmd.totalValue) - (cmd.direction === 'inflow' ? toCents(cmd.tradeBalance) : -toCents(cmd.tradeBalance)) : undefined;
  const tradeBalanceDerived = cmd.intent === 'create_trade' && cmd.totalValue !== undefined && cmd.itemInValue !== undefined
    && spokenCents.has(toCents(cmd.totalValue)) && spokenCents.has(toCents(cmd.itemInValue))
    ? Math.abs(toCents(cmd.totalValue) - toCents(cmd.itemInValue)) : undefined;
  const tradeReceivable = cmd.intent === 'create_trade' && cmd.direction === 'inflow' && cmd.tradeBalance !== undefined && cmd.cashIn !== undefined
    && (spokenCents.has(toCents(cmd.tradeBalance)) || toCents(cmd.tradeBalance) === tradeBalanceDerived)
    && spokenCents.has(toCents(cmd.cashIn))
    ? toCents(cmd.tradeBalance) - toCents(cmd.cashIn) : undefined;
  const receivableGrounded = receivableCents !== undefined
    && (spokenCents.has(receivableCents) || receivableCents === saleRemainder || receivableCents === tradeReceivable);
  const derivedInstallment = countSpoken && receivableGrounded && receivableCents! % cmd.installmentsCount! === 0
    ? receivableCents! / cmd.installmentsCount! : undefined;
  for (const field of MONETARY_FIELDS) {
    const value = cmd[field];
    if (typeof value !== 'number' || value <= 0) continue;
    const cents = toCents(value);
    const derived = field === 'receivable' && (cents === saleRemainder || cents === multipliedReceivable || cents === tradeReceivable)
      || field === 'installmentAmount' && cents === derivedInstallment
      || field === 'totalValue' && cents === tradeOut
      || field === 'itemInValue' && cents === tradeIn;
    const backedByTrade = field === 'tradeBalance' && cents === tradeBalanceDerived;
    if (!spokenCents.has(cents) && !derived && !backedByTrade) {
      issues.push({ field, value });
    }
  }

  const rawNumbers = new Set(extractSpokenNumbers(sourceText));
  if (cmd.installmentsCount !== undefined && cmd.installmentsCount > 1 && !rawNumbers.has(cmd.installmentsCount)) {
    issues.push({ field: 'installmentsCount', value: cmd.installmentsCount });
  }
  if (cmd.dueDay !== undefined && !rawNumbers.has(cmd.dueDay)
    && !(cmd.scheduleRule?.type === 'monthly_day' && cmd.scheduleRule.dayOfMonth === cmd.dueDay)) {
    issues.push({ field: 'dueDay', value: cmd.dueDay });
  }
  // Percentual de juros precisa ter sido dito ("10%", "dez por cento")
  if (cmd.interestRate !== undefined && cmd.interestRate > 0 && !rawNumbers.has(cmd.interestRate)) {
    issues.push({ field: 'interestRate', value: cmd.interestRate });
  }

  const name = cmd.counterparty?.name;
  if (name) {
    const inText = referenceMatchesName(name, sourceText);
    // Nome vindo do contexto só vale se a fala não cita outra pessoa ("Joana pagou" nunca vira "Carlos")
    // Nome do contexto só completa quem NÃO foi nomeado ("ele pagou"). Se a fala diz um nome ("o João pagou"),
    // o nome inteiro precisa estar na fala: "João" nunca vira o "João Santos" da conversa anterior.
    // Na tela de um cliente, ele é contexto explícito escolhido pelo usuário.
    const fromContext =
      !!context?.lastCustomer &&
      referenceMatchesName(name, context.lastCustomer.name) &&
      (context.screenCustomerId === context.lastCustomer.id || !mentionsOtherName(spokenText, ''));
    if (!inText && !fromContext) issues.push({ field: 'customer', value: name });
  }

  for (const field of ['item', 'itemOut', 'itemIn'] as const) {
    const item = cmd[field];
    if (!item) continue;
    const tokens = nameTokens(item).filter((t) => t.length >= 2);
    const textTokens = new Set(nameTokens(sourceText));
    const inText = tokens.some((t) => textTokens.has(t));
    const fromContext = !!context?.lastItem && referenceMatchesName(item, context.lastItem.name);
    if (!inText && !fromContext) issues.push({ field, value: item });
  }

  return issues;
}

// Autocorreção no meio da fala: "16.500, quer dizer, 15.500" / "700... não, 600" / "1.300, aliás 1.200"
const CORRECTION_MARKER = /(\.\.\.\s*n[aã]o\b|,\s*n[aã]o\b|\bquer dizer\b|\bali[aá]s\b|\bdigo\b|\bmelhor dizendo\b)/gi;

/** Valores que o usuário retirou ao se corrigir (e que por isso não podem ser usados). */
export function retractedValues(spokenText: string): { retracted: Set<number>; corrected: Set<number> } {
  const retracted = new Set<number>();
  const corrected = new Set<number>();
  for (const m of spokenText.matchAll(CORRECTION_MARKER)) {
    const start = m.index ?? 0;
    const before = extractSpokenNumbersDetailed(spokenText.slice(Math.max(0, start - 40), start));
    const after = extractSpokenNumbersDetailed(spokenText.slice(start + m[0].length, start + m[0].length + 60));
    const wrong = before[before.length - 1];
    const right = after[0];
    if (!wrong || !right || wrong.value === right.value) continue;
    for (const [n, target] of [[wrong, retracted], [right, corrected]] as const) {
      target.add(n.value);
      if (n.value < 1000 && !n.literal) target.add(n.value * 1000);
    }
  }
  for (const v of corrected) retracted.delete(v);
  return { retracted, corrected };
}

export function correctionAmbiguities(cmd: InterpretedVoiceCommand, spokenText: string): AmbiguityItem[] {
  const { retracted } = retractedValues(spokenText);
  if (retracted.size === 0) return [];
  const used = MONETARY_FIELDS.filter((f) => typeof cmd[f] === 'number' && retracted.has(cmd[f] as number));
  if (used.length === 0) return [];
  return [
    {
      field: used[0],
      type: 'value',
      description: `Valor corrigido na fala foi usado (${used.join(', ')}).`,
      possibleInterpretations: [],
      suggestedPrompt: 'Você corrigiu o valor no meio da frase. Qual é o valor certo?',
    },
  ];
}

/** Transforma problemas de grounding em ambiguidades: o comando nunca executa com valor inventado. */
export function groundingAmbiguities(issues: GroundingIssue[]): AmbiguityItem[] {
  return issues.map((issue) => {
    const isName = issue.field === 'customer';
    const isItem = issue.field === 'item' || issue.field === 'itemOut' || issue.field === 'itemIn';
    return {
      field: issue.field,
      type: isName ? 'customer' : isItem ? 'item' : 'value',
      description: `Valor não encontrado na fala: ${issue.field}=${issue.value}`,
      possibleInterpretations: [],
      suggestedPrompt: isName
        ? 'De qual cliente você está falando?'
        : isItem
          ? 'Qual mercadoria exatamente?'
          : 'Não peguei os valores direito. Pode repetir com os números?',
    };
  });
}

/**
 * Contradições internas que a LLM pode produzir mesmo com valores ancorados na fala
 * (ex.: "completei 9600" como dinheiro RECEBIDO com direção outflow). Viram ambiguidade.
 */
/** "daquela parcela de mil" → 1000; "da parcela de 500" → 500. */
export function citedInstallmentValue(spokenText?: string): number | undefined {
  const m = spokenText?.toLowerCase().match(/parcela de ([^,.;!?]{1,30})/);
  if (!m) return undefined;
  const [value] = extractSpokenNumbers(m[1]);
  return value && value > 0 ? value : undefined;
}

export function consistencyAmbiguities(cmd: InterpretedVoiceCommand, spokenText?: string): AmbiguityItem[] {
  // "pagou 1300 daquela parcela de mil": pagamento maior que a parcela citada é contraditório
  // O valor da parcela citada vem da própria fala quando a interpretação não o preencheu.
  const citedInstallment = cmd.installmentAmount ?? citedInstallmentValue(spokenText);
  if ((cmd.intent === 'register_payment' || cmd.intent === 'register_partial_payment') && cmd.amount && citedInstallment && cmd.amount > citedInstallment) {
    return [
      {
        field: 'amount',
        type: 'value',
        description: 'Valor pago maior que a parcela citada.',
        possibleInterpretations: ['Pagou a parcela e adiantou o resto', 'Valor ou parcela entendidos errado'],
        suggestedPrompt: 'O valor passa da parcela que você citou. Quanto ele pagou e de qual parcela?',
      },
    ];
  }
  if (cmd.intent !== 'create_trade') return [];
  if (spokenText) {
    const t = spokenText.toLowerCase();
    const otherPaid = /\b(ele|ela) (?:me )?(?:completou|voltou|deu|mandou|inteirou)\b|\bpeguei [^.]{0,30}na volta\b/.test(t);
    const userPaid = /\b(completei|voltei|inteirei|paguei|eu dei|tive que completar)\b/.test(t);
    const debt = inferTradeBalanceDirection(spokenText);
    if (debt.confidence === 'explicit') {
      const wrongSide = cmd.direction !== debt.direction
        || (debt.direction === 'inflow' && ((cmd.payable ?? 0) > 0 || (cmd.cashOut ?? 0) > 0))
        || (debt.direction === 'outflow' && ((cmd.receivable ?? 0) > 0 || (cmd.cashIn ?? 0) > 0));
      const unpaid = debt.direction === 'inflow' ? cmd.receivable : cmd.payable;
      const cash = debt.direction === 'inflow' ? cmd.cashIn : cmd.cashOut;
      const paidNow = debt.direction === 'inflow' ? otherPaid : userPaid;
      const wrongAmount = debt.amount !== undefined && (unpaid !== undefined && toCents(unpaid) !== toCents(debt.amount)
        || cmd.tradeBalance !== undefined && toCents(cmd.tradeBalance) !== toCents(debt.amount + (cash ?? 0)));
      if (wrongSide || wrongAmount || (cash ?? 0) > 0 && !paidNow) {
        return [{ field: 'direction', type: 'direction',
          description: 'Saldo, dívida ou pagamento contradiz a relação explícita na fala.',
          possibleInterpretations: ['Diferença a receber', 'Diferença a pagar'],
          suggestedPrompt: 'Confirme quem ficou devendo, o valor pendente e se houve pagamento no ato.',
        }];
      }
    }
    if ((otherPaid && !userPaid && cmd.direction === 'outflow') || (userPaid && !otherPaid && cmd.direction === 'inflow')) {
      return [
        {
          field: 'direction',
          type: 'direction',
          description: 'Direção da volta contradiz quem completou na fala.',
          possibleInterpretations: ['Você recebeu a volta', 'Você pagou a volta'],
          suggestedPrompt: 'Essa diferença ficou para você receber ou pagar?',
        },
      ];
    }
  }
  if (cmd.itemOut && cmd.itemIn && nameTokens(cmd.itemOut).join(' ') === nameTokens(cmd.itemIn).join(' ')) {
    return [
      {
        field: 'itemIn',
        type: 'item',
        description: 'Mesmo item nos dois lados da troca.',
        possibleInterpretations: [],
        suggestedPrompt: 'Qual mercadoria saiu e qual entrou nessa troca?',
      },
    ];
  }
  const conflict =
    (cmd.direction === 'outflow' && (cmd.cashIn ?? 0) > 0) ||
    (cmd.direction === 'inflow' && (cmd.cashOut ?? 0) > 0) ||
    (cmd.direction === 'even' && ((cmd.cashIn ?? 0) > 0 || (cmd.cashOut ?? 0) > 0 || (cmd.tradeBalance ?? 0) > 0));
  if (!conflict) return [];
  return [
    {
      field: 'direction',
      type: 'direction',
      description: 'Direção da volta contradiz o dinheiro informado.',
      possibleInterpretations: ['Você recebeu a volta', 'Você pagou a volta'],
      suggestedPrompt: 'Essa diferença ficou para você receber ou pagar?',
    },
  ];
}

/** Criação (venda, troca, compra, empréstimo): cliente/mercadoria não ditos ou não achados viram avulsos. */
export const CREATION_INTENTS = new Set(['create_sale', 'create_trade', 'create_purchase', 'create_loan']);

export const WRITE_INTENTS = new Set([
  'create_sale', 'create_trade', 'create_purchase', 'create_loan', 'register_payment', 'register_partial_payment',
  'register_adjustment', 'update_due_date', 'renegotiate_debt', 'reverse_operation',
]);

/** Campos obrigatórios por intenção — aplicado a qualquer interpretação (LLM ou regras). */
export function completenessGaps(cmd: InterpretedVoiceCommand, contextCustomerAvailable = false): MissingInformationItem[] {
  const gaps: MissingInformationItem[] = [];
  const add = (type: MissingInformationItem['type'], promptQuestion: string) => {
    if (!cmd.missingInformation.some((m) => m.type === type)) gaps.push({ type, description: promptQuestion, promptQuestion });
  };

  // Pagamento/abatimento/vencimento precisam de uma pessoa (a dívida é dela). Criação não: sem nome → cliente avulso.
  if (WRITE_INTENTS.has(cmd.intent) && !CREATION_INTENTS.has(cmd.intent) && !cmd.counterparty?.name && !cmd.resolvedRefs?.customerId && !contextCustomerAvailable) {
    add('customer_reference', 'De qual cliente você está falando?');
  }

  switch (cmd.intent) {
    case 'create_sale':
      if (cmd.totalValue === undefined) add('deal_total', `Por quanto você vendeu ${cmd.item || 'a mercadoria'}?`);
      // Venda sem pagamento no ato e sem valor a receber: não sabemos como foi paga
      if (cmd.totalValue !== undefined && !cmd.cashIn && !cmd.receivable && !cmd.installmentsCount) {
        add('payment_breakdown', 'Como ele pagou: à vista ou ficou devendo?');
      }
      if (cmd.installmentsCount && !cmd.scheduleRule) add('installment_due_date', `Qual o vencimento das ${cmd.installmentsCount} parcelas?`);
      break;
    case 'create_purchase':
      if (cmd.totalValue === undefined) add('acquisition_cost', `Quanto você pagou em ${cmd.item || 'na mercadoria'}?`);
      break;
    case 'create_trade':
      if (cmd.direction !== 'even' && (!cmd.tradeBalance || cmd.tradeBalance <= 0)) {
        add('payment_breakdown', cmd.direction
          ? 'Qual foi o valor da diferença nessa troca?'
          : 'Houve diferença nessa troca? Se sim, quanto ficou para receber ou pagar?');
      }
      if (cmd.tradeBalance && cmd.tradeBalance > 0 && !cmd.direction
        && inferTradeBalanceDirection(cmd.rawText).confidence === 'unknown') {
        add('trade_balance_direction', 'Essa diferença ficou para você receber ou pagar?');
      }
      if (cmd.installmentsCount && !cmd.scheduleRule) {
        const pending = cmd.receivable ?? cmd.payable;
        const amount = pending && cmd.installmentsCount === 1
          ? ` de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(pending).replace(/\u00a0/g, ' ')}` : '';
        add('installment_due_date', cmd.installmentsCount === 1
          ? `Quando vence essa parcela${amount}?` : `Qual o vencimento das ${cmd.installmentsCount} parcelas?`);
      }
      break;
    case 'register_payment':
    case 'register_partial_payment':
      if (!cmd.amount && cmd.paymentScope !== 'debt_full' && cmd.paymentScope !== 'installment_full') {
        add('payment_breakdown', 'Qual foi o valor que você recebeu?');
      }
      break;
    case 'register_adjustment':
      if (!cmd.amount && !cmd.adjustmentAmount) add('deal_total', 'Qual o valor a ser abatido?');
      break;
    case 'update_due_date':
      if (!cmd.dueDay && !cmd.firstDueDate) add('installment_due_date', 'Para qual dia fica o vencimento?');
      break;
    case 'create_loan': {
      if (!cmd.amount) add('deal_total', 'Quanto você emprestou?');
      if (!cmd.installmentsCount) add('installments_count', 'Em quantas parcelas ele vai te pagar?');
      if (cmd.installmentsCount && !cmd.scheduleRule) add('installment_due_date', `Qual o vencimento das ${cmd.installmentsCount} parcelas?`);
      const interestKnown =
        cmd.installmentAmount !== undefined ||
        cmd.interestType === 'none' ||
        (cmd.interestType === 'fixed_amount' && cmd.interestAmount !== undefined) ||
        ((cmd.interestType === 'percent_total' || cmd.interestType === 'percent_monthly') && cmd.interestRate !== undefined);
      if (!interestKnown) add('loan_interest', 'Vai ter juros? Me diga a porcentagem ou o valor dos juros.');
      break;
    }
  }
  return gaps;
}
