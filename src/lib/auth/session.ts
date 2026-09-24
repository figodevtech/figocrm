// src/lib/auth/session.ts
// Sessão do usuário nas páginas (Server Components) e nas Server Actions.

import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export interface Session {
  supabase: SupabaseClient;
  user: User;
}

/** Página protegida: sem sessão volta para o login (o proxy já barra, isto é a segunda camada). */
export async function requireSession(): Promise<Session> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

/** Server Action: nunca redireciona no meio de uma mutação; devolve null e a ação responde com erro. */
export async function actionSession(): Promise<Session | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export const NOT_AUTHENTICATED = 'Sua sessão terminou. Entre de novo.';
