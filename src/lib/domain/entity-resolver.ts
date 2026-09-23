// src/lib/domain/entity-resolver.ts
// Resolução de Entidades com Detecção Estrita de Homônimos — Fase F do Hardening FigoCRM
// Impede seleção arbitrária via .limit(1) quando existem múltiplos clientes ou mercadorias homônimas.

import { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerResolutionResult {
  status: 'exact_match' | 'multiple_matches' | 'not_found';
  customerId?: string;
  customerName?: string;
  matches?: Array<{ id: string; name: string; phone?: string | null }>;
  promptQuestion?: string;
}

export interface ItemResolutionResult {
  status: 'exact_match' | 'multiple_matches' | 'not_found';
  itemId?: string;
  itemName?: string;
  acquisitionCost?: number;
  matches?: Array<{ id: string; name: string; acquisition_cost: number }>;
  promptQuestion?: string;
}

/**
 * Resolve cliente pelo nome, detectando homônimos no mesmo tenant.
 */
export async function resolveCustomer(
  supabase: SupabaseClient,
  userId: string,
  searchTerm: string
): Promise<CustomerResolutionResult> {
  const cleanTerm = searchTerm.trim();
  if (!cleanTerm) {
    return { status: 'not_found' };
  }

  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('user_id', userId)
    .ilike('name', `%${cleanTerm}%`)
    .limit(10);

  if (error || !customers || customers.length === 0) {
    return {
      status: 'not_found',
      customerName: cleanTerm,
    };
  }

  // Se houver correspondência exata de nome completo
  const exactMatch = customers.find(
    (c) => c.name.toLowerCase() === cleanTerm.toLowerCase()
  );
  if (exactMatch && customers.length === 1) {
    return {
      status: 'exact_match',
      customerId: exactMatch.id,
      customerName: exactMatch.name,
    };
  }

  // Se houver mais de um cliente compatível
  if (customers.length > 1) {
    const names = customers.map((c) => c.name).join(' ou ');
    return {
      status: 'multiple_matches',
      matches: customers,
      promptQuestion: `Encontrei mais de um cliente. Você se refere a ${names}?`,
    };
  }

  // 1 resultado parcial encontrado
  return {
    status: 'exact_match',
    customerId: customers[0].id,
    customerName: customers[0].name,
  };
}

/**
 * Resolve mercadoria pelo nome/referência no estoque disponível, detectando homônimos.
 */
export async function resolveInventoryItem(
  supabase: SupabaseClient,
  userId: string,
  searchTerm: string
): Promise<ItemResolutionResult> {
  const cleanTerm = searchTerm.trim();
  if (!cleanTerm) {
    return { status: 'not_found' };
  }

  const { data: items, error } = await supabase
    .from('items')
    .select('id, name, acquisition_cost, status')
    .eq('user_id', userId)
    .eq('status', 'disponivel')
    .ilike('name', `%${cleanTerm}%`)
    .limit(10);

  if (error || !items || items.length === 0) {
    return {
      status: 'not_found',
      itemName: cleanTerm,
    };
  }

  // Se houver apenas 1 mercadoria correspondente
  if (items.length === 1) {
    return {
      status: 'exact_match',
      itemId: items[0].id,
      itemName: items[0].name,
      acquisitionCost: Number(items[0].acquisition_cost),
    };
  }

  // Se houver mais de 1 mercadoria disponível com a mesma referência (ex: iPhone 13 Preto vs iPhone 13 Azul)
  const names = items.map((i) => i.name).join(' ou ');
  return {
    status: 'multiple_matches',
    matches: items.map((i) => ({ id: i.id, name: i.name, acquisition_cost: Number(i.acquisition_cost) })),
    promptQuestion: `Você tem mais de uma mercadoria parecida no estoque. É ${names}?`,
  };
}
