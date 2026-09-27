import { createHash } from 'node:crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2500;
const MAX_RESPONSE_LENGTH = 1024 * 1024;

export interface PwnedPasswordResult {
  compromised: boolean;
  occurrences?: number;
}

export class PwnedPasswordCheckError extends Error {
  constructor() {
    super('pwned_password_check_failed');
    this.name = 'PwnedPasswordCheckError';
  }
}

/** Only the first five SHA-1 hex characters leave this server. Never log the input or digest. */
export async function checkPwnedPassword(password: string): Promise<PwnedPasswordResult> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  try {
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true', 'User-Agent': 'FigoCRM-Password-Safety/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PwnedPasswordCheckError();
    const body = await response.text();
    if (!body || body.length > MAX_RESPONSE_LENGTH) throw new PwnedPasswordCheckError();

    let occurrences = 0;
    for (const line of body.trimEnd().split(/\r?\n/)) {
      const match = /^([A-F0-9]{35}):([0-9]+)$/.exec(line);
      if (!match) throw new PwnedPasswordCheckError();
      const count = Number(match[2]);
      if (!Number.isSafeInteger(count)) throw new PwnedPasswordCheckError();
      if (match[1] === suffix) occurrences = count;
    }
    return occurrences > 0 ? { compromised: true, occurrences } : { compromised: false };
  } catch {
    throw new PwnedPasswordCheckError();
  }
}

export async function validateNewPassword(password: string): Promise<string | null> {
  if (password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  try {
    if ((await checkPwnedPassword(password)).compromised) {
      console.warn('pwned_password_rejected');
      return 'Essa senha já apareceu em vazamentos de dados. Escolha outra senha.';
    }
    return null;
  } catch {
    console.error('pwned_password_check_failed');
    return 'Não foi possível verificar a segurança da senha agora. Tente novamente em instantes.';
  }
}
