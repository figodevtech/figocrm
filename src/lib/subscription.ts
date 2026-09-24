// src/lib/subscription.ts
// Billing e entitlements Free/Pro. A fonte de verdade é public.account_entitlements();
// subscription_access() mantém compatibilidade com os triggers financeiros do banco.
//
// FAIL-CLOSED: assinatura ausente, perfil ausente, erro do Supabase ou resposta inesperada ⇒ escrita negada.
// Leitura nunca depende de cobrança (dados do usuário são sempre acessíveis, nunca apagados).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'blocked';
export type EffectivePlan = 'free' | 'pro';

export type AccessReason =
  | 'trial'
  | 'active'
  | 'renewal_pending'
  | 'past_due_grace'
  | 'canceled_until_period_end'
  | 'trial_expired'
  | 'renewal_overdue'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'blocked'
  | 'subscription_missing'
  | 'unauthenticated'
  | 'billing_unavailable';

export interface SubscriptionAccess {
  status: SubscriptionStatus | 'missing' | 'unknown';
  effectiveStatus: SubscriptionStatus | 'missing' | 'unknown';
  effectivePlan: EffectivePlan | null;
  canRead: boolean;
  canWrite: boolean;
  customerCount: number;
  customerLimit: number | null;
  canCreateCustomer: boolean;
  voiceMonthlyLimit: number;
  voiceUsedThisMonth: number;
  voiceRemainingThisMonth: number;
  reason: AccessReason;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  graceUntil?: string;
  cancelAtPeriodEnd: boolean;
  /** Dias restantes do trial (0 fora do trial). */
  trialDaysRemaining: number;
  monthlyFee: string;
}

export const MONTHLY_SUBSCRIPTION_FEE = 'R$ 24,50/mês';
export const TRIAL_DURATION_DAYS = 7;

const WRITE_DENIED_MESSAGES: Partial<Record<AccessReason, string>> = {
  trial_expired: 'Seu teste acabou. Você continua no plano Free; assine o Pro para liberar mais clientes e voz.',
  renewal_overdue: 'Sua cobrança não foi renovada. Você continua usando o plano Free.',
  past_due: 'O pagamento está pendente. Você continua usando o plano Free.',
  canceled: 'Sua assinatura terminou. Você continua usando o plano Free.',
  expired: 'Você continua usando o plano Free.',
  blocked: 'Sua conta está bloqueada para novos registros. Fale com o suporte.',
  subscription_missing: 'Não encontramos sua assinatura. Fale com o suporte para liberar novos registros.',
  unauthenticated: 'Você precisa estar logado.',
  billing_unavailable: 'Não consegui confirmar sua assinatura agora. Tente de novo em instantes.',
};

export class SubscriptionWriteDeniedError extends Error {
  constructor(public readonly reason: AccessReason) {
    super(WRITE_DENIED_MESSAGES[reason] ?? 'Novos registros estão bloqueados para esta conta.');
    this.name = 'SubscriptionWriteDeniedError';
  }
}

function denied(reason: AccessReason): SubscriptionAccess {
  return {
    status: 'unknown',
    effectiveStatus: 'unknown',
    effectivePlan: null,
    canRead: reason !== 'unauthenticated',
    canWrite: false,
    customerCount: 0,
    customerLimit: null,
    canCreateCustomer: false,
    voiceMonthlyLimit: 0,
    voiceUsedThisMonth: 0,
    voiceRemainingThisMonth: 0,
    reason,
    cancelAtPeriodEnd: false,
    trialDaysRemaining: 0,
    monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
  };
}

type AccessRow = {
  status: string;
  effective_status: string;
  effective_plan: string | null;
  can_read: boolean;
  can_write: boolean;
  customer_count: number;
  customer_limit: number | null;
  can_create_customer: boolean;
  voice_monthly_limit: number | null;
  voice_used_this_month: number;
  voice_remaining_this_month: number | null;
  reason: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_until: string | null;
  cancel_at_period_end: boolean | null;
};

/** Interpreta a linha da função SQL; qualquer formato inesperado nega a escrita. */
export function parseAccessRow(data: unknown): SubscriptionAccess {
  const row = (Array.isArray(data) ? data[0] : data) as AccessRow | undefined;
  if (!row || typeof row.can_write !== 'boolean' || typeof row.can_read !== 'boolean'
    || typeof row.reason !== 'string' || typeof row.customer_count !== 'number'
    || typeof row.can_create_customer !== 'boolean'
    || (row.can_write && (row.effective_plan !== 'free' && row.effective_plan !== 'pro'))
    || (row.can_write && (typeof row.voice_monthly_limit !== 'number' || typeof row.voice_remaining_this_month !== 'number'))) {
    return denied('billing_unavailable');
  }

  const trialEnds = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
  const trialDaysRemaining =
    row.effective_status === 'trialing' ? Math.max(0, Math.ceil((trialEnds - Date.now()) / 86_400_000)) : 0;

  return {
    status: row.status as SubscriptionAccess['status'],
    effectiveStatus: row.effective_status as SubscriptionAccess['effectiveStatus'],
    effectivePlan: row.effective_plan === 'free' || row.effective_plan === 'pro' ? row.effective_plan : null,
    canRead: row.can_read,
    canWrite: row.can_write === true,
    customerCount: row.customer_count,
    customerLimit: row.customer_limit,
    canCreateCustomer: row.can_create_customer,
    voiceMonthlyLimit: row.voice_monthly_limit ?? 0,
    voiceUsedThisMonth: row.voice_used_this_month ?? 0,
    voiceRemainingThisMonth: row.voice_remaining_this_month ?? 0,
    reason: row.reason as AccessReason,
    trialEndsAt: row.trial_ends_at ?? undefined,
    currentPeriodEnd: row.current_period_end ?? undefined,
    graceUntil: row.grace_until ?? undefined,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    trialDaysRemaining,
    monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
  };
}

/** Consulta o acesso do usuário da sessão do client (auth.uid()). */
export async function getSubscriptionAccess(client?: SupabaseClient): Promise<SubscriptionAccess> {
  try {
    const supabase = client ?? ((await createClient()) as unknown as SupabaseClient);
    const { data, error } = await supabase.rpc('account_entitlements');
    if (error) {
      console.error('[subscription] falha ao consultar acesso:', error.message);
      return denied('billing_unavailable');
    }
    return parseAccessRow(data);
  } catch (err) {
    console.error('[subscription] erro inesperado:', err);
    return denied('billing_unavailable');
  }
}

/**
 * Garante permissão de escrita. Lança SubscriptionWriteDeniedError em qualquer caso não liberado.
 * O userId é mantido por compatibilidade; o acesso é sempre o do usuário autenticado no client.
 */
export async function assertWritePermission(_userId?: string, client?: SupabaseClient): Promise<SubscriptionAccess> {
  const access = await getSubscriptionAccess(client);
  if (!access.canWrite) throw new SubscriptionWriteDeniedError(access.reason);
  return access;
}

export function writeDeniedMessage(reason: AccessReason): string {
  return new SubscriptionWriteDeniedError(reason).message;
}
