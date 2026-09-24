// src/app/auth/callback/route.ts
// Destino dos links enviados por e-mail (confirmação de cadastro e recuperação de senha).
// Aceita os dois formatos do Supabase: ?code= (PKCE) e ?token_hash=&type= (template de e-mail customizado).
// Cria a sessão e segue para `next` (somente rotas internas).

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth/redirects';

const OTP_TYPES: EmailOtpType[] = ['recovery', 'signup', 'email', 'invite', 'magiclink', 'email_change'];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get('next'), type === 'recovery' ? '/redefinir-senha' : '/app');

  const supabase = await createClient();
  let ok = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  if (!ok) {
    const failure = next.startsWith('/redefinir-senha') ? '/esqueci-senha?erro=link' : '/login?erro=link';
    return NextResponse.redirect(new URL(failure, request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
