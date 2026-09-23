// src/lib/ai/grounding.ts
// Verificações determinísticas aplicadas à saída da LLM (e do fallback) antes da execução:
//  1. Grounding: todo valor/nome precisa estar na fala (ou no contexto) ou ser derivável dela.
//  2. Completude: campos obrigatórios por intenção viram missingInformation, nunca default inventado.

import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import type { ConversationContext } from '@/lib/ai/context_manager';
import type { AmbiguityItem, MissingInformationItem } from '@/types/deal-command';
import { extractSpokenNumbers, groundedMonetaryValues } from '@/lib/voice/numbers';
import { nameTokens, referenceMatchesName } from '@/lib/domain/entity-resolver';

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
] as const;

// Palavras que costumam abrir frase com maiúscula e não são nomes de pessoa
const SENTENCE_STARTERS = new Set(
  (
    'ele ela eles elas o a os as um uma e mas porque pro pra com do da no na me eu hoje ontem agora entao so ' +
    'quitou pagou mandou acertou vendi passei troquei peguei comprei dei fechei recebi abate abati tira desconta ' +
    'joga muda adia prorroga renegocia quanto quantos quantas quem qual ficou ficaram apaga zera exclui deixa deu'
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

  const grounded = groundedMonetaryValues(sourceText);
  for (const field of MONETARY_FIELDS) {
    const value = cmd[field];
    if (typeof value === 'number' && value > 0 && !grounded.has(Math.round(value * 100) / 100)) {
      issues.push({ field, value });
    }
  }

  const rawNumbers = new Set(extractSpokenNumbers(sourceText));
  if (cmd.installmentsCount !== undefined && cmd.installmentsCount > 1 && !rawNumbers.has(cmd.installmentsCount)) {
    issues.push({ field: 'installmentsCount', value: cmd.installmentsCount });
  }
  if (cmd.dueDay !== undefined && !rawNumbers.has(cmd.dueDay)) {
    issues.push({ field: 'dueDay', value: cmd.dueDay });
  }

  const name = cmd.counterparty?.name;
  if (name) {
    const inText = referenceMatchesName(name, sourceText);
    // Nome vindo do contexto só vale se a fala não cita outra pessoa ("Joana pagou" nunca vira "Carlos")
    const fromContext =
      !!context?.lastCustomer &&
      referenceMatchesName(name, context.lastCustomer.name) &&
      !mentionsOtherName(spokenText, context.lastCustomer.name);
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
export function consistencyAmbiguities(cmd: InterpretedVoiceCommand): AmbiguityItem[] {
  if (cmd.intent !== 'create_trade') return [];
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
    (cmd.direction === 'even' && ((cmd.cashIn ?? 0) > 0 || (cmd.cashOut ?? 0) > 0));
  if (!conflict) return [];
  return [
    {
      field: 'direction',
      type: 'direction',
      description: 'Direção da volta contradiz o dinheiro informado.',
      possibleInterpretations: ['Você recebeu a volta', 'Você pagou a volta'],
      suggestedPrompt: 'Essa volta foi você que recebeu ou você que pagou?',
    },
  ];
}

export const WRITE_INTENTS = new Set([
  'create_sale', 'create_trade', 'create_purchase', 'register_payment', 'register_partial_payment',
  'register_adjustment', 'update_due_date', 'renegotiate_debt', 'reverse_operation',
]);

/** Campos obrigatórios por intenção — aplicado a qualquer interpretação (LLM ou regras). */
export function completenessGaps(cmd: InterpretedVoiceCommand, contextCustomerAvailable = false): MissingInformationItem[] {
  const gaps: MissingInformationItem[] = [];
  const add = (type: MissingInformationItem['type'], promptQuestion: string) => {
    if (!cmd.missingInformation.some((m) => m.type === type)) gaps.push({ type, description: promptQuestion, promptQuestion });
  };

  // Toda escrita precisa de uma pessoa: dita na fala ou em contexto (nunca adivinhada)
  if (WRITE_INTENTS.has(cmd.intent) && !cmd.counterparty?.name && !cmd.resolvedRefs?.customerId && !contextCustomerAvailable) {
    add('customer_reference', 'De qual cliente você está falando?');
  }

  switch (cmd.intent) {
    case 'create_sale':
      if (!cmd.item) add('item_reference', 'Qual mercadoria você vendeu?');
      if (cmd.totalValue === undefined) add('deal_total', `Por quanto você vendeu ${cmd.item || 'a mercadoria'}?`);
      // Venda sem pagamento no ato e sem valor a receber: não sabemos como foi paga
      if (cmd.totalValue !== undefined && !cmd.cashIn && !cmd.receivable && !cmd.installmentsCount) {
        add('payment_breakdown', 'Como ele pagou: à vista ou ficou devendo?');
      }
      break;
    case 'create_purchase':
      if (!cmd.item) add('item_reference', 'Qual mercadoria você comprou?');
      if (cmd.totalValue === undefined) add('acquisition_cost', `Quanto você pagou em ${cmd.item || 'na mercadoria'}?`);
      break;
    case 'create_trade':
      if (!cmd.itemOut || !cmd.itemIn) add('item_reference', 'Quais mercadorias entraram e saíram nessa troca?');
      if (cmd.tradeBalance && cmd.tradeBalance > 0 && !cmd.direction) {
        add('trade_balance_direction', 'Essa volta foi você que recebeu ou você que pagou?');
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
  }
  return gaps;
}
