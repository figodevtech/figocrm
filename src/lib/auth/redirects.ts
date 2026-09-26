// src/lib/auth/redirects.ts
// Regras puras de proteção de rotas (usadas pelo proxy e testadas sem servidor).

/** Rotas de entrada: quem já está logado vai direto para /app. */
const AUTH_ONLY = ['/login', '/cadastro'];
/** Rotas públicas conhecidas; APIs validam a própria sessão. */
const PUBLIC_PREFIXES = ['/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/termos', '/privacidade', '/suporte', '/auth/', '/api/'];

const matches = (pathname: string, route: string) =>
  route.endsWith('/') ? pathname.startsWith(route) : pathname === route || pathname.startsWith(`${route}/`);

export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((route) => matches(pathname, route));
}

/**
 * Para onde redirecionar (ou null para seguir):
 *   não autenticado em rota privada → /login?next=<rota do app>
 *   autenticado em /login ou /cadastro → /app
 */
export function guardRedirect(pathname: string, search: string, authenticated: boolean): string | null {
  if (!authenticated && matches(pathname, '/app')) {
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
