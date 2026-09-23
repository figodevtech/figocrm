// src/lib/ai/orchestrator.ts
// Pipeline de voz de produção:
//   texto → interpretação (guardrails → LLM → Zod → grounding) → desambiguação → entity resolution
//   → regras financeiras (builder + balanço) → executor seguro → transação PostgreSQL atômica
//   → audit log → contexto persistente (IDs reais) → resposta curta.
// A LLM interpreta, o backend valida, o banco executa.
//
// runVoicePipeline recebe o cliente Supabase autenticado por injeção: a rota Next e o teste E2E
// executam exatamente o mesmo código.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
  ContextPatch,
  ConversationContext,
  loadVoiceContext,
  PendingConfirmation,
  saveVoiceContext,
} from '@/lib/ai/context_manager';
import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import { interpretVoiceCommandWithLLM } from '@/lib/ai/interpret';
import { buildDealCommand } from '@/lib/ai/command-builder';
import { completenessGaps } from '@/lib/ai/grounding';
import { executeDealCommand } from '@/lib/domain/command-executor';
import { executeVoiceQuery } from '@/lib/domain/queries';
import { EntityCandidate, matchCandidateAnswer, nameTokens } from '@/lib/domain/entity-resolver';
import { resolveFinancialTarget, ResolvedDebt, OpenInstallment } from '@/lib/domain/financial-target-resolver';
import { applySettlement, rescheduleInstallment, SettlementResult } from '@/lib/domain/financial-operations';
import { extractSpokenNumbers } from '@/lib/voice/numbers';
import { formatCurrencyFromCents, toCents } from '@/lib/finance/money';

export interface VoicePipelineMetrics {
  interpretationSource?: string;
  provider?: string;
  model?: string;
  llmLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  executionLatencyMs: number;
  totalLatencyMs: number;
}

export interface VoiceProcessResult {
  success: boolean;
  intent: string;
  humanResponse: string;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
  missingInformation?: string[];
  executionStatus: 'executed' | 'requires_confirmation' | 'answered' | 'error';
  dealId?: string;
  error?: string;
  errorType?: string;
  metrics: VoicePipelineMetrics;
}

export interface VoicePipelineDeps {
  supabase: SupabaseClient;
  userId: string;
  interpret?: (spokenText: string, context: ConversationContext) => Promise<InterpretedVoiceCommand>;
  now?: Date;
}

type Outcome = Omit<VoiceProcessResult, 'metrics' | 'intent'> & { contextPatch?: ContextPatch };

const brl = (value: number) => formatCurrencyFromCents(toCents(value));

/** Wrapper para rotas Next: autentica pelo cookie e roda o pipeline. */
export async function processVoiceCommand(spokenText: string): Promise<VoiceProcessResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      intent: 'unauthenticated',
      humanResponse: 'Você precisa estar logado.',
      requiresConfirmation: false,
      executionStatus: 'error',
      errorType: 'auth',
      metrics: { executionLatencyMs: 0, totalLatencyMs: 0 },
    };
  }
  return runVoicePipeline(spokenText, { supabase, userId: user.id });
}

export async function runVoicePipeline(spokenText: string, deps: VoicePipelineDeps): Promise<VoiceProcessResult> {
  const t0 = Date.now();
  const { supabase, userId } = deps;
  const interpret = deps.interpret ?? ((text, ctx) => interpretVoiceCommandWithLLM(text, ctx, { now: deps.now }));

  let context = await loadVoiceContext(supabase, userId);

  // 1. Resposta a uma pergunta pendente (escolha de candidato ou valor que faltava)
  let interpreted = resumePending(spokenText, context.pendingConfirmation);
  if (!interpreted) interpreted = await interpret(spokenText, context);

  const tExec = Date.now();
  let outcome: Outcome;
  try {
    outcome = await execute(interpreted, spokenText, context, deps);
  } catch (err) {
    console.error('[voice] falha na execução:', err);
    outcome = {
      success: false,
      humanResponse: 'Ocorreu um erro ao processar o seu comando. Nada foi gravado.',
      requiresConfirmation: false,
      executionStatus: 'error',
      error: err instanceof Error ? err.message : String(err),
      errorType: 'exception',
    };
  }
  const executionLatencyMs = Date.now() - tExec;

  if (outcome.contextPatch) {
    context = await saveVoiceContext(supabase, context, outcome.contextPatch);
  }

  const meta = interpreted.interpretation;
  await supabase.from('ai_interactions').insert({
    user_id: userId,
    target_deal_id: outcome.dealId || null,
    spoken_text: spokenText,
    detected_intent: interpreted.intent,
    extracted_entities: { ...interpreted, rawText: undefined, normalizedText: undefined } as unknown as Record<string, unknown>,
    required_confirmation: outcome.requiresConfirmation,
    confirmation_prompt: outcome.confirmationPrompt || null,
    execution_status:
      outcome.executionStatus === 'requires_confirmation'
        ? 'requires_confirmation'
        : outcome.executionStatus === 'error'
          ? 'failed'
          : 'executed',
    latency_ms: Date.now() - t0,
  });

  const { contextPatch: _patch, ...result } = outcome;
  void _patch;
  return {
    ...result,
    intent: interpreted.intent,
    metrics: {
      interpretationSource: meta?.source,
      provider: meta?.provider,
      model: meta?.model,
      llmLatencyMs: meta?.latencyMs,
      promptTokens: meta?.promptTokens,
      completionTokens: meta?.completionTokens,
      executionLatencyMs,
      totalLatencyMs: Date.now() - t0,
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Execução por intenção
// ------------------------------------------------------------------------------------------------

async function execute(
  cmd: InterpretedVoiceCommand,
  spokenText: string,
  context: ConversationContext,
  deps: VoicePipelineDeps
): Promise<Outcome> {
  if (cmd.requiresConfirmation) {
    const prompt = cmd.confirmationPrompt || 'Pode repetir com mais detalhes?';
    const field = fieldForMissing(cmd);
    const keepDraft = cmd.intent !== 'clarify_ambiguity' && cmd.intent !== 'unrecognized_command';
    return askUser(prompt, keepDraft ? pending('missing_info', spokenText, prompt, cmd, field) : null, cmd.missingInformation.map((m) => m.type));
  }

  switch (cmd.intent) {
    case 'query_information':
      return executeQuery(cmd, spokenText, context, deps);
    case 'create_sale':
    case 'create_trade':
    case 'create_purchase':
      return executeDeal(cmd, spokenText, context, deps);
    case 'register_payment':
    case 'register_partial_payment':
    case 'register_adjustment':
    case 'update_due_date':
    case 'renegotiate_debt':
      return executeFinancial(cmd, spokenText, context, deps);
    default:
      return askUser('Não entendi com clareza. Você vendeu, trocou ou recebeu algum valor?', null);
  }
}

async function executeQuery(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const res = await executeVoiceQuery(
    deps.supabase,
    deps.userId,
    cmd.queryType || 'quanto_fulano_deve',
    { id: cmd.resolvedRefs?.customerId, name: cmd.counterparty?.name },
    context
  );

  if (res.pendingChoice) {
    return askUser(res.responseSummary, pending('entity_choice', spokenText, res.responseSummary, cmd, 'customer', res.pendingChoice.candidates));
  }
  return {
    success: res.success,
    humanResponse: res.responseSummary,
    requiresConfirmation: !!res.requiresConfirmation,
    executionStatus: res.requiresConfirmation ? 'requires_confirmation' : 'answered',
    contextPatch: res.resolvedCustomer ? { lastCustomer: { ...res.resolvedCustomer, type: 'customer' }, pendingConfirmation: null } : { pendingConfirmation: null },
  };
}

async function executeDeal(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const built = buildDealCommand(cmd);
  if (built.status === 'needs_input') {
    return askUser(built.question, pending('missing_info', spokenText, built.question, cmd, built.field), built.missing.map((m) => m.type));
  }
  if (built.status === 'invalid') {
    console.warn('[voice] DealCommand inválido, execução bloqueada:', built.errors);
    return {
      success: false,
      humanResponse: 'Não consegui montar esse negócio com segurança. Pode repetir com os valores?',
      requiresConfirmation: true,
      confirmationPrompt: 'Pode repetir com os valores?',
      executionStatus: 'requires_confirmation',
      error: built.errors.join('; '),
      errorType: 'validation',
      contextPatch: { pendingConfirmation: null },
    };
  }

  const res = await executeDealCommand(built.command, { supabase: deps.supabase, userId: deps.userId, context, source: 'VOICE_ASSISTANT' });

  if (res.pendingChoice) {
    const field = res.pendingChoice.field === 'item' ? `item:${res.pendingChoice.index ?? 0}` : 'customer';
    return askUser(res.humanSummary, pending('entity_choice', spokenText, res.humanSummary, cmd, field, res.pendingChoice.candidates));
  }
  if (res.requiresConfirmation) {
    const field = res.missingInformation?.includes('customer_reference') ? 'customer' : undefined;
    return askUser(res.humanSummary, pending('missing_info', spokenText, res.humanSummary, cmd, field), res.missingInformation);
  }
  if (!res.success) {
    return {
      success: false,
      humanResponse: res.humanSummary,
      requiresConfirmation: false,
      executionStatus: 'error',
      error: res.error,
      errorType: res.errorType,
      contextPatch: { pendingConfirmation: null },
    };
  }

  const firstItem = res.resolved?.itemsOut?.[0];
  return {
    success: true,
    humanResponse: res.humanSummary,
    requiresConfirmation: false,
    executionStatus: 'executed',
    dealId: res.dealId,
    contextPatch: {
      lastCustomer: res.resolved?.customer ? { ...res.resolved.customer, type: 'customer' } : undefined,
      lastItem: firstItem ? { ...firstItem, type: 'item' } : undefined,
      lastDealId: res.dealId,
      lastReceivableId: res.resolved?.receivableIds?.[0] ?? null,
      pendingConfirmation: null,
    },
  };
}

async function executeFinancial(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const isPayment = cmd.intent === 'register_payment' || cmd.intent === 'register_partial_payment';
  const isReschedule = cmd.intent === 'update_due_date' || cmd.intent === 'renegotiate_debt';

  if (cmd.intent === 'renegotiate_debt' && !cmd.dueDay && !cmd.firstDueDate) {
    return {
      success: false,
      humanResponse: 'Re-parcelamento ainda não é feito por voz. Por voz eu mudo o vencimento: diga o novo dia.',
      requiresConfirmation: true,
      executionStatus: 'requires_confirmation',
      contextPatch: { pendingConfirmation: null },
    };
  }

  const installmentRef =
    cmd.installmentRef ?? (isReschedule || (isPayment && cmd.paymentScope === 'installment_full') ? 'next' : undefined);

  const target = await resolveFinancialTarget(deps.supabase, deps.userId, context, {
    customer: { id: cmd.resolvedRefs?.customerId, name: cmd.counterparty?.name },
    debtHint: cmd.debtHint,
    receivableId: cmd.resolvedRefs?.receivableId,
    installmentRef,
  });

  if (target.status === 'ambiguous') {
    return askUser(target.promptQuestion, pending('entity_choice', spokenText, target.promptQuestion, cmd, target.field, target.candidates));
  }
  if (target.status === 'not_found') {
    return {
      success: false,
      humanResponse: target.promptQuestion,
      requiresConfirmation: true,
      confirmationPrompt: target.promptQuestion,
      executionStatus: 'requires_confirmation',
      contextPatch: {
        pendingConfirmation: null,
        ...(target.customer ? { lastCustomer: { id: target.customer.id, name: target.customer.name, type: 'customer' as const } } : {}),
      },
    };
  }

  const { customer, debt, installment } = target;
  const contextPatch: ContextPatch = {
    lastCustomer: { id: customer.id, name: customer.name, type: 'customer' },
    lastDealId: debt.dealId,
    lastReceivableId: debt.id,
    pendingConfirmation: null,
  };

  if (isReschedule) {
    const inst = installment ?? debt.installments.find((i) => i.balance > 0 && i.status !== 'paid');
    if (!inst) return { success: false, humanResponse: `${customer.name} não tem parcela em aberto.`, requiresConfirmation: false, executionStatus: 'error', contextPatch };
    const newDueDate = computeNewDueDate(cmd, deps.now ?? new Date());
    if (!newDueDate) return askUser('Para qual dia fica o vencimento?', pending('missing_info', spokenText, 'Para qual dia fica o vencimento?', cmd, 'dueDay'));

    const res = await rescheduleInstallment(deps.supabase, { installmentId: inst.id, newDueDate, source: 'voice', reason: spokenText });
    if (!res.success) return failure(res.error, contextPatch);
    return {
      success: true,
      humanResponse: `Pronto. Parcela ${inst.number}/${inst.totalInstallments} de ${customer.name} (${debt.label}) agora vence em ${formatDate(newDueDate)}.`,
      requiresConfirmation: false,
      executionStatus: 'executed',
      dealId: debt.dealId,
      contextPatch,
    };
  }

  const amount = cmd.amount ?? cmd.adjustmentAmount;
  const settleFull = isPayment && !amount && (cmd.paymentScope === 'debt_full' || cmd.paymentScope === 'installment_full');
  if (!settleFull && (!amount || amount <= 0)) {
    const q = isPayment ? 'Qual foi o valor que você recebeu?' : 'Qual o valor a ser abatido?';
    return askUser(q, pending('missing_info', spokenText, q, cmd, 'amount'));
  }

  // Excesso nunca é absorvido: pergunta antes de gravar
  const limit = installment ? installment.balance : debt.balance;
  if (!settleFull && amount! > limit) {
    const where = installment ? `da parcela ${installment.number}` : `da dívida de ${customer.name} (${debt.label})`;
    const q = `O saldo ${where} é ${brl(limit)}. ${brl(amount!)} passa desse valor. Qual valor devo lançar?`;
    return askUser(q, pending('missing_info', spokenText, q, cmd, 'amount'));
  }

  const res = await applySettlement(deps.supabase, {
    kind: isPayment ? 'payment' : 'adjustment',
    receivableId: debt.id,
    installmentId: installment?.id,
    amount: settleFull ? undefined : amount,
    settleFull,
    paymentMethod: cmd.paymentMethod,
    adjustmentType: isPayment ? undefined : cmd.adjustmentType ?? 'discount',
    reason: isPayment ? `Recebimento por voz: ${spokenText}`.slice(0, 500) : spokenText.slice(0, 500),
    source: 'voice',
  });
  if (!res.success) return failure(res.error, contextPatch);

  return {
    success: true,
    humanResponse: settlementSummary(isPayment, customer.name, debt, installment, res),
    requiresConfirmation: false,
    executionStatus: 'executed',
    dealId: debt.dealId,
    contextPatch,
  };
}

// ------------------------------------------------------------------------------------------------
// Pendências (desambiguação e informação faltante)
// ------------------------------------------------------------------------------------------------

function pending(
  kind: PendingConfirmation['kind'],
  transcript: string,
  prompt: string,
  draft: InterpretedVoiceCommand,
  field?: string,
  candidates?: EntityCandidate[]
): PendingConfirmation {
  return {
    kind,
    originalTranscript: draft.rawText || transcript,
    promptAsked: prompt,
    draft: { ...draft, interpretation: undefined } as unknown as Record<string, unknown>,
    field,
    candidates,
    timestamp: Date.now(),
  };
}

function askUser(prompt: string, pendingConfirmation: PendingConfirmation | null, missing?: string[]): Outcome {
  return {
    success: true,
    humanResponse: prompt,
    requiresConfirmation: true,
    confirmationPrompt: prompt,
    missingInformation: missing,
    executionStatus: 'requires_confirmation',
    contextPatch: { pendingConfirmation },
  };
}

function failure(error: string | undefined, contextPatch: ContextPatch): Outcome {
  return {
    success: false,
    humanResponse: 'Não consegui registrar. Nada foi alterado.',
    requiresConfirmation: false,
    executionStatus: 'error',
    error,
    errorType: 'database',
    contextPatch,
  };
}

const NUMERIC_FIELDS = new Set(['amount', 'totalValue', 'itemInValue', 'dueDay']);

// Palavras que podem acompanhar uma resposta curta ("foi 15 mil", "pro Carlos", "dia 10")
const ANSWER_FILLERS = new Set([
  'foi', 'e', 'era', 'ficou', 'pro', 'pra', 'para', 'por', 'r', 'reais', 'real', 'mil', 'dia', 'uns', 'umas', 'tipo',
  'acho', 'que', 'sim', 'isso', 'na', 'no', 'cliente', 'nome', 'dele', 'dela', 'ele', 'ela', 'valor',
]);
const BUSINESS_VERBS = /^(vend|pass|troq|peg|pag|mand|quit|abat|acert|compr|receb|dei|deu|complet|volt|joga|muda|tira|desconta)/;

/** A fala é só a resposta (número/nome), sem outro comando junto? */
function isBareAnswer(text: string): boolean {
  const rest = nameTokens(text).filter((t) => !ANSWER_FILLERS.has(t) && !/^\d/.test(t) && extractSpokenNumbers(t).length === 0);
  return rest.length === 0;
}
const FIELD_MISSING_TYPES: Record<string, string[]> = {
  amount: ['payment_breakdown', 'deal_total'],
  totalValue: ['deal_total', 'acquisition_cost'],
  itemInValue: ['acquisition_cost'],
  dueDay: ['installment_due_date'],
  customer: ['customer_reference'],
};

function fieldForMissing(cmd: InterpretedVoiceCommand): string | undefined {
  const type = cmd.missingInformation[0]?.type;
  if (!type || cmd.ambiguities.length > 0) return undefined;
  const financial = ['register_payment', 'register_partial_payment', 'register_adjustment'].includes(cmd.intent);
  if ((type === 'deal_total' || type === 'payment_breakdown') && financial) return 'amount';
  if (type === 'deal_total' || type === 'acquisition_cost') return 'totalValue';
  if (type === 'installment_due_date') return 'dueDay';
  if (type === 'customer_reference') return 'customer';
  return undefined;
}

/**
 * Retoma o comando pendente quando a fala é a resposta da pergunta feita:
 * escolha entre candidatos (IDs reais) ou valor numérico/nome que faltava.
 * Qualquer outra fala é tratada como comando novo.
 */
export function resumePending(spokenText: string, p?: PendingConfirmation): InterpretedVoiceCommand | null {
  if (!p?.draft) return null;
  const draft = p.draft as unknown as InterpretedVoiceCommand;
  const refs = { ...(draft.resolvedRefs ?? {}) };

  if (p.kind === 'entity_choice' && p.candidates?.length && p.field) {
    const choice = matchCandidateAnswer(spokenText, p.candidates);
    if (!choice) return null;
    if (p.field === 'customer') refs.customerId = choice.id;
    else if (p.field === 'debt') refs.receivableId = choice.id;
    else if (p.field.startsWith('item:')) refs.itemOutIds = { ...(refs.itemOutIds ?? {}), [Number(p.field.split(':')[1])]: choice.id };
    return { ...draft, resolvedRefs: refs, interpretation: { source: 'resume' } };
  }

  if (p.kind !== 'missing_info' || !p.field) return null;
  const words = spokenText.trim().split(/\s+/);
  if (words.length > 8) return null;

  const filled: InterpretedVoiceCommand = { ...draft, resolvedRefs: refs };
  if (NUMERIC_FIELDS.has(p.field)) {
    if (!isBareAnswer(spokenText)) return null;
    const numbers = extractSpokenNumbers(spokenText).filter((n) => n > 0);
    if (numbers.length !== 1) return null;
    let value = numbers[0];
    if (p.field !== 'dueDay' && value < 100 && !/\b(reais|real|mil)\b/i.test(spokenText) && draftUsesThousands(draft)) {
      value *= 1000;
    }
    (filled as unknown as Record<string, unknown>)[p.field] = value;
    if (p.field === 'amount' && ['register_payment', 'register_partial_payment'].includes(draft.intent)) filled.paymentScope = 'amount';
    if (p.field === 'amount' && draft.intent === 'register_adjustment') filled.adjustmentAmount = value;
  } else if (p.field === 'customer') {
    const tokens = nameTokens(spokenText).filter((t) => !ANSWER_FILLERS.has(t));
    // Nome puro ("Carlos", "pro Carlos Souza"): sem números nem verbos de negócio
    if (tokens.length === 0 || tokens.length > 3 || tokens.some((t) => !/^[a-z]{2,}$/.test(t) || BUSINESS_VERBS.test(t))) return null;
    const name = tokens;
    filled.counterparty = { name: name.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ') };
  } else {
    return null;
  }

  const answered = FIELD_MISSING_TYPES[p.field] ?? [];
  const missingInformation = draft.missingInformation.filter((m) => !answered.includes(m.type));
  const withGaps = { ...filled, missingInformation };
  // Cliente em contexto é tratado adiante pelos resolvedores (que perguntam se não houver)
  const gaps = completenessGaps(withGaps, true);
  const allMissing = [...missingInformation, ...gaps];
  return {
    ...withGaps,
    missingInformation: allMissing,
    requiresConfirmation: allMissing.length > 0 || draft.ambiguities.length > 0,
    confirmationPrompt: allMissing[0]?.promptQuestion ?? draft.ambiguities[0]?.suggestedPrompt,
    interpretation: { source: 'resume' },
  };
}

function draftUsesThousands(d: InterpretedVoiceCommand): boolean {
  return [d.totalValue, d.itemInValue, d.cashIn, d.receivable, d.tradeBalance, d.amount].some((v) => typeof v === 'number' && v >= 1000);
}

// ------------------------------------------------------------------------------------------------
// Datas e respostas
// ------------------------------------------------------------------------------------------------

export function computeNewDueDate(cmd: Pick<InterpretedVoiceCommand, 'dueDay' | 'dueMonthOffset' | 'firstDueDate'>, now: Date): string | null {
  if (cmd.firstDueDate) return cmd.firstDueDate;
  if (!cmd.dueDay) return null;
  const pick = (year: number, month: number) => {
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(cmd.dueDay!, days)));
  };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let date = pick(today.getUTCFullYear(), today.getUTCMonth() + (cmd.dueMonthOffset ?? 0));
  if (!cmd.dueMonthOffset && date <= today) date = pick(today.getUTCFullYear(), today.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function settlementSummary(
  isPayment: boolean,
  customerName: string,
  debt: ResolvedDebt,
  installment: OpenInstallment | undefined,
  res: SettlementResult
): string {
  const total = brl(res.amount ?? 0);
  const balance = res.obligationBalance ?? 0;
  const where =
    res.allocations && res.allocations.length === 1
      ? `na parcela ${res.allocations[0].installmentNumber}/${installment?.totalInstallments ?? debt.installments.length}`
      : `em ${res.allocations?.length ?? 0} parcelas`;

  const head = isPayment
    ? `Pronto. Recebimento de ${total} de ${customerName} ${where} (${debt.label}).`
    : `Pronto. Abatimento de ${total} na dívida de ${customerName} (${debt.label}), sem movimentar caixa.`;
  const tail = balance <= 0 ? ' Dívida quitada.' : ` Saldo da dívida: ${brl(balance)}.`;
  return head + tail;
}
