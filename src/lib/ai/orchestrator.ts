// src/lib/ai/orchestrator.ts
// Pipeline de voz de produção:
//   texto → interpretação (guardrails → LLM → Zod → grounding) → desambiguação → entity resolution
//   → regras financeiras (builder + balanço) → executor seguro → transação PostgreSQL atômica
//   → audit log → contexto persistente (IDs reais) → resposta curta.
// A LLM interpreta, o backend valida, o banco executa.
//
// runVoicePipeline recebe o cliente Supabase autenticado por injeção: a rota Next e o teste E2E
// executam exatamente o mesmo código. A saída inclui `assistant`, o contrato estável para o front.

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
import { completenessGaps, WRITE_INTENTS } from '@/lib/ai/grounding';
import { executeDealCommand } from '@/lib/domain/command-executor';
import { executeVoiceQuery } from '@/lib/domain/queries';
import { EntityCandidate, matchCandidateAnswer, nameTokens } from '@/lib/domain/entity-resolver';
import {
  resolveFinancialTarget,
  resolveReversalTarget,
  ResolvedDebt,
  OpenInstallment,
} from '@/lib/domain/financial-target-resolver';
import {
  applySettlement,
  planRenegotiation,
  renegotiateInstallments,
  rescheduleInstallment,
  reverseSettlement,
  SettlementResult,
} from '@/lib/domain/financial-operations';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';
import { extractSpokenNumbers } from '@/lib/voice/numbers';
import { toCents } from '@/lib/finance/money';
import { confirmationAnswer } from '@/lib/ai/readback';
import { AssistantErrorCode, AssistantResponse, errorResponse, OperationType } from '@/lib/api/assistant-response';
import { applyScreenContext, ScreenContext } from '@/lib/ai/screen-context';
import { resolveCustomerReference } from '@/lib/domain/entity-resolver';
import { createCustomer } from '@/lib/domain/customers';
import { createLoanContract, CreateLoanInput, planLoan } from '@/lib/domain/loans';
import { uniformInstallment } from '@/lib/finance/loans';

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
  /** Detalhe técnico: só para log/telemetria, nunca enviado ao front. */
  error?: string;
  errorType?: string;
  /** Contrato estável para o front. */
  assistant: AssistantResponse;
  metrics: VoicePipelineMetrics;
}

export interface VoicePipelineDeps {
  supabase: SupabaseClient;
  userId: string;
  interpret?: (spokenText: string, context: ConversationContext) => Promise<InterpretedVoiceCommand>;
  now?: Date;
  /** IDs da tela atual (cliente, mercadoria, empréstimo) — conferidos contra o usuário antes de usar. */
  screen?: ScreenContext;
}

type Outcome = Omit<VoiceProcessResult, 'metrics' | 'intent' | 'assistant'> & {
  contextPatch?: ContextPatch;
  field?: string;
  candidates?: EntityCandidate[];
  operation?: { id?: string; type: OperationType; undoAvailable: boolean };
  errorCode?: AssistantErrorCode;
};

/** R$ sem centavos quando o valor é inteiro: "R$ 1.500", "R$ 1.500,50". */
export function brl(value: number): string {
  const cents = toCents(value);
  const whole = cents % 100 === 0;
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Wrapper para rotas Next: autentica pelo cookie e roda o pipeline. */
export async function processVoiceCommand(spokenText: string): Promise<VoiceProcessResult> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      intent: 'unauthenticated',
      humanResponse: 'Você precisa estar logado.',
      requiresConfirmation: false,
      executionStatus: 'error',
      errorType: 'auth',
      assistant: errorResponse('unauthenticated', 'Você precisa estar logado.'),
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
  context = await applyScreenContext(supabase, userId, context, deps.screen);

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
      humanResponse: 'Deu um erro aqui e nada foi gravado. Tenta de novo?',
      requiresConfirmation: false,
      executionStatus: 'error',
      error: err instanceof Error ? err.message : String(err),
      errorType: 'exception',
      errorCode: 'internal',
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

  const { contextPatch: _patch, field: _field, candidates: _candidates, operation: _operation, errorCode: _code, ...result } = outcome;
  void _patch; void _field; void _candidates; void _operation; void _code;
  return {
    ...result,
    intent: interpreted.intent,
    assistant: toAssistantResponse(outcome, interpreted.interpretation?.fallbackReason),
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

/** Corpo HTTP: contrato do front + intenção e métricas; nunca o erro técnico. */
export function toHttpPayload(result: VoiceProcessResult) {
  return { assistant: result.assistant, intent: result.intent, metrics: result.metrics };
}

function toAssistantResponse(o: Outcome, fallbackReason?: string): AssistantResponse {
  switch (o.executionStatus) {
    case 'executed':
      return {
        status: 'executed',
        message: o.humanResponse,
        undoAvailable: o.operation?.undoAvailable ?? false,
        operationId: o.operation?.id,
        operationType: o.operation?.type,
        dealId: o.dealId,
      };
    case 'answered':
      return { status: 'answered', message: o.humanResponse };
    case 'requires_confirmation':
      return {
        status: 'needs_input',
        message: o.humanResponse,
        field: o.field,
        candidates: o.candidates?.map((c) => ({ id: c.id, label: c.name, detail: c.detail })),
      };
    default:
      return errorResponse(o.errorCode ?? (fallbackReason === 'not_configured' ? 'provider_unavailable' : 'internal'), o.humanResponse);
  }
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
  // Escrita exige assinatura válida (o banco também bloqueia); consulta nunca é bloqueada
  if (WRITE_INTENTS.has(cmd.intent)) {
    const access = await getSubscriptionAccess(deps.supabase);
    if (!access.canWrite) {
      const message = writeDeniedMessage(access.reason);
      return {
        success: false,
        humanResponse: message,
        requiresConfirmation: false,
        executionStatus: 'error',
        errorType: 'subscription',
        errorCode: 'subscription_required',
        contextPatch: { pendingConfirmation: null },
      };
    }
  }

  if (cmd.needsReadback) {
    const prompt = cmd.confirmationPrompt || 'Confirma?';
    const confirmed: InterpretedVoiceCommand = { ...cmd, needsReadback: false, requiresConfirmation: false, confirmationPrompt: undefined };
    return askUser(prompt, { ...pending('confirm_execution', spokenText, prompt, confirmed), field: 'confirmation' });
  }

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
    case 'create_loan':
      return executeLoan(cmd, spokenText, context, deps);
    case 'register_payment':
    case 'register_partial_payment':
    case 'register_adjustment':
    case 'update_due_date':
      return executeFinancial(cmd, spokenText, context, deps);
    case 'renegotiate_debt':
      return cmd.installmentsCount || cmd.installmentAmount
        ? executeRenegotiation(cmd, spokenText, context, deps)
        : cmd.dueDay || cmd.firstDueDate
          ? executeFinancial(cmd, spokenText, context, deps)
          : askUser('Como fica o novo parcelamento? Em quantas parcelas?', pending('missing_info', spokenText, 'Como fica o novo parcelamento? Em quantas parcelas?', cmd, 'installmentsCount'));
    case 'reverse_operation':
      return executeReversal(cmd, spokenText, context, deps);
    default:
      return askUser('Não entendi. Você vendeu, trocou ou recebeu algum valor?', null);
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
    return askUser(res.responseSummary, pending('entity_choice', spokenText, res.responseSummary, cmd, 'customer', res.pendingChoice.candidates), undefined, res.pendingChoice.candidates);
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
    return askUser(res.humanSummary, pending('entity_choice', spokenText, res.humanSummary, cmd, field, res.pendingChoice.candidates), undefined, res.pendingChoice.candidates);
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
      errorCode: res.errorType === 'subscription' ? 'subscription_required' : res.errorType === 'resolution' ? 'not_found' : 'internal',
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
    operation: { id: res.dealId, type: 'deal', undoAvailable: false },
    contextPatch: {
      lastCustomer: res.resolved?.customer ? { ...res.resolved.customer, type: 'customer' } : undefined,
      lastItem: firstItem ? { ...firstItem, type: 'item' } : undefined,
      lastDealId: res.dealId,
      lastReceivableId: res.resolved?.receivableIds?.[0] ?? null,
      pendingConfirmation: null,
    },
  };
}

const LOAN_METHODS: Record<string, CreateLoanInput['paymentMethod']> = { pix: 'pix', cash: 'cash', bank_transfer: 'bank_transfer', card: 'credit_card', other: 'other' };

/** "Emprestei 2 mil pro Carlos em 5 de 500": mesmo domínio do formulário (planLoan → create_loan_contract). */
async function executeLoan(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const principal = cmd.amount;
  const count = cmd.installmentsCount;
  if (!principal) return askUser('Quanto você emprestou?', pending('missing_info', spokenText, 'Quanto você emprestou?', cmd, 'amount'));
  if (!count) return askUser('Em quantas parcelas ele vai te pagar?', pending('missing_info', spokenText, 'Em quantas parcelas ele vai te pagar?', cmd, 'installmentsCount'));

  const base = {
    principal,
    installmentsCount: count,
    dueDay: cmd.dueDay,
    firstDueDate: cmd.firstDueDate,
    paymentMethod: cmd.paymentMethod ? LOAN_METHODS[cmd.paymentMethod] : undefined,
    notes: spokenText.slice(0, 500),
  };
  let terms: Omit<CreateLoanInput, 'customerId' | 'source'>;
  if (cmd.interestType === 'none') terms = { ...base, interestType: 'fixed_amount', interestAmount: 0 };
  else if (cmd.interestType === 'fixed_amount' && cmd.interestAmount !== undefined) terms = { ...base, interestType: 'fixed_amount', interestAmount: cmd.interestAmount };
  else if ((cmd.interestType === 'percent_total' || cmd.interestType === 'percent_monthly') && cmd.interestRate !== undefined) {
    terms = { ...base, interestType: cmd.interestType, interestRate: cmd.interestRate };
  } else if (cmd.installmentAmount !== undefined) terms = { ...base, interestType: 'fixed_amount', installmentAmount: cmd.installmentAmount };
  else {
    const q = 'Vai ter juros? Me diga a porcentagem ou o valor dos juros.';
    return askUser(q, pending('missing_info', spokenText, q, cmd));
  }

  const plan = planLoan(terms, deps.now);
  if (!plan.ok) {
    const q = `${plan.error} Como fica o empréstimo?`;
    return askUser(q, pending('missing_info', spokenText, q, cmd));
  }
  const each = uniformInstallment(plan.terms.installmentCents);
  // Juros E valor da parcela ditos: a conta precisa fechar, senão pergunta (nunca escolhe um dos dois)
  if (cmd.installmentAmount !== undefined && terms.installmentAmount === undefined && each !== toCents(cmd.installmentAmount)) {
    const shown = (each ?? plan.terms.installmentCents[0]) / 100;
    const q =
      `Com esses juros o total fica ${brl(plan.terms.totalCents / 100)}, ${count} de ${brl(shown)}. ` +
      `Você falou ${count} de ${brl(cmd.installmentAmount)}. Qual está certo?`;
    return askUser(q, pending('missing_info', spokenText, q, cmd));
  }

  const custRes = await resolveCustomerReference(deps.supabase, deps.userId, {
    id: cmd.resolvedRefs?.customerId,
    name: cmd.counterparty?.name,
    context: context.lastCustomer,
  });
  if (custRes.status === 'ambiguous') {
    return askUser(custRes.promptQuestion!, pending('entity_choice', spokenText, custRes.promptQuestion!, cmd, 'customer', custRes.candidates), undefined, custRes.candidates);
  }
  let customer = custRes.entity ? { id: custRes.entity.id, name: custRes.entity.name } : undefined;
  if (!customer) {
    if (!cmd.counterparty?.name || cmd.resolvedRefs?.customerId) {
      return askUser('Pra quem você emprestou?', pending('missing_info', spokenText, 'Pra quem você emprestou?', cmd, 'customer'));
    }
    // Nome novo: cadastra só depois que valores e juros já foram validados
    const created = await createCustomer(deps.supabase, deps.userId, { name: cmd.counterparty.name }, { allowDuplicate: true });
    if (!created.ok) return failure(created.error, { pendingConfirmation: null });
    customer = { id: created.customer.id, name: created.customer.name };
  }

  const res = await createLoanContract(deps.supabase, { ...terms, customerId: customer.id, source: 'voice' }, deps.now);
  if (!res.success || !res.plan) return failure(res.error, { pendingConfirmation: null, lastCustomer: { ...customer, type: 'customer' } });

  const t = res.plan.terms;
  const first = res.plan.schedule[0];
  const eachCents = uniformInstallment(t.installmentCents);
  const interestText = t.interestCents > 0 ? ` (${brl(t.interestCents / 100)} de juros)` : ', sem juros';
  const scheduleText = eachCents !== null ? `x de ${brl(eachCents / 100)}` : ' parcelas';
  return {
    success: true,
    humanResponse:
      `Pronto. Emprestei ${brl(t.principalCents / 100)} pro ${customer.name}. ` +
      `Volta ${brl(t.totalCents / 100)}${interestText} em ${t.installmentsCount}${scheduleText}. A primeira vence em ${formatDate(first.dueDate)}.`,
    requiresConfirmation: false,
    executionStatus: 'executed',
    operation: { id: res.loanContractId, type: 'loan', undoAvailable: false },
    contextPatch: {
      lastCustomer: { ...customer, type: 'customer' },
      lastReceivableId: res.receivableId ?? null,
      lastDealId: null,
      pendingConfirmation: null,
    },
  };
}

type ResolvedTarget = Extract<Awaited<ReturnType<typeof resolveFinancialTarget>>, { status: 'resolved' }>;

/** Resolve cliente → dívida (→ parcela); devolve Outcome de pergunta quando não resolve. */
async function resolveDebtOrAsk(
  cmd: InterpretedVoiceCommand,
  spokenText: string,
  context: ConversationContext,
  deps: VoicePipelineDeps,
  installmentRef: Parameters<typeof resolveFinancialTarget>[3]['installmentRef']
): Promise<{ target: ResolvedTarget } | { outcome: Outcome }> {
  const target = await resolveFinancialTarget(deps.supabase, deps.userId, context, {
    customer: { id: cmd.resolvedRefs?.customerId, name: cmd.counterparty?.name },
    debtHint: cmd.debtHint,
    receivableId: cmd.resolvedRefs?.receivableId,
    installmentRef,
  });

  if (target.status === 'ambiguous') {
    return { outcome: askUser(target.promptQuestion, pending('entity_choice', spokenText, target.promptQuestion, cmd, target.field, target.candidates), undefined, target.candidates) };
  }
  if (target.status === 'not_found') {
    return {
      outcome: {
        success: false,
        humanResponse: target.promptQuestion,
        requiresConfirmation: true,
        confirmationPrompt: target.promptQuestion,
        executionStatus: 'requires_confirmation',
        contextPatch: {
          pendingConfirmation: null,
          ...(target.customer ? { lastCustomer: { id: target.customer.id, name: target.customer.name, type: 'customer' as const } } : {}),
        },
      },
    };
  }
  return { target };
}

function debtContext(target: ResolvedTarget): ContextPatch {
  return {
    lastCustomer: { id: target.customer.id, name: target.customer.name, type: 'customer' },
    lastDealId: target.debt.dealId,
    lastReceivableId: target.debt.id,
    pendingConfirmation: null,
  };
}

async function executeFinancial(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const isPayment = cmd.intent === 'register_payment' || cmd.intent === 'register_partial_payment';
  const isReschedule = cmd.intent === 'update_due_date' || cmd.intent === 'renegotiate_debt';

  const installmentRef =
    cmd.installmentRef ?? (isReschedule || (isPayment && cmd.paymentScope === 'installment_full') ? 'next' : undefined);

  const resolved = await resolveDebtOrAsk(cmd, spokenText, context, deps, installmentRef);
  if ('outcome' in resolved) return resolved.outcome;
  const { target } = resolved;
  const { customer, debt, installment } = target;
  const contextPatch = debtContext(target);

  if (isReschedule) {
    const inst = installment ?? debt.installments.find((i) => i.balance > 0 && i.status !== 'paid');
    if (!inst) return { success: false, humanResponse: `${customer.name} não tem parcela em aberto.`, requiresConfirmation: false, executionStatus: 'error', errorCode: 'not_found', contextPatch };
    const newDueDate = computeNewDueDate(cmd, deps.now ?? new Date());
    if (!newDueDate) return askUser('Pra qual dia fica o vencimento?', pending('missing_info', spokenText, 'Pra qual dia fica o vencimento?', cmd, 'dueDay'));

    const res = await rescheduleInstallment(deps.supabase, { installmentId: inst.id, newDueDate, source: 'voice', reason: spokenText });
    if (!res.success) return failure(res.error, contextPatch);
    return {
      success: true,
      humanResponse: `Pronto. A parcela ${inst.number} do ${customer.name} agora vence em ${formatDate(newDueDate)}.`,
      requiresConfirmation: false,
      executionStatus: 'executed',
      dealId: debt.dealId ?? undefined,
      operation: { id: inst.id, type: 'reschedule', undoAvailable: false },
      contextPatch,
    };
  }

  const amount = cmd.amount ?? cmd.adjustmentAmount;
  const settleFull = isPayment && !amount && (cmd.paymentScope === 'debt_full' || cmd.paymentScope === 'installment_full');
  if (!settleFull && (!amount || amount <= 0)) {
    const q = isPayment ? 'Quanto ele pagou?' : 'Quanto é pra abater?';
    return askUser(q, pending('missing_info', spokenText, q, cmd, 'amount'));
  }

  // Excesso nunca é absorvido: pergunta antes de gravar
  const limit = installment ? installment.balance : debt.balance;
  if (!settleFull && amount! > limit) {
    const where = installment ? `da parcela ${installment.number}` : `da dívida do ${customer.name} (${debt.label})`;
    const q = `O saldo ${where} é ${brl(limit)}. ${brl(amount!)} passa disso. Qual valor eu lanço?`;
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
    dealId: debt.dealId ?? undefined,
    operation: { id: res.settlementId, type: isPayment ? 'payment' : 'adjustment', undoAvailable: !!res.settlementId },
    contextPatch,
  };
}

async function executeRenegotiation(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const resolved = await resolveDebtOrAsk(cmd, spokenText, context, deps, undefined);
  if ('outcome' in resolved) return resolved.outcome;
  const { target } = resolved;
  const { customer, debt } = target;
  const contextPatch = debtContext(target);

  const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const open = debt.installments.filter((i) => i.balance > 0 && !['paid', 'canceled', 'renegotiated'].includes(i.status));
  const selected =
    cmd.renegotiationScope === 'overdue'
      ? open.filter((i) => i.dueDate < today)
      : cmd.renegotiationScope === 'listed' && cmd.installmentNumbers?.length
        ? open.filter((i) => cmd.installmentNumbers!.includes(i.number))
        : open;

  if (selected.length === 0) {
    const msg = cmd.renegotiationScope === 'overdue' ? `${customer.name} não tem parcela atrasada nessa dívida.` : `${customer.name} não tem parcela em aberto pra renegociar.`;
    return { success: false, humanResponse: msg, requiresConfirmation: true, executionStatus: 'requires_confirmation', contextPatch };
  }
  if (cmd.renegotiationScope === 'listed' && selected.length !== cmd.installmentNumbers?.length) {
    const q = 'Alguma dessas parcelas já foi paga ou não existe. Quais parcelas eu junto?';
    return askUser(q, pending('missing_info', spokenText, q, cmd));
  }

  const totalCents = selected.reduce((acc, i) => acc + toCents(i.balance), 0);
  const plan = planRenegotiation(totalCents, cmd.installmentsCount, cmd.installmentAmount !== undefined ? toCents(cmd.installmentAmount) : undefined);
  if (!plan.ok) {
    const total = brl(totalCents / 100);
    const q =
      plan.reason === 'mismatch'
        ? `As parcelas somam ${total}. ${cmd.installmentsCount} de ${brl(cmd.installmentAmount!)} dá ${brl(cmd.installmentsCount! * cmd.installmentAmount!)}. Como fica?`
        : plan.reason === 'not_divisible'
          ? `As parcelas somam ${total}, que não divide em parcelas de ${brl(cmd.installmentAmount!)}. Em quantas vezes fica?`
          : `As parcelas somam ${total}. Em quantas vezes fica?`;
    return askUser(q, pending('missing_info', spokenText, q, cmd, plan.reason === 'mismatch' ? undefined : 'installmentsCount'));
  }

  const res = await renegotiateInstallments(deps.supabase, {
    receivableId: debt.id,
    installmentIds: selected.map((i) => i.id),
    newCount: plan.count,
    newInstallmentAmount: plan.amountCents !== undefined ? plan.amountCents / 100 : undefined,
    dueDay: cmd.dueDay,
    firstDueDate: cmd.firstDueDate,
    reason: spokenText.slice(0, 500),
    source: 'voice',
  });
  if (!res.success) return failure(res.error, contextPatch);

  const first = res.newInstallments?.[0];
  const each = first ? brl(first.amount) : '';
  const allSame = res.newInstallments?.every((i) => i.amount === first?.amount);
  return {
    success: true,
    humanResponse:
      `Pronto. Juntei ${selected.length === 1 ? '1 parcela' : `${selected.length} parcelas`} do ${customer.name} (${brl(res.renegotiatedAmount ?? 0)}) ` +
      `em ${plan.count}${allSame ? ` de ${each}` : ' parcelas'}${cmd.dueDay ? `, todo dia ${cmd.dueDay}` : ''}. ` +
      `A primeira vence em ${first ? formatDate(first.dueDate) : '-'}.`,
    requiresConfirmation: false,
    executionStatus: 'executed',
    dealId: debt.dealId ?? undefined,
    operation: { id: res.renegotiationId, type: 'renegotiation', undoAvailable: false },
    contextPatch,
  };
}

async function executeReversal(cmd: InterpretedVoiceCommand, spokenText: string, context: ConversationContext, deps: VoicePipelineDeps): Promise<Outcome> {
  const target = await resolveReversalTarget(deps.supabase, deps.userId, context, {
    customer: { id: cmd.resolvedRefs?.customerId, name: cmd.counterparty?.name },
    amount: cmd.amount,
    kind: cmd.operationKind,
    settlementId: cmd.resolvedRefs?.settlementId,
  });

  if (target.status === 'ambiguous') {
    return askUser(target.promptQuestion, pending('entity_choice', spokenText, target.promptQuestion, cmd, target.field, target.candidates), undefined, target.candidates);
  }
  if (target.status === 'not_found') {
    return {
      success: false,
      humanResponse: target.promptQuestion,
      requiresConfirmation: true,
      executionStatus: 'requires_confirmation',
      contextPatch: { pendingConfirmation: null },
    };
  }

  return reverseAndDescribe(deps.supabase, target.settlement.id, target.customer.name, spokenText, 'voice', {
    lastCustomer: { id: target.customer.id, name: target.customer.name, type: 'customer' },
    ...(target.settlement.receivableId ? { lastReceivableId: target.settlement.receivableId } : {}),
    pendingConfirmation: null,
  });
}

/** Estorna uma operação e monta a resposta — usado pela voz e pelo botão "desfazer". */
export async function reverseAndDescribe(
  supabase: SupabaseClient,
  settlementId: string,
  customerName: string | undefined,
  reason: string,
  source: 'voice' | 'manual',
  contextPatch?: ContextPatch
): Promise<Outcome> {
  const res = await reverseSettlement(supabase, { settlementId, reason: reason.slice(0, 500), source });
  if (!res.success) {
    if (res.installmentReplaced) {
      return {
        success: false,
        humanResponse: 'Não dá pra desfazer: essas parcelas foram renegociadas depois.',
        requiresConfirmation: false,
        executionStatus: 'error',
        errorCode: 'validation',
        error: res.error,
        contextPatch,
      };
    }
    return failure(res.error, contextPatch ?? {});
  }

  const what = res.kind === 'adjustment' ? 'o abatimento' : 'o pagamento';
  const who = customerName ? ` do ${customerName}` : '';
  if (res.alreadyReversed) {
    return {
      success: true,
      humanResponse: `Esse ${res.kind === 'adjustment' ? 'abatimento' : 'pagamento'} de ${brl(res.amount ?? 0)}${who} já tinha sido desfeito.`,
      requiresConfirmation: false,
      executionStatus: 'executed',
      operation: { id: res.reversalSettlementId, type: 'reversal', undoAvailable: false },
      contextPatch,
    };
  }
  return {
    success: true,
    humanResponse: `Pronto. Desfiz ${what} de ${brl(res.amount ?? 0)}${who}. A dívida voltou pra ${brl(res.obligationBalance ?? 0)}.`,
    requiresConfirmation: false,
    executionStatus: 'executed',
    operation: { id: res.reversalSettlementId, type: 'reversal', undoAvailable: false },
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

function askUser(prompt: string, pendingConfirmation: PendingConfirmation | null, missing?: string[], candidates?: EntityCandidate[]): Outcome {
  return {
    success: true,
    humanResponse: prompt,
    requiresConfirmation: true,
    confirmationPrompt: prompt,
    missingInformation: missing,
    executionStatus: 'requires_confirmation',
    field: pendingConfirmation?.field,
    candidates,
    contextPatch: { pendingConfirmation },
  };
}

function failure(error: string | undefined, contextPatch: ContextPatch): Outcome {
  const subscription = error?.includes('Assinatura inativa');
  return {
    success: false,
    humanResponse: subscription ? writeDeniedMessage('expired') : 'Não consegui registrar. Nada foi alterado.',
    requiresConfirmation: false,
    executionStatus: 'error',
    error,
    errorType: subscription ? 'subscription' : 'database',
    errorCode: subscription ? 'subscription_required' : 'internal',
    contextPatch,
  };
}

const NUMERIC_FIELDS = new Set(['amount', 'totalValue', 'itemInValue', 'dueDay', 'installmentsCount']);
// Campos que são contagem/dia, nunca valor em milhares
const COUNT_FIELDS = new Set(['dueDay', 'installmentsCount']);

// Palavras que podem acompanhar uma resposta curta ("foi 15 mil", "pro Carlos", "dia 10")
const ANSWER_FILLERS = new Set([
  'foi', 'e', 'era', 'ficou', 'pro', 'pra', 'para', 'por', 'r', 'reais', 'real', 'mil', 'dia', 'uns', 'umas', 'tipo',
  'acho', 'que', 'sim', 'isso', 'na', 'no', 'cliente', 'nome', 'dele', 'dela', 'ele', 'ela', 'valor', 'vezes', 'parcelas', 'em',
]);
const BUSINESS_VERBS = /^(vend|pass|troq|peg|pag|mand|quit|abat|acert|compr|receb|dei|deu|complet|volt|joga|muda|tira|desconta|desfaz|estorn|junta)/;

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
  installmentsCount: ['installments_count'],
  customer: ['customer_reference'],
};

function fieldForMissing(cmd: InterpretedVoiceCommand): string | undefined {
  const type = cmd.missingInformation[0]?.type;
  if (!type || cmd.ambiguities.length > 0) return undefined;
  const financial = ['register_payment', 'register_partial_payment', 'register_adjustment', 'create_loan'].includes(cmd.intent);
  if ((type === 'deal_total' || type === 'payment_breakdown') && financial) return 'amount';
  if (type === 'deal_total' || type === 'acquisition_cost') return 'totalValue';
  if (type === 'installment_due_date') return 'dueDay';
  if (type === 'installments_count') return 'installmentsCount';
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

  if (p.kind === 'confirm_execution') {
    const answer = confirmationAnswer(spokenText);
    if (answer === 'yes') return { ...draft, interpretation: { source: 'resume' } };
    if (answer === 'no') {
      return {
        intent: 'unrecognized_command',
        requiresConfirmation: true,
        confirmationPrompt: 'Beleza, não lancei nada. Pode falar de novo?',
        missingInformation: [],
        ambiguities: [],
        interpretation: { source: 'resume' },
        rawText: spokenText,
        normalizedText: spokenText,
      };
    }
    return null;
  }

  if (p.kind === 'entity_choice' && p.candidates?.length && p.field) {
    const choice = matchCandidateAnswer(spokenText, p.candidates);
    if (!choice) return null;
    if (p.field === 'customer') refs.customerId = choice.id;
    else if (p.field === 'debt') refs.receivableId = choice.id;
    else if (p.field === 'settlement') refs.settlementId = choice.id;
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
    if (!COUNT_FIELDS.has(p.field) && value < 100 && !/\b(reais|real|mil)\b/i.test(spokenText) && draftUsesThousands(draft)) {
      value *= 1000;
    }
    (filled as unknown as Record<string, unknown>)[p.field] = value;
    if (p.field === 'amount' && ['register_payment', 'register_partial_payment'].includes(draft.intent)) filled.paymentScope = 'amount';
    if (p.field === 'amount' && draft.intent === 'register_adjustment') filled.adjustmentAmount = value;
  } else if (p.field === 'customer') {
    const tokens = nameTokens(spokenText).filter((t) => !ANSWER_FILLERS.has(t));
    // Nome puro ("Carlos", "pro Carlos Souza"): sem números nem verbos de negócio
    if (tokens.length === 0 || tokens.length > 3 || tokens.some((t) => !/^[a-z]{2,}$/.test(t) || BUSINESS_VERBS.test(t))) return null;
    filled.counterparty = { name: tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ') };
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
  return `${d}/${m}`.concat(y && Number(y) !== new Date().getUTCFullYear() ? `/${y}` : '');
}

/** Resposta curta para quem está no meio de uma venda: o que foi feito e quanto falta. */
function settlementSummary(
  isPayment: boolean,
  customerName: string,
  debt: ResolvedDebt,
  installment: OpenInstallment | undefined,
  res: SettlementResult
): string {
  const total = brl(res.amount ?? 0);
  const debtBalance = res.obligationBalance ?? 0;
  const single = res.allocations && res.allocations.length === 1 ? res.allocations[0] : undefined;

  const head = isPayment ? `Pronto. Registrei ${total} do ${customerName}.` : `Pronto. Abati ${total} da dívida do ${customerName}, sem mexer no caixa.`;
  if (debtBalance <= 0) return `${head} Dívida quitada.`;
  if (single && (installment || single.balanceAfter > 0)) {
    return single.balanceAfter > 0
      ? `${head} Ainda faltam ${brl(single.balanceAfter)} nessa parcela.`
      : `${head} Parcela ${single.installmentNumber} quitada. Falta ${brl(debtBalance)} no total.`;
  }
  return `${head} Falta ${brl(debtBalance)} no total${debt.label ? ` (${debt.label})` : ''}.`;
}
