// src/lib/supabase/middleware.ts
// Middleware Supabase para manutenção e renovação automática de sessão

import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { guardRedirect } from '@/lib/auth/redirects';
import { isInvalidSessionError, isSupabaseSessionCookie } from '@/lib/auth/invalid-session';

export async function updateSession(request: NextRequest) {
  const hadSessionCookie = request.cookies.getAll().some(({ name }) => isSupabaseSessionCookie(name));
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
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
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

  // getUser pode retornar { error } sem lançar. Só erros definitivos invalidam cookies.
  let user = null;
  let authError: unknown = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data?.user ?? null;
    authError = error;
  } catch (error) {
    authError = error;
  }

  if (isInvalidSessionError(authError)) {
    for (const { name } of request.cookies.getAll()) {
      if (!isSupabaseSessionCookie(name)) continue;
      request.cookies.delete(name);
      supabaseResponse.cookies.set(name, '', { path: '/', maxAge: 0 });
    }
  } else if (authError && hadSessionCookie && request.nextUrl.pathname.startsWith('/app')) {
    // Falha de rede não é logout. Evita novo refresh no render e preserva os cookies.
    return new NextResponse('Não foi possível verificar sua sessão agora. Tente novamente.', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
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
