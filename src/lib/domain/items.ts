// src/lib/domain/items.ts
// Cadastro/edição de mercadorias e custos agregados. O custo total (CMV) é sempre
// compra + custos agregados (motor de CMV existente); a venda baixa o item pela RPC de negócio.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';
import { calculateItemCMVCents } from '@/lib/finance/cmv';
import { toCents, toReais } from '@/lib/finance/money';
import { COST_CATEGORIES } from '@/lib/domain/views';

export interface ItemCostInput {
  category: string;
  description?: string | null;
  amount: number;
}

export interface ItemInput {
  name: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  identifier?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  plate?: string | null;
  modelYear?: number | null;
  acquisitionCost: number;
  targetSalePrice?: number | null;
  description?: string | null;
  photoPath?: string | null;
}

/** Status que o usuário escolhe na mão; vendido/recebido em troca vêm dos negócios. */
export const EDITABLE_ITEM_STATUSES = ['disponivel', 'reservado'] as const;
export type EditableItemStatus = (typeof EDITABLE_ITEM_STATUSES)[number];

const clean = (v: string | null | undefined, max: number) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

export function validateItemInput(input: ItemInput) {
  const name = clean(input.name, 160);
  if (!name) return { ok: false as const, error: 'Informe o nome ou a descrição da mercadoria.' };
  if (!(input.acquisitionCost >= 0) || !Number.isFinite(input.acquisitionCost)) {
    return { ok: false as const, error: 'Informe o valor de compra.' };
  }
  if (input.targetSalePrice !== null && input.targetSalePrice !== undefined && !(input.targetSalePrice >= 0)) {
    return { ok: false as const, error: 'Preço de venda inválido.' };
  }
  const year = input.modelYear ?? null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    return { ok: false as const, error: 'Ano inválido.' };
  }
  const imei = clean(input.imei, 20);
  if (imei && !/^\d{14,16}$/.test(imei.replace(/\D/g, ''))) return { ok: false as const, error: 'IMEI deve ter 15 dígitos.' };
  const photo = clean(input.photoPath, 300);
  return {
    ok: true as const,
    data: {
      name,
      category: clean(input.category, 60),
      brand: clean(input.brand, 60),
      model: clean(input.model, 80),
      identifier: clean(input.identifier, 80),
      imei: imei ? imei.replace(/\D/g, '') : null,
      serial_number: clean(input.serialNumber, 80),
      plate: clean(input.plate, 10)?.toUpperCase() ?? null,
      model_year: year,
      acquisition_cost: toReais(toCents(input.acquisitionCost)),
      target_sale_price: input.targetSalePrice === null || input.targetSalePrice === undefined ? null : toReais(toCents(input.targetSalePrice)),
      description: clean(input.description, 1000),
      photo_url: photo,
    },
  };
}

export function validateCost(cost: ItemCostInput): { ok: true; data: { category: string; description: string; amount: number } } | { ok: false; error: string } {
  const category = COST_CATEGORIES.some((c) => c.value === cost.category) ? cost.category : null;
  if (!category) return { ok: false, error: 'Escolha o tipo de custo.' };
  if (!(cost.amount > 0) || !Number.isFinite(cost.amount)) return { ok: false, error: 'Informe o valor do custo.' };
  const label = COST_CATEGORIES.find((c) => c.value === category)!.label;
  return { ok: true, data: { category, description: clean(cost.description, 200) ?? label, amount: toReais(toCents(cost.amount)) } };
}

/** Custo total = compra + custos agregados (mesma regra do CMV do executor). */
export function itemTotalCost(acquisitionCost: number, costs: Array<{ amount: number }>): number {
  return toReais(calculateItemCMVCents(toCents(acquisitionCost), costs.map((c) => ({ amountCents: toCents(c.amount) }))));
}

async function writeGuard(supabase: SupabaseClient): Promise<string | null> {
  const access = await getSubscriptionAccess(supabase);
  return access.canWrite ? null : writeDeniedMessage(access.reason);
}

async function audit(supabase: SupabaseClient, userId: string, entity: string, id: string, action: string, after: unknown, before?: unknown) {
  await supabase.from('audit_log').insert({
    user_id: userId,
    entity_name: entity,
    entity_id: id,
    action_type: action,
    source: 'MANUAL_WEB',
    payload_before: before ?? null,
    payload_after: after,
  });
}

export async function createItem(
  supabase: SupabaseClient,
  userId: string,
  input: ItemInput,
  costs: ItemCostInput[] = []
): Promise<{ ok: true; itemId: string; costsSaved: boolean } | { ok: false; error: string }> {
  const valid = validateItemInput(input);
  if (!valid.ok) return valid;
  const validCosts = costs.map(validateCost);
  const badCost = validCosts.find((c) => !c.ok);
  if (badCost && !badCost.ok) return { ok: false, error: badCost.error };

  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };

  const { data, error } = await supabase
    .from('items')
    .insert({ user_id: userId, ...valid.data, status: 'disponivel' })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'Não consegui salvar a mercadoria. Tente de novo.' };
  await audit(supabase, userId, 'items', data.id, 'CREATE_ITEM', valid.data);

  let costsSaved = true;
  const rows = validCosts.filter((c) => c.ok).map((c) => ({ user_id: userId, item_id: data.id, ...(c as { data: { category: string; description: string; amount: number } }).data }));
  if (rows.length > 0) {
    const { error: costError } = await supabase.from('item_costs').insert(rows);
    costsSaved = !costError;
    if (!costError) await audit(supabase, userId, 'items', data.id, 'ADD_ITEM_COST', rows);
  }
  return { ok: true, itemId: data.id, costsSaved };
}

export async function updateItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  input: ItemInput,
  status?: EditableItemStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = validateItemInput(input);
  if (!valid.ok) return valid;
  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };

  const { data: before } = await supabase.from('items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
  if (!before) return { ok: false, error: 'Mercadoria não encontrada.' };
  if (!['disponivel', 'reservado', 'em_preparacao'].includes(before.status)) {
    return { ok: false, error: 'Mercadoria já vendida não pode ser alterada.' };
  }

  const patch: Record<string, unknown> = { ...valid.data };
  if (status && EDITABLE_ITEM_STATUSES.includes(status)) patch.status = status;

  const { error } = await supabase.from('items').update(patch).eq('id', itemId).eq('user_id', userId).in('status', ['disponivel', 'reservado', 'em_preparacao']);
  if (error) return { ok: false, error: 'Não consegui salvar as alterações.' };
  await audit(supabase, userId, 'items', itemId, 'UPDATE_ITEM', patch, before);
  return { ok: true };
}

export async function setItemStatus(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  status: EditableItemStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!EDITABLE_ITEM_STATUSES.includes(status)) return { ok: false, error: 'Status inválido.' };
  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };
  const { data, error } = await supabase
    .from('items')
    .update({ status })
    .eq('id', itemId)
    .eq('user_id', userId)
    .in('status', ['disponivel', 'reservado'])
    .select('id');
  if (error || !data || data.length === 0) return { ok: false, error: 'Não consegui mudar o status dessa mercadoria.' };
  await audit(supabase, userId, 'items', itemId, 'UPDATE_ITEM_STATUS', { status });
  return { ok: true };
}

export async function addItemCost(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  cost: ItemCostInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = validateCost(cost);
  if (!valid.ok) return valid;
  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };

  const { data: item } = await supabase.from('items').select('id, status').eq('id', itemId).eq('user_id', userId).maybeSingle();
  if (!item) return { ok: false, error: 'Mercadoria não encontrada.' };
  if (item.status === 'vendido') return { ok: false, error: 'Mercadoria já vendida: o custo do negócio já foi apurado.' };

  const { data, error } = await supabase.from('item_costs').insert({ user_id: userId, item_id: itemId, ...valid.data }).select('id').single();
  if (error || !data) return { ok: false, error: 'Não consegui salvar o custo.' };
  await audit(supabase, userId, 'item_costs', data.id, 'ADD_ITEM_COST', valid.data);
  return { ok: true };
}

export async function removeItemCost(
  supabase: SupabaseClient,
  userId: string,
  costId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };
  const { data: cost } = await supabase.from('item_costs').select('id, item_id, category, description, amount, items(status)').eq('id', costId).eq('user_id', userId).maybeSingle();
  if (!cost) return { ok: false, error: 'Custo não encontrado.' };
  if ((cost as unknown as { items: { status: string } | null }).items?.status === 'vendido') {
    return { ok: false, error: 'Mercadoria já vendida: o custo não pode mais ser removido.' };
  }
  const { error } = await supabase.from('item_costs').delete().eq('id', costId).eq('user_id', userId);
  if (error) return { ok: false, error: 'Não consegui remover o custo.' };
  await audit(supabase, userId, 'item_costs', costId, 'REMOVE_ITEM_COST', null, cost);
  return { ok: true };
}
