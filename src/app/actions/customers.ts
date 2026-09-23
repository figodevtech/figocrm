// src/app/actions/customers.ts
// Ações do Sistema: Gestão de Clientes / Contrapartes (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { Customer } from '@/types/domain';

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  document?: string;
  notes?: string;
}

export async function createCustomerAction(input: CreateCustomerInput): Promise<{ customer?: Customer; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Usuário não autenticado.' };
    }

    await assertWritePermission(user.id);

    if (!input.name || input.name.trim().length === 0) {
      return { error: 'O nome do cliente é obrigatório.' };
    }

    // Se já houver cliente com o mesmo nome e telefone, reaproveita
    const { data: existing } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .ilike('name', input.name.trim())
      .maybeSingle();

    if (existing) {
      return { customer: existing as Customer };
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        user_id: user.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        document: input.document?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select('*')
      .single();

    if (error) {
      return { error: error.message };
    }

    // Registrar no log de auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'customers',
      entity_id: data.id,
      action_type: 'CREATE_CUSTOMER',
      source: 'MANUAL_WEB',
      payload_after: data,
    });

    return { customer: data as Customer };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao cadastrar cliente.';
    return { error: message };
  }
}

export async function getCustomersAction(): Promise<{ customers: Customer[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { customers: [], error: 'Não autenticado.' };
    }

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) {
      return { customers: [], error: error.message };
    }

    return { customers: (data || []) as Customer[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar clientes.';
    return { customers: [], error: message };
  }
}
