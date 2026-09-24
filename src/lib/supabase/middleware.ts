// src/lib/supabase/middleware.ts
// Middleware Supabase para manutenção e renovação automática de sessão

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { guardRedirect } from '@/lib/auth/redirects';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-supabase-url.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Atualiza o token do usuário se estiver expirado
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch {
    // Supabase não configurado ou inacessível no ambiente local
  }

  // Proteção de rotas: /app/* exige sessão; /login e /cadastro com sessão vão para /app
  const target = guardRedirect(request.nextUrl.pathname, request.nextUrl.search, !!user);
  if (target) {
    const redirectResponse = NextResponse.redirect(new URL(target, request.url));
    // Mantém cookies de sessão renovados nesta mesma requisição
    supabaseResponse.cookies.getAll().forEach((c) => redirectResponse.cookies.set(c));
    return redirectResponse;
  }

  return supabaseResponse;
}
