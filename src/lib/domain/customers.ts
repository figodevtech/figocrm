// src/lib/domain/customers.ts
// Cadastro e edição de clientes. Usado pelas ações do formulário e pelos testes E2E com o mesmo cliente
// Supabase do usuário (RLS + trigger de assinatura no banco).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';
import { normalizeName } from '@/lib/domain/entity-resolver';

export interface CustomerInput {
  name: string;
  phone?: string | null;
  document?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  document: string | null;
  address: string | null;
  notes: string | null;
}

const clean = (v: string | null | undefined, max: number) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

export function validateCustomerInput(input: CustomerInput): { ok: true; data: Omit<CustomerRecord, 'id'> } | { ok: false; error: string } {
  const name = clean(input.name, 120);
  if (!name) return { ok: false, error: 'Informe o nome do cliente.' };
  const phone = clean(input.phone, 30);
  if (phone && phone.replace(/\D/g, '').length < 8) return { ok: false, error: 'Telefone incompleto.' };
  const document = clean(input.document, 20);
  if (document) {
    const digits = document.replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) return { ok: false, error: 'CPF deve ter 11 dígitos e CNPJ 14.' };
  }
  return { ok: true, data: { name, phone, document, address: clean(input.address, 300), notes: clean(input.notes, 1000) } };
}

async function writeGuard(supabase: SupabaseClient): Promise<string | null> {
  const access = await getSubscriptionAccess(supabase);
  return access.canWrite ? null : writeDeniedMessage(access.reason);
}

export type CreateCustomerResult =
  | { ok: true; customer: CustomerRecord }
  | { ok: false; error: string; duplicate?: { id: string; name: string } };

/**
 * Cria cliente. Nome igual a um já cadastrado não é reaproveitado em silêncio:
 * devolve `duplicate` para a tela perguntar (a não ser que allowDuplicate).
 */
export async function createCustomer(
  supabase: SupabaseClient,
  userId: string,
  input: CustomerInput,
  options: { allowDuplicate?: boolean; provisional?: boolean } = {}
): Promise<CreateCustomerResult> {
  const valid = validateCustomerInput(input);
  if (!valid.ok) return valid;

  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };

  if (!options.allowDuplicate) {
    const { data: same } = await supabase.from('customers').select('id, name').eq('user_id', userId).ilike('name', valid.data.name).limit(5);
    const duplicate = (same ?? []).find((c) => normalizeName(c.name) === normalizeName(valid.data.name));
    if (duplicate) return { ok: false, error: `Já existe um cliente chamado ${duplicate.name}.`, duplicate };
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({ user_id: userId, ...valid.data, is_provisional: !!options.provisional })
    .select('id, name, phone, document, address, notes')
    .single();
  if (error || !data) return { ok: false, error: 'Não consegui salvar o cliente. Tente de novo.' };

  await supabase.from('audit_log').insert({
    user_id: userId,
    entity_name: 'customers',
    entity_id: data.id,
    action_type: 'CREATE_CUSTOMER',
    source: 'MANUAL_WEB',
    payload_after: data,
  });
  return { ok: true, customer: data as CustomerRecord };
}

export async function updateCustomer(
  supabase: SupabaseClient,
  userId: string,
  customerId: string,
  input: CustomerInput,
  options: { confirmProvisional?: boolean } = {}
): Promise<{ ok: true; customer: CustomerRecord } | { ok: false; error: string }> {
  const valid = validateCustomerInput(input);
  if (!valid.ok) return valid;

  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };

  const { data: before } = await supabase
    .from('customers')
    .select('id, name, phone, document, address, notes')
    .eq('id', customerId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Cliente não encontrado.' };

  const { data, error } = await supabase
    .from('customers')
    .update(options.confirmProvisional ? { ...valid.data, is_provisional: false } : valid.data)
    .eq('id', customerId)
    .eq('user_id', userId)
    .select('id, name, phone, document, address, notes')
    .single();
  if (error || !data) return { ok: false, error: 'Não consegui salvar as alterações.' };

  await supabase.from('audit_log').insert({
    user_id: userId,
    entity_name: 'customers',
    entity_id: customerId,
    action_type: options.confirmProvisional ? 'CONFIRM_PROVISIONAL_CUSTOMER' : 'UPDATE_CUSTOMER',
    source: 'MANUAL_WEB',
    payload_before: before,
    payload_after: data,
  });
  return { ok: true, customer: data as CustomerRecord };
}

/**
 * Vincula um cliente AVULSO (criado pela voz) a um cadastro existente: negócios, dívidas, empréstimos e
 * pagamentos passam para o cadastro e o avulso some. Valores não mudam (RPC merge_provisional_customer).
 */
export async function mergeProvisionalCustomer(
  supabase: SupabaseClient,
  sourceId: string,
  targetId: string
): Promise<{ ok: true; targetId: string } | { ok: false; error: string }> {
  if (!sourceId || !targetId || sourceId === targetId) return { ok: false, error: 'Escolha outro cliente para vincular.' };
  const denied = await writeGuard(supabase);
  if (denied) return { ok: false, error: denied };
  const { error } = await supabase.rpc('merge_provisional_customer', { p_payload: { source_id: sourceId, target_id: targetId } });
  if (error) {
    if (error.hint === 'NOT_PROVISIONAL') return { ok: false, error: 'Só cliente avulso pode ser vinculado.' };
    return { ok: false, error: 'Não consegui vincular. Nada foi alterado.' };
  }
  return { ok: true, targetId };
}
