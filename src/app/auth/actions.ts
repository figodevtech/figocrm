// src/app/auth/actions.ts
// Server Actions de autenticação e conta: entrar, criar conta (perfil + trial de 7 dias criados pelo
// trigger do banco), recuperar/alterar senha, editar perfil e sair.
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth/redirects';

export interface AuthState {
  error?: string;
  success?: boolean;
  message?: string;
}

const MIN_PASSWORD = 8;

function isConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && !url.includes('mock-supabase-url');
}

/** Mensagens do Supabase Auth em português, sem detalhes técnicos. */
function authMessage(raw: string | undefined): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Já existe uma conta com esse e-mail. Entre ou recupere a senha.';
  if (m.includes('password') && (m.includes('weak') || m.includes('pwned') || m.includes('leaked'))) {
    return 'Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.';
  }
  if (m.includes('should be different')) return 'A nova senha precisa ser diferente da atual.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  if (m.includes('session') || m.includes('jwt')) return 'Sua sessão expirou. Peça um novo link.';
  return 'Não foi possível concluir agora. Tente de novo.';
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signInAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = safeNextPath(String(formData.get('next') || ''));

  if (!email || !password) return { error: 'Preencha o e-mail e a senha.' };
  if (!isConfigured()) return { error: 'Serviço de login indisponível no momento.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authMessage(error.message) };

  redirect(next);
}

export async function signUpAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const fullName = String(formData.get('fullName') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const phone = String(formData.get('phone') || '').trim();
  const businessName = String(formData.get('businessName') || '').trim();

  if (!fullName || !email || !password) return { error: 'Nome, e-mail e senha são obrigatórios.' };
  if (password.length < MIN_PASSWORD) return { error: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` };
  if (!isConfigured()) return { error: 'Serviço de cadastro indisponível no momento.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/app`,
      data: {
        full_name: fullName.slice(0, 120),
        phone: phone.slice(0, 30) || null,
        business_name: businessName.slice(0, 120) || null,
      },
    },
  });
  if (error) return { error: authMessage(error.message) };

  // Projeto com confirmação de e-mail: sem sessão até clicar no link
  if (!data.session) {
    return { success: true, message: 'Conta criada! Enviamos um link para o seu e-mail. Abra o link para entrar.' };
  }
  redirect('/app');
}

export async function requestPasswordResetAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim();
  if (!email || !email.includes('@')) return { error: 'Digite o e-mail da sua conta.' };
  if (!isConfigured()) return { error: 'Serviço indisponível no momento.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/redefinir-senha`,
  });
  // Mesma resposta exista ou não a conta (não revela e-mails cadastrados); só limite de envio é informado
  if (error && /rate limit|too many/i.test(error.message)) return { error: authMessage(error.message) };
  return { success: true, message: 'Se esse e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também o spam.' };
}

export async function updatePasswordAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm') || '');
  if (password.length < MIN_PASSWORD) return { error: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` };
  if (password !== confirm) return { error: 'As senhas não são iguais.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Link expirado ou sessão encerrada. Peça um novo link de recuperação.' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authMessage(error.message) };
  return { success: true, message: 'Senha alterada.' };
}

export async function updateProfileAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const businessName = String(formData.get('businessName') || '').trim();
  const document = String(formData.get('document') || '').trim();
  const address = String(formData.get('address') || '').trim();
  if (!fullName) return { error: 'Informe seu nome.' };
  if (document && (!/^[0-9./-]+$/.test(document) || ![11, 14].includes(document.replace(/\D/g, '').length))) {
    return { error: 'Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão encerrada. Entre de novo.' };

  // profiles só aceita UPDATE nessas colunas (assinatura vive em subscriptions)
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName.slice(0, 120), phone: phone.slice(0, 30) || null, business_name: businessName.slice(0, 120) || null, document: document || null, address: address.slice(0, 300) || null })
    .eq('id', user.id);
  if (error) return { error: 'Não consegui salvar. Tente de novo.' };
  return { success: true, message: 'Dados salvos.' };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // Conversa de voz pendente não sobrevive ao logout
    await supabase.from('conversation_context').delete().eq('user_id', user.id);
  }
  await supabase.auth.signOut();
  redirect('/login');
}
