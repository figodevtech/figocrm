// src/app/auth/actions.ts
// Server Actions para Autenticação e Ciclo de Vida do Usuário (Fase 5)
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface AuthState {
  error?: string;
  success?: boolean;
  message?: string;
}

export async function signInAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Preencha o e-mail e a senha.' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl.includes('mock-supabase-url')) {
    return {
      error: 'Supabase não configurado. Por favor, adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.local.',
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        return {
          error: 'E-mail não confirmado. Por favor, confirme seu e-mail pelo link recebido ou desmarque "Confirm email" no painel do Supabase (Authentication -> Providers -> Email).',
        };
      }
      return { error: error.message || 'E-mail ou senha inválidos.' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha na conexão.';
    return { error: `Erro de conexão com o Supabase: ${msg}. Verifique as credenciais no .env.local.` };
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl.includes('mock-supabase-url')) {
    return {
      error: 'Supabase não configurado. Por favor, adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.local.',
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
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

    if (!data.session) {
      return {
        success: true,
        message: 'Cadastro realizado com sucesso! Um link de confirmação foi enviado para o seu e-mail. Confirme seu e-mail para acessar, ou desative "Confirm email" no painel do Supabase.',
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha na conexão.';
    return { error: `Erro de conexão com o Supabase: ${msg}. Verifique as credenciais no .env.local.` };
  }

  redirect('/app');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
