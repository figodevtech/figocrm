const INVALID_CODES = new Set([
  'refresh_token_not_found',
  'invalid_refresh_token',
  'refresh_token_already_used',
  'session_not_found',
]);

/** Only permanent session failures may remove browser credentials. */
export function isInvalidSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  if (candidate.name === 'AuthSessionMissingError') return true;
  if (typeof candidate.code === 'string' && INVALID_CODES.has(candidate.code.toLowerCase())) return true;
  if (typeof candidate.message !== 'string') return false;
  return /invalid refresh token|refresh token not found|refresh token already used|session not found/i.test(candidate.message);
}

export function isSupabaseSessionCookie(name: string): boolean {
  return /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i.test(name);
}
