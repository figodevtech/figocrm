// src/lib/ai/command-builder.ts
// Converte a interpretação (LLM ou fallback) em DealCommand e valida com DealCommandSchema.
// O resultado do safeParse é obrigatório: objeto inválido nunca segue para o executor.
// Nenhum valor é inventado — só derivações aritméticas de valores ditos (ex.: item da troca =
// item entregue − volta recebida). O que não dá para derivar vira pergunta.

import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import type { DealCommand, MissingInformationItem } from '@/types/deal-command';
import { DealCommandSchema } from '@/lib/ai/schemas/deal-command.schema';
import { formatZodIssues } from '@/lib/ai/schemas/llm-interpretation.schema';
import { toCents } from '@/lib/finance/money';

export type BuildResult =
  | { status: 'ok'; command: DealCommand }
  | { status: 'needs_input'; question: string; field: string; missing: MissingInformationItem[] }
  | { status: 'invalid'; errors: string[] };

function ask(field: string, type: MissingInformationItem['type'], question: string): BuildResult {
  return { status: 'needs_input', question, field, missing: [{ type, description: question, promptQuestion: question }] };
}

export function buildDealCommand(cmd: InterpretedVoiceCommand): BuildResult {
  const method = cmd.paymentMethod ?? 'other';
  const itemOutIds = cmd.resolvedRefs?.itemOutIds ?? {};
  const draft: DealCommand = {
    intent: 'create_deal',
    counterparty: cmd.resolvedRefs?.customerId
      ? { id: cmd.resolvedRefs.customerId, name: cmd.counterparty?.name || 'Cliente' }
      : cmd.counterparty?.name
        ? { name: cmd.counterparty.name }
        : undefined,
    itemsIn: [],
    itemsOut: [],
    cashIn: [],
    cashOut: [],
    receivables: [],
    payables: [],
    adjustments: [],
    missingInformation: [],
    ambiguities: [],
  };

  let cashIn = cmd.cashIn;
  let cashOut = cmd.cashOut;
  let receivable = cmd.receivable;

  if (cmd.intent === 'create_sale') {
    if (!cmd.item) return ask('item', 'item_reference', 'Qual mercadoria você vendeu?');
    if (!cmd.totalValue) return ask('totalValue', 'deal_total', `Por quanto você vendeu ${cmd.item}?`);
    draft.itemsOut.push({ reference: cmd.item, itemId: itemOutIds[0], negotiatedValue: cmd.totalValue, direction: 'OUT' });
    if (receivable === undefined && cmd.installmentsCount && cmd.installmentAmount) {
      receivable = cmd.installmentsCount * cmd.installmentAmount;
    }
  } else if (cmd.intent === 'create_purchase') {
    if (!cmd.item) return ask('item', 'item_reference', 'Qual mercadoria você comprou?');
    if (!cmd.totalValue) return ask('totalValue', 'acquisition_cost', `Quanto você pagou em ${cmd.item}?`);
    draft.itemsIn.push({ description: cmd.item, negotiatedValue: cmd.totalValue, direction: 'IN' });
  } else if (cmd.intent === 'create_trade') {
    if (!cmd.itemOut || !cmd.itemIn) return ask('item', 'item_reference', 'Quais mercadorias entraram e saíram nessa troca?');

    const balance = cmd.tradeBalance ?? 0;
    const dir = cmd.direction ?? (balance === 0 ? 'even' : undefined);
    if (!dir) return ask('direction', 'trade_balance_direction', 'Essa volta foi você que recebeu ou você que pagou?');

    // valor(sai) + pago pelo usuário = valor(entra) + recebido pelo usuário
    const signed = dir === 'inflow' ? balance : dir === 'outflow' ? -balance : 0;
    let outValue = cmd.totalValue;
    let inValue = cmd.itemInValue;
    if (outValue === undefined && inValue !== undefined) outValue = inValue + signed;
    if (inValue === undefined && outValue !== undefined) inValue = outValue - signed;
    if (outValue === undefined || inValue === undefined) {
      return ask('itemInValue', 'acquisition_cost', `Por quanto você avaliou ${cmd.itemIn} nessa troca?`);
    }
    if (inValue < 0) return { status: 'invalid', errors: ['Valor do item recebido ficaria negativo.'] };

    draft.itemsOut.push({ reference: cmd.itemOut, itemId: itemOutIds[0], negotiatedValue: outValue, direction: 'OUT' });
    draft.itemsIn.push({ description: cmd.itemIn, negotiatedValue: inValue, direction: 'IN' });

    // Volta sem parcelamento e sem dinheiro explícito: foi paga no ato ("ele me voltou 1000")
    if (dir === 'inflow' && cashIn === undefined && receivable === undefined && balance > 0) {
      receivable = cmd.installmentsCount && cmd.installmentAmount ? cmd.installmentsCount * cmd.installmentAmount : undefined;
      if (receivable === undefined) cashIn = balance;
    }
    if (dir === 'outflow' && cashOut === undefined && cmd.payable === undefined && balance > 0) {
      cashOut = balance;
    }
  } else {
    return { status: 'invalid', errors: [`Intenção ${cmd.intent} não gera negociação.`] };
  }

  if (cashIn) draft.cashIn.push({ amount: cashIn, method, direction: 'IN' });
  if (cashOut) draft.cashOut.push({ amount: cashOut, method, direction: 'OUT' });

  if (receivable) {
    const count = cmd.installmentsCount || 1;
    const installmentAmount = cmd.installmentAmount ?? receivable / count;
    if (cmd.installmentsCount && cmd.installmentAmount && toCents(count * cmd.installmentAmount) !== toCents(receivable)) {
      return ask(
        'installments',
        'installments_count',
        `As parcelas (${count}x de R$ ${cmd.installmentAmount}) não fecham com os R$ ${receivable} a receber. Como ficou?`
      );
    }
    draft.receivables.push({
      totalAmount: receivable,
      installments: {
        count,
        installmentAmount,
        dueDayOfMonth: cmd.dueDay,
        firstDueDate: cmd.firstDueDate,
        intervalDays: 30,
        isPromissory: false,
      },
    });
  }

  if (cmd.payable) {
    draft.payables.push({ totalAmount: cmd.payable, installments: undefined });
  }

  const parsed = DealCommandSchema.safeParse(draft);
  if (!parsed.success) {
    return { status: 'invalid', errors: formatZodIssues(parsed.error) };
  }
  return { status: 'ok', command: parsed.data as DealCommand };
}
