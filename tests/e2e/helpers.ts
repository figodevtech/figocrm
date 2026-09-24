// tests/e2e/helpers.ts
// Infraestrutura dos testes de integração contra o Supabase real.
// Cada teste cria usuários descartáveis (@figocrm.test), nunca toca dados reais e limpa tudo ao final.

import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

export const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_SERVICE_ROLE_KEY || '',
  dbUrl: process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL || '',
};

export function assertEnv(): void {
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`Variáveis ausentes para testes E2E: ${missing.join(', ')}`);
    process.exit(2);
  }
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): SupabaseClient {
  return createClient(env.url, env.anonKey, noSession);
}

export function adminClient(): SupabaseClient {
  return createClient(env.url, env.serviceKey, noSession);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

const createdUserIds: string[] = [];

export async function createTestUser(label: string, metadata: Record<string, unknown> = {}): Promise<TestUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@figocrm.test`;
  const password = `E2e-${Math.random().toString(36).slice(2)}-Aa1!`;
  const admin = adminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${label}`, ...metadata },
  });
  if (error || !data.user) throw new Error(`Falha ao criar usuário de teste: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Falha no login do usuário de teste: ${signInError.message}`);

  return { id: data.user.id, email, password, client };
}

// Ordem respeita FKs com ON DELETE RESTRICT (payments → installments, deals → customers).
const CLEANUP_ORDER = [
  'payments',
  'adjustments',
  'cash_movements',
  'settlements',
  'installments',
  'renegotiations',
  'receivables',
  'loan_contract_documents',
  'loan_contracts',
  'payables',
  'conversation_context',
  'ai_interactions',
  'ai_telemetry',
  'voice_rate_limits',
  'billing_checkout_sessions',
  'billing_events',
  'audit_log',
];

/** Fotos de mercadoria ficam no Storage (pasta = id do usuário), fora do cascade do banco. */
async function removeUserPhotos(userId: string): Promise<void> {
  try {
    const storage = adminClient().storage.from('item-photos');
    const { data } = await storage.list(userId, { limit: 1000 });
    if (data && data.length > 0) await storage.remove(data.map((f) => `${userId}/${f.name}`));
  } catch {
    // Sem bucket configurado: nada a remover
  }
}

export async function cleanupTestUsers(): Promise<void> {
  if (createdUserIds.length === 0) return;
  for (const userId of createdUserIds) await removeUserPhotos(userId);
  const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    for (const userId of createdUserIds.splice(0)) {
      await db.query('BEGIN');
      for (const table of CLEANUP_ORDER) {
        const exists = await db.query('SELECT to_regclass($1) AS t', [`public.${table}`]);
        if (exists.rows[0].t) await db.query(`DELETE FROM public.${table} WHERE user_id = $1`, [userId]);
      }
      await db.query('DELETE FROM public.deal_items WHERE deal_id IN (SELECT id FROM public.deals WHERE user_id = $1)', [userId]);
      await db.query('DELETE FROM public.deals WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM public.item_costs WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM public.items WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM public.customers WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM public.profiles WHERE id = $1', [userId]);
      await db.query('DELETE FROM auth.users WHERE id = $1', [userId]);
      await db.query('COMMIT');
    }
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

// Mini test runner sem dependências externas
type TestFn = () => Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export async function run(title: string): Promise<void> {
  assertEnv();
  console.log(`\n${title}\n${'─'.repeat(title.length)}`);
  let failed = 0;
  try {
    for (const t of tests) {
      try {
        await t.fn();
        console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (err) {
        failed++;
        console.error(`  \x1b[31m✗\x1b[0m ${t.name}\n    ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await cleanupTestUsers();
  }
  console.log(`\n${tests.length - failed}/${tests.length} testes passaram.`);
  if (failed > 0) process.exit(1);
}

/** SQL direto como postgres (sem RLS, sem trigger de assinatura) — só para preparar cenários. */
export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    return (await db.query(query, params)).rows as T[];
  } finally {
    await db.end();
  }
}

export async function seedCustomer(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.from('customers').insert({ user_id: user.id, name }).select('id').single();
  if (error) throw new Error(`seedCustomer: ${error.message}`);
  return data.id;
}

export async function seedItem(user: TestUser, name: string, acquisitionCost: number): Promise<string> {
  const { data, error } = await user.client
    .from('items')
    .insert({ user_id: user.id, name, acquisition_cost: acquisitionCost, status: 'disponivel' })
    .select('id')
    .single();
  if (error) throw new Error(`seedItem: ${error.message}`);
  return data.id;
}
