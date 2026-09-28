// src/lib/ai/interpret.ts
// Interpretador canônico de produção — Fases A e B do hardening.
//
//   texto → guardrails determinísticos → LLM (Structured Output) → JSON.parse → Zod (.strict)
//         → [1 reparo se inválido] → grounding + completude → InterpretedVoiceCommand
//
// Regras:
//  * Guardrails (ordens destrutivas, valores/direção ambíguos) respondem antes da LLM, sem custo.
//  * Saída inválida no schema NUNCA é usada, nem parcialmente. Após um reparo sem sucesso,
//    o usuário é convidado a reformular.
//  * Provedor indisponível (sem chave, timeout, HTTP) → parser determinístico como fallback
//    (modo 'auto'). No modo 'llm_required' (benchmark LLM) não há fallback silencioso.

import { normalizeSpokenText } from '@/lib/voice/normalizer';
import { evaluateIntentConfidenceAndAmbiguity } from '@/lib/ai/disambiguation';
import type { ConversationContext } from '@/lib/ai/context_manager';
import { interpretVoiceCommand, InterpretedVoiceCommand, InterpretationMeta } from '@/lib/ai/interpreter';
import { callLLMStructured, LLMCaller, LLMMessage, LLMProviderError, LLMResponse, isLLMConfigured } from '@/lib/ai/provider';
import { buildInterpreterUserPrompt, buildRepairPrompt, DEAL_INTERPRETER_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import {
  formatZodIssues,
  LLM_INTERPRETATION_JSON_SCHEMA,
  LLMInterpretation,
  LLMInterpretationSchema,
} from '@/lib/ai/schemas/llm-interpretation.schema';
import { checkGrounding, completenessGaps, consistencyAmbiguities, correctionAmbiguities, CREATION_INTENTS, groundingAmbiguities, WRITE_INTENTS } from '@/lib/ai/grounding';
import { hasUnattributedTradeDifference, inferTradeBalanceDirection } from '@/lib/ai/trade-direction';
import { describeForReadback } from '@/lib/ai/readback';
import { interpretScheduleRule, spokenDueDates } from '@/lib/ai/schedule-interpretation';
import { todayISO } from '@/lib/domain/loan-plan';

export type InterpretMode = 'auto' | 'llm_required' | 'rules_only';

export interface InterpretOptions {
  mode?: InterpretMode;
  /** Injeção para testes; em produção usa o provedor real. */
  llm?: LLMCaller;
  now?: Date;
}

const REPHRASE_PROMPT = 'Não consegui entender com segurança. Pode repetir de outro jeito?';

export async function interpretVoiceCommandWithLLM(
  spokenText: string,
  context?: ConversationContext,
  options: InterpretOptions = {}
): Promise<InterpretedVoiceCommand> {
  const mode = options.mode ?? 'auto';
  const normalized = normalizeSpokenText(spokenText).normalizedText;

  // 1. Guardrails determinísticos (destrutivo / ambiguidade óbvia): não gastam LLM
  const guard = evaluateIntentConfidenceAndAmbiguity(normalized, {});
  if (guard.requiresConfirmation || guard.confidence === 'low') {
    return finalize(
      {
        intent: 'clarify_ambiguity',
        requiresConfirmation: true,
        confirmationPrompt: guard.suggestedPrompt || 'Você confirma esta operação?',
        missingInformation: [],
        ambiguities: guard.ambiguities,
        rawText: spokenText,
        normalizedText: normalized,
      },
      { source: 'guardrail' },
      spokenText,
      context,
      options.now
    );
  }

  if (mode === 'rules_only') {
    return finalize(interpretVoiceCommand(spokenText, context), { source: 'rules' }, spokenText, context, options.now);
  }

  const llm = options.llm ?? callLLMStructured;
  if (!options.llm && !isLLMConfigured()) {
    return providerUnavailable(spokenText, normalized, context, mode, 'not_configured');
  }

  // 2. LLM com Structured Output
  const messages: LLMMessage[] = [
    { role: 'system', content: DEAL_INTERPRETER_SYSTEM_PROMPT },
    { role: 'user', content: buildInterpreterUserPrompt(spokenText, context, options.now) },
  ];

  let response: LLMResponse;
  try {
    response = await llm({ messages, jsonSchema: LLM_INTERPRETATION_JSON_SCHEMA, schemaName: 'voice_command' });
  } catch (err) {
    const type = err instanceof LLMProviderError ? err.type : 'network';
    return providerUnavailable(spokenText, normalized, context, mode, type);
  }

  const meta: InterpretationMeta = {
    source: 'llm',
    provider: response.provider,
    model: response.model,
    latencyMs: response.latencyMs,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
  };

  // 3. Validação estrita; um único reparo
  let parsed = parseAndValidate(response.content);
  if (!parsed.success) {
    meta.repairAttempted = true;
    meta.validationErrors = parsed.errors;
    try {
      const repair = await llm({
        messages: [
          ...messages,
          { role: 'assistant', content: response.content.slice(0, 4000) },
          { role: 'user', content: buildRepairPrompt(parsed.errors) },
        ],
        jsonSchema: LLM_INTERPRETATION_JSON_SCHEMA,
        schemaName: 'voice_command',
      });
      meta.latencyMs = (meta.latencyMs ?? 0) + repair.latencyMs;
      meta.promptTokens = (meta.promptTokens ?? 0) + (repair.promptTokens ?? 0);
      meta.completionTokens = (meta.completionTokens ?? 0) + (repair.completionTokens ?? 0);
      parsed = parseAndValidate(repair.content);
      if (!parsed.success) meta.validationErrors = [...(meta.validationErrors ?? []), ...parsed.errors];
    } catch {
      // Falha de rede no reparo: cai no pedido de reformulação abaixo
    }
  }

  if (!parsed.success) {
    console.warn('[interpret] saída da LLM rejeitada pelo schema:', meta.validationErrors?.slice(0, 5));
    return {
      intent: 'clarify_ambiguity',
      requiresConfirmation: true,
      confirmationPrompt: REPHRASE_PROMPT,
      missingInformation: [],
      ambiguities: [],
      interpretation: meta,
      rawText: spokenText,
      normalizedText: normalized,
    };
  }

  return finalize(fromLLM(parsed.data, spokenText, normalized), meta, spokenText, context, options.now);
}

function parseAndValidate(content: string): { success: true; data: LLMInterpretation } | { success: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { success: false, errors: ['JSON inválido'] };
  }
  const result = LLMInterpretationSchema.safeParse(json);
  return result.success ? { success: true, data: result.data } : { success: false, errors: formatZodIssues(result.error) };
}

function providerUnavailable(
  spokenText: string,
  normalized: string,
  context: ConversationContext | undefined,
  mode: InterpretMode,
  reason: string
): InterpretedVoiceCommand {
  if (mode === 'llm_required') {
    return {
      intent: 'unrecognized_command',
      requiresConfirmation: true,
      confirmationPrompt: 'Serviço de interpretação indisponível.',
      missingInformation: [],
      ambiguities: [],
      interpretation: { source: 'llm', fallbackReason: reason },
      rawText: spokenText,
      normalizedText: normalized,
    };
  }
  return finalize(interpretVoiceCommand(spokenText, context), { source: 'rules_fallback', fallbackReason: reason }, spokenText, context);
}

function undef<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

/** Remove "pro"/"pra" final quando é a preposição antes do nome do cliente ("iPhone 13 pro Pedro"). */
function stripPrepositionSuffix(item: string | null, customer: string | null, rawText: string): string | null {
  if (!item || !customer) return item;
  const m = item.match(/^(.*\S)\s+(pro|pra)$/i);
  if (!m) return item;
  const first = customer.split(/\s+/)[0].toLowerCase();
  return rawText.toLowerCase().includes(`${m[2].toLowerCase()} ${first}`) ? m[1] : item;
}

export function fromLLM(o: LLMInterpretation, rawText: string, normalizedText: string): InterpretedVoiceCommand {
  const isAdjustment = o.intent === 'register_adjustment';
  o = {
    ...o,
    item: stripPrepositionSuffix(o.item, o.customerName, rawText),
    itemOut: stripPrepositionSuffix(o.itemOut, o.customerName, rawText),
  };
  return {
    intent: o.intent,
    counterparty: o.customerName ? { name: o.customerName } : undefined,
    item: undef(o.item),
    itemOut: undef(o.itemOut),
    itemIn: undef(o.itemIn),
    totalValue: undef(o.totalValue),
    itemInValue: undef(o.itemInValue),
    cashIn: undef(o.cashIn),
    cashOut: undef(o.cashOut),
    paymentMethod: undef(o.paymentMethod),
    tradeBalance: undef(o.tradeBalance),
    direction: undef(o.direction),
    receivable: undef(o.receivable),
    payable: undef(o.payable),
    installmentsCount: undef(o.installmentsCount),
    installmentAmount: undef(o.installmentAmount),
    dueDay: undef(o.dueDay),
    dueMonthOffset: undef(o.dueMonthOffset),
    firstDueDate: undef(o.firstDueDate),
    scheduleType: undef(o.scheduleType),
    explicitDueDates: o.explicitDueDates,
    recurrenceDay: undef(o.recurrenceDay),
    intervalDays: undef(o.intervalDays),
    amount: undef(o.amount),
    adjustmentAmount: isAdjustment ? undef(o.amount) : undefined,
    adjustmentType: undef(o.adjustmentType),
    operationKind: undef(o.operationKind),
    renegotiationScope: undef(o.renegotiationScope),
    installmentNumbers: o.installmentNumbers.length > 0 ? o.installmentNumbers : undefined,
    paymentScope: o.intent === 'create_loan' ? undefined : undef(o.paymentScope) ?? (o.amount ? 'amount' : undefined),
    installmentRef: o.installmentNumber ?? undef(o.installmentRef),
    debtHint: undef(o.debtHint),
    interestType: undef(o.interestType),
    interestRate: undef(o.interestRate),
    interestAmount: undef(o.interestAmount),
    queryType: undef(o.queryType),
    requiresConfirmation: false,
    missingInformation: o.missingInformation.map((m) => ({ type: m.type, description: m.question, promptQuestion: m.question })),
    ambiguities: o.ambiguities.map((a) => ({
      field: a.field,
      type: a.type,
      description: a.question,
      possibleInterpretations: a.options,
      suggestedPrompt: a.question,
    })),
    rawText,
    normalizedText,
  };
}

/** Grounding + completude + flag de confirmação, iguais para LLM e fallback. */
function finalize(
  cmd: InterpretedVoiceCommand,
  meta: InterpretationMeta,
  spokenText: string,
  context?: ConversationContext,
  now?: Date
): InterpretedVoiceCommand {
  const debt = cmd.intent === 'create_trade' ? inferTradeBalanceDirection(spokenText) : undefined;
  if (cmd.intent === 'create_trade' && debt) {
    if (debt.confidence === 'explicit') {
      // "20" sem unidade segue a convenção de milhares; só corrige exatamente 20 ↔ 20.000.
      const scaled = (value: number | undefined) => value !== undefined && debt.amount !== undefined
        && Math.round(value * 1000) === Math.round(debt.amount) ? debt.amount : value;
      const balance = scaled(cmd.tradeBalance) ?? debt.amount;
      cmd = {
        ...cmd,
        direction: cmd.direction ?? debt.direction,
        tradeBalance: balance,
        receivable: debt.direction === 'inflow' && cmd.receivable === undefined && cmd.cashIn === undefined
          ? debt.amount ?? balance : scaled(cmd.receivable),
        payable: debt.direction === 'outflow' && cmd.payable === undefined && cmd.cashOut === undefined
          ? debt.amount ?? balance : scaled(cmd.payable),
      };
    }
  }
  if (cmd.intent === 'create_trade' && (cmd.tradeBalance ?? 0) > 0 && hasUnattributedTradeDifference(spokenText)) {
    const difference = cmd.totalValue !== undefined && cmd.itemInValue !== undefined
      ? cmd.totalValue - cmd.itemInValue : undefined;
    const sideGroundedByItems = difference !== undefined && Math.round(Math.abs(difference) * 100) === Math.round(cmd.tradeBalance! * 100)
      && cmd.direction === (difference > 0 ? 'inflow' : 'outflow');
    if (!sideGroundedByItems) cmd = { ...cmd, direction: undefined };
  }
  // "pau a pau" = volta zero (normalização, não invenção)
  if (cmd.intent === 'create_trade' && cmd.direction === 'even' && cmd.tradeBalance === undefined) {
    cmd = { ...cmd, tradeBalance: 0 };
  }
  if (CREATION_INTENTS.has(cmd.intent) && !cmd.installmentsCount) {
    const saleRemaining = cmd.intent === 'create_sale' && cmd.totalValue !== undefined && cmd.cashIn !== undefined
      ? cmd.totalValue - cmd.cashIn : 0;
    const tradeRemaining = cmd.intent === 'create_trade' && cmd.direction === 'inflow' && cmd.tradeBalance !== undefined
      ? cmd.tradeBalance - (cmd.cashIn ?? 0) : 0;
    if ((cmd.receivable ?? 0) > 0 || (cmd.payable ?? 0) > 0 || saleRemaining > 0 || tradeRemaining > 0) cmd = { ...cmd, installmentsCount: 1 };
  }
  let scheduleQuestion: string | undefined;
  if (CREATION_INTENTS.has(cmd.intent) && cmd.installmentsCount) {
    const today = todayISO(now);
    const temporal = interpretScheduleRule(spokenText, cmd.installmentsCount, today);
    scheduleQuestion = cmd.intent === 'create_trade' && cmd.installmentsCount === 1
      && ((cmd.receivable ?? 0) > 0 || (cmd.payable ?? 0) > 0) && !temporal.rule
      ? undefined : temporal.question;
    const datesSpoken = spokenDueDates(spokenText, today);
    const claimedDates = [...(cmd.explicitDueDates ?? []), ...(cmd.firstDueDate ? [cmd.firstDueDate] : [])];
    const ungroundedDate = claimedDates.find((date) => !datesSpoken.includes(date) && !temporal.rule);
    if (ungroundedDate) {
      cmd = { ...cmd, ambiguities: [...cmd.ambiguities, {
        field: 'firstDueDate', type: 'value', description: 'Data sem apoio na fala.',
        possibleInterpretations: [], suggestedPrompt: 'Quando vencem as parcelas?'
      }] };
    }
    // A regra aceita é reconstruída da fala; datas devolvidas pela LLM nunca entram sozinhas na execução.
    cmd = { ...cmd, scheduleRule: temporal.rule, explicitDueDates: temporal.explicitDates,
      firstDueDate: temporal.explicitDates[0], dueDay: temporal.rule?.type === 'monthly_day' ? temporal.rule.dayOfMonth : undefined };
  }
  const groundingIssues = meta.source === 'guardrail' ? [] : checkGrounding(cmd, spokenText, context);
  const ambiguities = [
    ...cmd.ambiguities.filter((a) => !(debt?.confidence === 'explicit' && cmd.direction === debt.direction && a.field === 'direction')),
    ...groundingAmbiguities(groundingIssues),
    ...consistencyAmbiguities(cmd, spokenText),
    ...(meta.source === 'guardrail' ? [] : correctionAmbiguities(cmd, spokenText)),
  ];
  // Em criação, "quem é o cliente" / "qual mercadoria" nunca seguram o registro: viram avulsos
  const llmMissing = CREATION_INTENTS.has(cmd.intent)
    ? cmd.missingInformation.filter((m) => m.type !== 'customer_reference' && m.type !== 'item_reference'
      && !(m.type === 'installment_due_date' && cmd.scheduleRule)
      && !(m.type === 'trade_balance_direction' && debt?.confidence === 'explicit' && cmd.direction === debt.direction))
    : cmd.missingInformation;
  for (const item of llmMissing) {
    if (item.type === 'installment_due_date' && scheduleQuestion) {
      item.description = scheduleQuestion;
      item.promptQuestion = scheduleQuestion;
    }
  }
  const missingInformation = [...llmMissing, ...completenessGaps({ ...cmd, missingInformation: llmMissing }, !!context?.lastCustomer)];
  const dueGap = missingInformation.find((item) => item.type === 'installment_due_date');
  if (dueGap && scheduleQuestion) {
    dueGap.description = scheduleQuestion;
    dueGap.promptQuestion = scheduleQuestion;
  }

  if (groundingIssues.length > 0) {
    meta.validationErrors = [...(meta.validationErrors ?? []), ...groundingIssues.map((g) => `ungrounded:${g.field}=${g.value}`)];
  }

  const blocking = cmd.intent === 'clarify_ambiguity' || cmd.intent === 'unrecognized_command';
  const requiresConfirmation = blocking || ambiguities.length > 0 || missingInformation.length > 0;

  // Sem a LLM, o parser por regras erra fala livre: escrita só depois de confirmar a leitura de volta
  if (meta.source === 'rules_fallback' && WRITE_INTENTS.has(cmd.intent) && !requiresConfirmation) {
    return {
      ...cmd,
      ambiguities,
      missingInformation,
      requiresConfirmation: true,
      needsReadback: true,
      confirmationPrompt: describeForReadback(cmd),
      interpretation: meta,
    };
  }

  return {
    ...cmd,
    ambiguities,
    missingInformation,
    requiresConfirmation,
    confirmationPrompt: requiresConfirmation
      ? cmd.confirmationPrompt || ambiguities[0]?.suggestedPrompt || missingInformation[0]?.promptQuestion || 'Não entendi com clareza. Você vendeu, trocou ou recebeu algum valor?'
      : undefined,
    interpretation: meta,
  };
}
