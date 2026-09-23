// src/app/actions/deals.ts
// Ações manuais (formulário) de venda e troca.
// Executam o MESMO domínio da voz: formulário → DealCommand → validação → executeDealCommand → RPC
// atômica execute_deal_transaction. Mesmas regras de balanço, CMV, parcelamento, idempotência e auditoria.
'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { executeDealCommand } from '@/lib/domain/command-executor';
import { buildManualSaleCommand, buildManualTradeCommand, CreateSaleInput, CreateTradeInput } from '@/lib/domain/manual-deal-commands';

export type { CreateSaleInput, CreateTradeInput } from '@/lib/domain/manual-deal-commands';

type DealActionResult = { dealId?: string; error?: string; alreadyExecuted?: boolean };

async function runManualDeal(build: () => ReturnType<typeof buildManualSaleCommand>): Promise<DealActionResult> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Usuário não autenticado.' };

  const built = build();
  if (!built.ok) return { error: built.error };

  const res = await executeDealCommand(built.command, { supabase, userId: user.id, source: 'MANUAL_WEB' });
  if (!res.success) return { error: res.confirmationPrompt || res.humanSummary };
  return { dealId: res.dealId, alreadyExecuted: res.alreadyExecuted };
}

export async function createSaleAction(input: CreateSaleInput): Promise<DealActionResult> {
  return runManualDeal(() => buildManualSaleCommand(input));
}

export async function createTradeAction(input: CreateTradeInput): Promise<DealActionResult> {
  return runManualDeal(() => buildManualTradeCommand(input));
}
