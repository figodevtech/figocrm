// src/app/api/billing/status/route.ts
// Estado da assinatura do usuário logado para a tela de Billing/Conta (CTA de assinatura, dias de trial).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';
import { PAID_PLANS } from '@/lib/billing/types';
import { getBillingProvider } from '@/lib/billing/registry';

export async function GET() {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const access = await getSubscriptionAccess(supabase);
  return NextResponse.json({
    status: access.effectiveStatus,
    canWrite: access.canWrite,
    effectivePlan: access.effectivePlan,
    customerCount: access.customerCount,
    customerLimit: access.customerLimit,
    canCreateCustomer: access.canCreateCustomer,
    voiceMonthlyLimit: access.voiceMonthlyLimit,
    voiceUsedThisMonth: access.voiceUsedThisMonth,
    voiceRemainingThisMonth: access.voiceRemainingThisMonth,
    reason: access.reason,
    message: access.canWrite ? null : writeDeniedMessage(access.reason),
    trialEndsAt: access.trialEndsAt ?? null,
    trialDaysRemaining: access.trialDaysRemaining,
    currentPeriodEnd: access.currentPeriodEnd ?? null,
    graceUntil: access.graceUntil ?? null,
    cancelAtPeriodEnd: access.cancelAtPeriodEnd,
    plans: PAID_PLANS,
    checkoutAvailable: getBillingProvider() !== null,
  });
}
