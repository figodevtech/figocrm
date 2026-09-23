// src/lib/subscription.ts
// Lógica de Trial de 7 Dias e Assinatura de R$ 24,90/mês (Fase 6)

import { createClient } from '@/lib/supabase/server';
import { SubscriptionStatus } from '@/types/domain';

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  isTrial: boolean;
  daysRemaining: number;
  canPerformWriteOperations: boolean;
  trialEndsAt: string;
  monthlyFee: string;
}

export const MONTHLY_SUBSCRIPTION_FEE = 'R$ 24,90/mês';
export const TRIAL_DURATION_DAYS = 7;

/**
 * Verifica o status da assinatura do usuário no Supabase e se ele possui permissão de escrita.
 */
export async function getSubscriptionInfo(userId?: string): Promise<SubscriptionInfo> {
  const supabase = await createClient();

  let targetUserId = userId;
  if (!targetUserId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        status: 'expired',
        isTrial: false,
        daysRemaining: 0,
        canPerformWriteOperations: false,
        trialEndsAt: new Date().toISOString(),
        monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
      };
    }
    targetUserId = user.id;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status, trial_ends_at')
    .eq('id', targetUserId)
    .single();

  if (!profile) {
    return {
      status: 'trial',
      isTrial: true,
      daysRemaining: TRIAL_DURATION_DAYS,
      canPerformWriteOperations: true,
      trialEndsAt: new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
    };
  }

  const now = new Date();
  const trialEnds = new Date(profile.trial_ends_at);
  const diffTime = trialEnds.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  let effectiveStatus: SubscriptionStatus = profile.subscription_status as SubscriptionStatus;

  // Se o trial expirou e não houve assinatura, muda status operacional para expired
  if (effectiveStatus === 'trial' && diffTime <= 0) {
    effectiveStatus = 'expired';
  }

  // Usuário só pode criar ou alterar dados se for assinante ativo ou estiver no período de trial válido
  const canPerformWriteOperations = effectiveStatus === 'active' || (effectiveStatus === 'trial' && diffTime > 0);

  return {
    status: effectiveStatus,
    isTrial: effectiveStatus === 'trial',
    daysRemaining,
    canPerformWriteOperations,
    trialEndsAt: profile.trial_ends_at,
    monthlyFee: MONTHLY_SUBSCRIPTION_FEE,
  };
}

/**
 * Garante que uma ação de escrita só seja executada se a assinatura/trial for válida.
 * Lança erro ou bloqueia caso o trial tenha expirado.
 */
export async function assertWritePermission(userId?: string): Promise<void> {
  const info = await getSubscriptionInfo(userId);
  if (!info.canPerformWriteOperations) {
    throw new Error('Seu período de teste de 7 dias encerrou. Assine o plano de R$ 24,90/mês para continuar registrando novos negócios.');
  }
}
