// src/lib/auth/redirects.ts
// Regras puras de proteção de rotas (usadas pelo proxy e testadas sem servidor).

/** Rotas de entrada: quem já está logado vai direto para /app. */
const AUTH_ONLY = ['/login', '/cadastro'];
/** Abertas para todos (landing, recuperação de senha, callback do e-mail, APIs que respondem 401 sozinhas). */
const PUBLIC_PREFIXES = ['/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/auth/', '/api/'];

const matches = (pathname: string, route: string) =>
  route.endsWith('/') ? pathname.startsWith(route) : pathname === route || pathname.startsWith(`${route}/`);

export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((r) => matches(pathname, r));
}

/**
 * Para onde redirecionar (ou null para seguir):
 *   não autenticado em rota privada → /login?next=<rota do app>
 *   autenticado em /login ou /cadastro → /app
 */
export function guardRedirect(pathname: string, search: string, authenticated: boolean): string | null {
  if (!authenticated && !isPublicPath(pathname)) {
    const next = safeNextPath(`${pathname}${search}`, '');
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  }
  if (authenticated && AUTH_ONLY.some((r) => matches(pathname, r))) return '/app';
  return null;
}

/** Só caminhos internos do app (evita open redirect: "//site", "https://...", "\\"). */
export function safeNextPath(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) return fallback;
  if (!/^\/(app|redefinir-senha)(\/|\?|$)/.test(raw)) return fallback;
  return raw;
}
