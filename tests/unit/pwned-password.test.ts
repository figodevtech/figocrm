import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkPwnedPassword, PwnedPasswordCheckError, validateNewPassword } from '../../src/lib/security/pwned-password';

const originalFetch = globalThis.fetch;
const password = 'password';
const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
const suffix = digest.slice(5);
let requestedUrl = '';

async function main() {
try {
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal((init?.headers as Record<string, string>)['Add-Padding'], 'true');
    assert.ok(!requestedUrl.includes(digest));
    assert.equal(requestedUrl, `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
    return new Response(`${suffix}:123\r\n${'0'.repeat(35)}:0\r\n`);
  };
  assert.deepEqual(await checkPwnedPassword(password), { compromised: true, occurrences: 123 });
  assert.equal(await validateNewPassword(password), 'Essa senha já apareceu em vazamentos de dados. Escolha outra senha.');

  globalThis.fetch = async () => new Response(`${'F'.repeat(35)}:7\r\n`);
  assert.deepEqual(await checkPwnedPassword(password), { compromised: false });
  assert.equal(await validateNewPassword(password), null);
  assert.equal(await validateNewPassword('short'), 'A senha precisa ter pelo menos 8 caracteres.');

  for (const broken of [async () => { throw new Error('offline'); }, async () => new Response('invalid'), async () => new Response('', { status: 503 })]) {
    globalThis.fetch = broken;
    await assert.rejects(checkPwnedPassword(password), PwnedPasswordCheckError);
    assert.equal(await validateNewPassword(password), 'Não foi possível verificar a segurança da senha agora. Tente novamente em instantes.');
  }

  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    const hold = setTimeout(() => reject(new Error('mock did not time out')), 3500);
    init?.signal?.addEventListener('abort', () => { clearTimeout(hold); reject(new Error('timeout')); }, { once: true });
  });
  await assert.rejects(checkPwnedPassword(password), PwnedPasswordCheckError);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('pwned password: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
