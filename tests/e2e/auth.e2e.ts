// tests/e2e/auth.e2e.ts
// Fase 2: rotinas de autenticação continuam funcionando após o hardening (cadastro → perfil + trial,
// login, senha errada, reset de senha). O reset usa link de recuperação gerado pelo admin, sem enviar e-mail.
// A proteção contra senhas vazadas (HaveIBeenPwned) é configuração do Auth no painel — ver relatório.

import assert from 'assert';
import { adminClient, anonClient, createTestUser, run, sql, test, TestUser } from './helpers';

let user: TestUser;

test('cadastro cria perfil e assinatura em trial pelo trigger do servidor', async () => {
  user = await createTestUser('auth');
  const [profile] = await sql<{ n: number }>('SELECT count(*)::int AS n FROM profiles WHERE id = $1', [user.id]);
  const [sub] = await sql<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
  assert.strictEqual(profile.n, 1);
  assert.strictEqual(sub.status, 'trialing');
});

test('login com senha correta funciona e com senha errada falha', async () => {
  const ok = await anonClient().auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(ok.error);
  const bad = await anonClient().auth.signInWithPassword({ email: user.email, password: 'senha-errada-123' });
  assert.ok(bad.error);
});

test('reset de senha: link de recuperação → nova senha → login com a nova, a antiga para de funcionar', async () => {
  const { data: link, error } = await adminClient().auth.admin.generateLink({ type: 'recovery', email: user.email });
  assert.ifError(error);

  const client = anonClient();
  const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: link.properties.hashed_token });
  assert.ifError(verified.error);

  const newPassword = `Nova-${Math.random().toString(36).slice(2)}-Aa9!`;
  const updated = await client.auth.updateUser({ password: newPassword });
  assert.ifError(updated.error);

  assert.ifError((await anonClient().auth.signInWithPassword({ email: user.email, password: newPassword })).error);
  assert.ok((await anonClient().auth.signInWithPassword({ email: user.email, password: user.password })).error);
});

run('E2E: AUTENTICAÇÃO');
