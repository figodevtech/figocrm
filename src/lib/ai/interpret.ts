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
import { checkGrounding, completenessGaps, groundingAmbiguities } from '@/lib/ai/grounding';

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
      context
    );
  }

  if (mode === 'rules_only') {
    return finalize(interpretVoiceCommand(spokenText, context), { source: 'rules' }, spokenText, context);
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

  return finalize(fromLLM(parsed.data, spokenText, normalized), meta, spokenText, context);
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

export function fromLLM(o: LLMInterpretation, rawText: string, normalizedText: string): InterpretedVoiceCommand {
  const isAdjustment = o.intent === 'register_adjustment';
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
    amount: undef(o.amount),
    adjustmentAmount: isAdjustment ? undef(o.amount) : undefined,
    adjustmentType: undef(o.adjustmentType),
    paymentScope: undef(o.paymentScope) ?? (o.amount ? 'amount' : undefined),
    installmentRef: o.installmentNumber ?? undef(o.installmentRef),
    debtHint: undef(o.debtHint),
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
  context?: ConversationContext
): InterpretedVoiceCommand {
  const groundingIssues = meta.source === 'guardrail' ? [] : checkGrounding(cmd, spokenText, context);
  const ambiguities = [...cmd.ambiguities, ...groundingAmbiguities(groundingIssues)];
  const missingInformation = [...cmd.missingInformation, ...completenessGaps(cmd)];

  if (groundingIssues.length > 0) {
    meta.validationErrors = [...(meta.validationErrors ?? []), ...groundingIssues.map((g) => `ungrounded:${g.field}=${g.value}`)];
  }

  const blocking = cmd.intent === 'clarify_ambiguity' || cmd.intent === 'unrecognized_command';
  const requiresConfirmation = blocking || ambiguities.length > 0 || missingInformation.length > 0;

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
