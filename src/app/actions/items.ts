// src/app/actions/items.ts
// Ações do Sistema: Gestão de Mercadorias e Custos Agregados (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { Item, ItemStatus, ItemCostCategory } from '@/types/domain';
import { calculateCMV } from '@/lib/financial_engine';

export interface CreateItemInput {
  name: string;
  category?: string;
  description?: string;
  acquisitionCost: number;
  targetSalePrice?: number;
  status?: ItemStatus;
  photoUrl?: string;
}

export async function createItemAction(input: CreateItemInput): Promise<{ item?: Item; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Usuário não autenticado.' };
    }

    await assertWritePermission(user.id);

    if (!input.name || input.name.trim().length === 0) {
      return { error: 'O nome da mercadoria é obrigatório.' };
    }

    const { data, error } = await supabase
      .from('items')
      .insert({
        user_id: user.id,
        name: input.name.trim(),
        category: input.category || null,
        description: input.description || null,
        acquisition_cost: input.acquisitionCost || 0,
        target_sale_price: input.targetSalePrice || null,
        status: input.status || 'disponivel',
        photo_url: input.photoUrl || null,
      })
      .select('*')
      .single();

    if (error) {
      return { error: error.message };
    }

    // Registrar no log de auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'items',
      entity_id: data.id,
      action_type: 'CREATE_ITEM',
      source: 'MANUAL_WEB',
      payload_after: data,
    });

    return { item: data as Item };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao cadastrar mercadoria.';
    return { error: message };
  }
}

export async function addItemCostAction(input: {
  itemId: string;
  category: ItemCostCategory;
  description: string;
  amount: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Não autenticado.' };
    }

    await assertWritePermission(user.id);

    if (input.amount <= 0) {
      return { success: false, error: 'O valor do custo deve ser positivo.' };
    }

    const { data, error } = await supabase
      .from('item_costs')
      .insert({
        user_id: user.id,
        item_id: input.itemId,
        category: input.category,
        description: input.description,
        amount: input.amount,
      })
      .select('*')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Registra auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'item_costs',
      entity_id: data.id,
      action_type: 'ADD_ITEM_COST',
      source: 'MANUAL_WEB',
      payload_after: data,
    });

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao adicionar custo ao item.';
    return { success: false, error: message };
  }
}

export async function getStockItemsAction(statusFilter?: ItemStatus[]): Promise<{ items: Item[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { items: [], error: 'Não autenticado.' };
    }

    let query = supabase
      .from('items')
      .select('*, item_costs(*)')
      .eq('user_id', user.id);

    if (statusFilter && statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return { items: [], error: error.message };
    }

    // Calcula CMV consolidado em tempo de execução
    const items = (data || []).map((row) => {
      const costs = row.item_costs || [];
      const totalCMV = calculateCMV(Number(row.acquisition_cost), costs);
      return {
        ...row,
        totalCMV,
      } as Item;
    });

    return { items };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar itens de estoque.';
    return { items: [], error: message };
  }
}
