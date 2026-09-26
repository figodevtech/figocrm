import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';
import { adminClient, createTestUser, run, seedCustomer, test, type TestUser, env } from './helpers';

const BASE = (process.env.UI_BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
let user: TestUser;
let other: TestUser;
let cookieHeader = '';

test('health, páginas legais e 404 respondem sem sessão', async () => {
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  for (const route of ['/termos', '/privacidade', '/suporte'])
    assert.equal((await fetch(`${BASE}${route}`)).status, 200, route);
  assert.equal((await fetch(`${BASE}/pagina-inexistente`)).status, 404);
  const app = await fetch(`${BASE}/app`, { redirect: 'manual' });
  assert.equal(app.status, 307);
  assert.match(app.headers.get('location') || '', /\/login\?next=/);
});

test('exportação e mutações exigem sessão', async () => {
  assert.equal((await fetch(`${BASE}/api/account/export`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'bug', description: 'Relato de teste sem sessão' }) })).status, 401);
  assert.equal((await fetch(`${BASE}/api/account/closure`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'ENCERRAR', password: 'qualquer' }) })).status, 401);
});

test('exportação inclui somente dados próprios e omite tokens', async () => {
  user = await createTestUser('launch');
  other = await createTestUser('launch-other');
  await seedCustomer(user, 'Cliente da conta A');
  await seedCustomer(other, 'Cliente da conta B');
  const jar = new Map<string, string>();
  const ssr = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies: Array<{ name: string; value: string }>) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  assert.ifError((await ssr.auth.signInWithPassword({ email: user.email, password: user.password })).error);
  cookieHeader = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${BASE}/api/account/export`, { headers: { cookie: cookieHeader } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /attachment/);
  const json = await response.json();
  assert.equal(json.profile.id, user.id);
  assert.ok(json.customers.some((row: { name: string }) => row.name === 'Cliente da conta A'));
  assert.ok(!json.customers.some((row: { name: string }) => row.name === 'Cliente da conta B'));
  assert.ok(!JSON.stringify(json).includes(user.password));
  assert.ok(!('billing_events' in json));
});

test('feedback e encerramento autenticados mantêm ownership e confirmação forte', async () => {
  const headers = { cookie: cookieHeader, 'content-type': 'application/json' };
  const feedback = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers,
    body: JSON.stringify({ category: 'bug', description: 'Teste de feedback da conta', route: '/app/conta' }) });
  assert.equal(feedback.status, 201);
  const { data: reports } = await adminClient().from('feedback_reports').select('description').eq('user_id', user.id);
  assert.equal(reports?.length, 1);
  const denied = await fetch(`${BASE}/api/account/closure`, { method: 'POST', headers,
    body: JSON.stringify({ confirmation: 'ENCERRAR', password: 'senha-incorreta' }) });
  assert.equal(denied.status, 403);
  const closure = await fetch(`${BASE}/api/account/closure`, { method: 'POST', headers,
    body: JSON.stringify({ confirmation: 'ENCERRAR', password: user.password }) });
  assert.equal(closure.status, 200);
  assert.equal((await closure.json()).status, 'scheduled');
  const { data: request } = await adminClient().from('account_closure_requests').select('status,scheduled_for').eq('user_id', user.id).single();
  assert.equal(request?.status, 'scheduled');
  assert.ok(request?.scheduled_for);
  const cross = await other.client.from('account_closure_requests').insert({ user_id: user.id });
  assert.ok(cross.error);
});

run('E2E: LAUNCH HARDENING HTTP');
