// src/lib/ai/command-builder.ts
// Converte a interpretação (LLM ou fallback) em DealCommand e valida com DealCommandSchema.
// O resultado do safeParse é obrigatório: objeto inválido nunca segue para o executor.
// Nenhum valor é inventado — só derivações aritméticas de valores ditos (ex.: item da troca =
// item entregue − volta recebida). O que não dá para derivar vira pergunta.

import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import type { DealCommand, MissingInformationItem } from '@/types/deal-command';
import { DealCommandSchema } from '@/lib/ai/schemas/deal-command.schema';
import { formatZodIssues } from '@/lib/ai/schemas/llm-interpretation.schema';
import { toCents, toReais } from '@/lib/finance/money';
import { buildInstallmentSchedule } from '@/lib/finance/installment-schedule';
import { inferTradeBalanceDirection } from '@/lib/ai/trade-direction';

export type BuildResult =
  | { status: 'ok'; command: DealCommand }
  | { status: 'needs_input'; question: string; field: string; missing: MissingInformationItem[] }
  | { status: 'invalid'; errors: string[] };

function ask(field: string, type: MissingInformationItem['type'], question: string): BuildResult {
  return { status: 'needs_input', question, field, missing: [{ type, description: question, promptQuestion: question }] };
}

/** Nome usado quando a fala não disse a mercadoria: a venda não fica refém do cadastro. */
export const UNNAMED_ITEM = 'Mercadoria avulsa';

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

  const cashIn = cmd.cashIn;
  const cashOut = cmd.cashOut;
  let receivable = cmd.receivable;

  if (cmd.intent === 'create_sale') {
    if (!cmd.totalValue) return ask('totalValue', 'deal_total', `Por quanto você vendeu ${cmd.item ?? 'a mercadoria'}?`);
    draft.itemsOut.push(
      cmd.item
        ? { reference: cmd.item, itemId: itemOutIds[0], negotiatedValue: cmd.totalValue, direction: 'OUT' }
        : { description: UNNAMED_ITEM, newItem: true, negotiatedValue: cmd.totalValue, direction: 'OUT' }
    );
    if (receivable === undefined && cmd.installmentsCount && cmd.installmentAmount) {
      receivable = toReais(toCents(cmd.installmentsCount * cmd.installmentAmount));
    } else if (receivable === undefined && cmd.installmentsCount && cmd.cashIn !== undefined) {
      receivable = toReais(toCents(cmd.totalValue) - toCents(cmd.cashIn));
    }
  } else if (cmd.intent === 'create_purchase') {
    if (!cmd.totalValue) return ask('totalValue', 'acquisition_cost', `Quanto você pagou em ${cmd.item ?? 'na mercadoria'}?`);
    draft.itemsIn.push({ description: cmd.item ?? UNNAMED_ITEM, negotiatedValue: cmd.totalValue, direction: 'IN' });
  } else if (cmd.intent === 'create_trade') {
    const itemOutName = cmd.itemOut;
    const itemInName = cmd.itemIn ?? 'Mercadoria recebida (avulsa)';

    const balance = cmd.tradeBalance ?? 0;
    const dir = cmd.direction ?? (cmd.tradeBalance === 0 ? 'even' : undefined);
    if (!dir) return ask('direction', 'trade_balance_direction', 'Essa diferença ficou para você receber ou pagar?');

    // valor(sai) + pago pelo usuário = valor(entra) + recebido pelo usuário
    const signed = dir === 'inflow' ? balance : dir === 'outflow' ? -balance : 0;
    let outValue = cmd.totalValue;
    let inValue = cmd.itemInValue;
    if (outValue === undefined && inValue !== undefined) outValue = inValue + signed;
    if (inValue === undefined && outValue !== undefined) inValue = outValue - signed;
    if (outValue === undefined || inValue === undefined) {
      return ask('itemInValue', 'acquisition_cost', `Por quanto você avaliou ${itemInName} nessa troca?`);
    }
    if (inValue < 0) return { status: 'invalid', errors: ['Valor do item recebido ficaria negativo.'] };

    draft.itemsOut.push(
      itemOutName
        ? { reference: itemOutName, itemId: itemOutIds[0], negotiatedValue: outValue, direction: 'OUT' }
        : { description: 'Mercadoria entregue (avulsa)', newItem: true, negotiatedValue: outValue, direction: 'OUT' }
    );
    draft.itemsIn.push({ description: itemInName, negotiatedValue: inValue, direction: 'IN' });

    const debt = inferTradeBalanceDirection(cmd.rawText);
    if (debt.confidence === 'explicit' && debt.direction !== dir) {
      return { status: 'invalid', errors: ['Direção da troca contradiz a dívida explícita.'] };
    }
    // O saldo pode estar pendente; a direção sozinha nunca comprova pagamento no ato.
    if (dir === 'inflow' && receivable === undefined && balance > 0) {
      if (cmd.installmentsCount && cmd.installmentAmount) receivable = toReais(cmd.installmentsCount * toCents(cmd.installmentAmount));
      else if (cmd.installmentsCount && cashIn !== undefined) receivable = toReais(toCents(balance) - toCents(cashIn));
      else if (debt.confidence === 'explicit') receivable = balance;
    }
    if (dir === 'outflow' && cashOut === undefined && cmd.payable === undefined && balance > 0) {
      if (debt.confidence === 'explicit') cmd = { ...cmd, payable: balance };
    }
    if (balance > 0 && !cashIn && !cashOut && !receivable && !cmd.payable) {
      return ask('tradeBalance', 'payment_breakdown', 'Essa diferença foi paga no ato ou ficou pendente?');
    }
  } else {
    return { status: 'invalid', errors: [`Intenção ${cmd.intent} não gera negociação.`] };
  }

  if (cashIn) draft.cashIn.push({ amount: cashIn, method, direction: 'IN' });
  if (cashOut) draft.cashOut.push({ amount: cashOut, method, direction: 'OUT' });

  if (cmd.installmentsCount && (!receivable || receivable <= 0) && !cmd.payable && cmd.intent !== 'create_purchase') {
    return ask('receivable', 'payment_breakdown', 'Qual valor ficou parcelado?');
  }

  if (receivable) {
    const count = cmd.installmentsCount || 1;
    if (!cmd.scheduleRule) return ask('installment_schedule', 'installment_due_date', `Qual o vencimento das ${count} parcelas?`);
    let schedule;
    try {
      schedule = buildInstallmentSchedule({ total: receivable, count, rule: cmd.scheduleRule });
    } catch {
      return ask('installment_schedule', 'installment_due_date', 'As datas das parcelas não fecharam. Quais são os vencimentos?');
    }
    const installmentAmount = cmd.installmentAmount ?? schedule[0].amount;
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
        manualInstallments: schedule,
        isPromissory: false,
      },
    });
  }

  if (cmd.payable) {
    if (!cmd.scheduleRule) return ask('installment_schedule', 'installment_due_date',
      cmd.installmentsCount === 1 ? 'Quando vence essa parcela?' : `Qual o vencimento das ${cmd.installmentsCount ?? 1} parcelas?`);
    const count = cmd.installmentsCount ?? 1;
    let schedule;
    try {
      schedule = buildInstallmentSchedule({ total: cmd.payable, count, rule: cmd.scheduleRule });
    } catch {
      return ask('installment_schedule', 'installment_due_date', 'As datas das parcelas não fecharam. Quais são os vencimentos?');
    }
    draft.payables.push({ totalAmount: cmd.payable, installments: {
      count, installmentAmount: cmd.installmentAmount ?? schedule[0].amount,
      dueDayOfMonth: cmd.dueDay, firstDueDate: cmd.firstDueDate, manualInstallments: schedule,
    } });
  }

  const parsed = DealCommandSchema.safeParse(draft);
  if (!parsed.success) {
    return { status: 'invalid', errors: formatZodIssues(parsed.error) };
  }
  return { status: 'ok', command: parsed.data as DealCommand };
}
