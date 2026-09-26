// src/proxy.ts
// Convenção Next.js 16 (substitui middleware.ts)
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/health' || request.nextUrl.pathname === '/api/webhooks/payment')
    return NextResponse.next();
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Aplica em todas as rotas exceto arquivos estáticos, favicon, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
