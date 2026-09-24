// src/app/actions/customers.ts
// Ações do Sistema: Gestão de Clientes / Contrapartes (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { Customer } from '@/types/domain';
import { actionSession, NOT_AUTHENTICATED } from '@/lib/auth/session';
import { createCustomer, CustomerInput, CustomerRecord, updateCustomer } from '@/lib/domain/customers';

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

// ------------------------------------------------------------------ telas do app (formulário)

export type SaveCustomerResult =
  | { ok: true; customer: CustomerRecord }
  | { ok: false; error: string; duplicate?: { id: string; name: string } };

/** Cria (ou edita, com customerId) um cliente pelo formulário. Homônimo é perguntado, não reaproveitado. */
export async function saveCustomerAction(
  input: CustomerInput,
  options: { customerId?: string; allowDuplicate?: boolean } = {}
): Promise<SaveCustomerResult> {
  const session = await actionSession();
  if (!session) return { ok: false, error: NOT_AUTHENTICATED };
  try {
    return options.customerId
      ? await updateCustomer(session.supabase, session.user.id, options.customerId, input)
      : await createCustomer(session.supabase, session.user.id, input, { allowDuplicate: options.allowDuplicate });
  } catch {
    return { ok: false, error: 'Não consegui salvar o cliente. Tente de novo.' };
  }
}
