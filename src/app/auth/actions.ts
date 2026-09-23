// src/app/auth/actions.ts
// Server Actions para Autenticação e Ciclo de Vida do Usuário (Fase 5)
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface AuthState {
  error?: string;
  success?: boolean;
}

export async function signInAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Preencha o e-mail e a senha.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: 'E-mail ou senha inválidos.' };
  }

  redirect('/app');
}

export async function signUpAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('fullName') as string;
  const phone = formData.get('phone') as string;
  const businessSegment = formData.get('businessSegment') as string;

  if (!email || !password || !fullName) {
    return { error: 'Nome, e-mail e senha são obrigatórios.' };
  }

  if (password.length < 6) {
    return { error: 'A senha deve ter pelo menos 6 caracteres.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
        business_segment: businessSegment || 'revenda_geral',
      },
    },
  });

  if (error) {
    return { error: error.message || 'Erro ao criar conta.' };
  }

  redirect('/app');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
