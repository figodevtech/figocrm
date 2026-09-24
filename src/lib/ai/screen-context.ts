// src/lib/ai/screen-context.ts
// Contexto da tela atual para a voz. Na página do Carlos, "ele pagou 500" já chega com
// customerId = Carlos: a resolução não depende da LLM adivinhar quem é "ele".
// O front só manda IDs; aqui cada ID é conferido contra os dados do próprio usuário (RLS + user_id)
// antes de entrar no contexto. ID inválido ou de outro usuário é ignorado em silêncio.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext } from '@/lib/ai/context_manager';

export interface ScreenContext {
  customerId?: string;
  itemId?: string;
  loanContractId?: string;
  receivableId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita objeto ou JSON; só mantém campos conhecidos com UUID válido. */
export function parseScreenContext(raw: unknown): ScreenContext | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: ScreenContext = {};
  for (const key of ['customerId', 'itemId', 'loanContractId', 'receivableId'] as const) {
    const v = source[key];
    if (typeof v === 'string' && UUID.test(v)) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function applyScreenContext(
  supabase: SupabaseClient,
  userId: string,
  context: ConversationContext,
  screen: ScreenContext | undefined
): Promise<ConversationContext> {
  if (!screen) return context;
  const next: ConversationContext = { ...context };
  const labels: string[] = [];

  if (screen.customerId) {
    const { data } = await supabase.from('customers').select('id, name').eq('id', screen.customerId).eq('user_id', userId).maybeSingle();
    if (data) {
      if (next.lastCustomer?.id !== data.id) {
        // Outra pessoa na tela: dívida/negócio da conversa anterior não valem mais
        next.lastReceivableId = undefined;
        next.lastDealId = undefined;
      }
      next.lastCustomer = { id: data.id, name: data.name, type: 'customer' };
      next.screenCustomerId = data.id;
      labels.push(`cliente ${data.name}`);
    }
  }

  if (screen.loanContractId) {
    const { data } = await supabase
      .from('loan_contracts')
      .select('id, customer_id, customers(name), receivables(id)')
      .eq('id', screen.loanContractId)
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as unknown as { id: string; customer_id: string; customers: { name: string } | null; receivables: Array<{ id: string }> } | null;
    if (row) {
      next.lastCustomer = { id: row.customer_id, name: row.customers?.name ?? 'cliente', type: 'customer' };
      next.screenCustomerId = row.customer_id;
      next.lastReceivableId = row.receivables?.[0]?.id;
      next.lastDealId = undefined;
      labels.splice(0, labels.length, `empréstimo de ${row.customers?.name ?? 'cliente'}`);
    }
  } else if (screen.receivableId) {
    const { data } = await supabase
      .from('receivables')
      .select('id, deal_id, customer_id, customers(name)')
      .eq('id', screen.receivableId)
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as unknown as { id: string; deal_id: string | null; customer_id: string; customers: { name: string } | null } | null;
    if (row) {
      next.lastCustomer = { id: row.customer_id, name: row.customers?.name ?? 'cliente', type: 'customer' };
      next.lastReceivableId = row.id;
      next.lastDealId = row.deal_id ?? undefined;
      labels.splice(0, labels.length, `dívida de ${row.customers?.name ?? 'cliente'}`);
    }
  }

  if (screen.itemId) {
    const { data } = await supabase.from('items').select('id, name').eq('id', screen.itemId).eq('user_id', userId).maybeSingle();
    if (data) {
      next.lastItem = { id: data.id, name: data.name, type: 'item' };
      labels.push(`mercadoria ${data.name}`);
    }
  }

  next.screenLabel = labels.length > 0 ? labels.join(', ') : undefined;
  return next;
}
