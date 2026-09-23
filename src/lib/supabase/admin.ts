// src/lib/supabase/admin.ts
// Cliente service_role — SOMENTE no servidor, para rotinas sem sessão de usuário (webhook de billing).
// Ignora RLS: nunca expor ao browser nem usar em fluxo iniciado pelo usuário.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
