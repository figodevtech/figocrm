// src/lib/subscription.ts
// Acesso por assinatura — 1 plano (R$ 24,90/mês), 7 dias grátis.
// A regra vive em uma única função SQL (public.subscription_access) e é aplicada também no banco por
// trigger em todas as tabelas de negócio. Aqui só a consultamos para mensagens e bloqueio antecipado.
//
// FAIL-CLOSED: assinatura ausente, perfil ausente, erro do Supabase ou resposta inesperada ⇒ escrita negada.
// Leitura nunca depende de cobrança (dados do usuário são sempre acessíveis, nunca apagados).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'blocked';

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
  canRead: boolean;
  canWrite: boolean;
  reason: AccessReason;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  graceUntil?: string;
  cancelAtPeriodEnd: boolean;
  /** Dias restantes do trial (0 fora do trial). */
  trialDaysRemaining: number;
  monthlyFee: string;
}

export const MONTHLY_SUBSCRIPTION_FEE = 'R$ 24,90/mês';
export const TRIAL_DURATION_DAYS = 7;

const WRITE_DENIED_MESSAGES: Partial<Record<AccessReason, string>> = {
  trial_expired: 'Seu teste grátis de 7 dias acabou. Assine por R$ 24,90/mês para continuar registrando. Seus dados continuam aqui.',
  renewal_overdue: 'Sua assinatura não foi renovada. Regularize para continuar registrando. Seus dados continuam aqui.',
  past_due: 'O pagamento da assinatura está pendente. Regularize para continuar registrando. Seus dados continuam aqui.',
  canceled: 'Sua assinatura foi cancelada. Reative para continuar registrando. Seus dados continuam aqui.',
  expired: 'Sua assinatura expirou. Assine para continuar registrando. Seus dados continuam aqui.',
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
    canRead: reason !== 'unauthenticated',
    canWrite: false,
    reason,
    cancelAtPeriodEnd: false,
    trialDaysRemaining: 0,
    monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
  };
}

type AccessRow = {
  status: string;
  effective_status: string;
  can_write: boolean;
  reason: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_until: string | null;
  cancel_at_period_end: boolean | null;
};

/** Interpreta a linha da função SQL; qualquer formato inesperado nega a escrita. */
export function parseAccessRow(data: unknown): SubscriptionAccess {
  const row = (Array.isArray(data) ? data[0] : data) as AccessRow | undefined;
  if (!row || typeof row.can_write !== 'boolean' || typeof row.reason !== 'string') {
    return denied('billing_unavailable');
  }

  const trialEnds = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
  const trialDaysRemaining =
    row.effective_status === 'trialing' ? Math.max(0, Math.ceil((trialEnds - Date.now()) / 86_400_000)) : 0;

  return {
    status: row.status as SubscriptionAccess['status'],
    effectiveStatus: row.effective_status as SubscriptionAccess['effectiveStatus'],
    canRead: row.reason !== 'unauthenticated',
    canWrite: row.can_write === true,
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
    const { data, error } = await supabase.rpc('subscription_access');
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
