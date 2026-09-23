// tests/e2e/http-smoke.e2e.ts
// Smoke test HTTP dos endpoints de voz (rotas Next reais) com usuário descartável no Supabase real.
//
//   SMOKE_BASE_URL=http://localhost:3000 npx tsx tests/e2e/http-smoke.e2e.ts      (após `next start`)
//   SMOKE_BASE_URL=https://<deploy>.vercel.app VERCEL_PROTECTION_BYPASS=<segredo> npx tsx ...
//
// Cobre: 401 sem sessão, fluxo autenticado por cookie (@supabase/ssr), diálogo canônico via HTTP,
// transcribe com áudio inválido + fallbackText, rate limit distribuído (429) e telemetria gravada.

import assert from 'assert';
import pg from 'pg';
import { createServerClient } from '@supabase/ssr';
import { createTestUser, env, run, seedItem, test, TestUser } from './helpers';

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const bypass = process.env.VERCEL_PROTECTION_BYPASS;

let user: TestUser;
let cookieHeader = '';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}), ...(cookieHeader ? { cookie: cookieHeader } : {}), ...extra };
}

async function postText(spokenText: string, withAuth = true) {
  const res = await fetch(`${BASE}/api/voice/process`, {
    method: 'POST',
    headers: withAuth ? headers({ 'content-type': 'application/json' }) : { ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ spokenText }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

test(`endpoints recusam chamada sem sessão (${BASE})`, async () => {
  const proc = await postText('Quanto dinheiro eu tenho na rua?', false);
  assert.strictEqual(proc.status, 401, JSON.stringify(proc.body));

  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'a.webm');
  const tr = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', body: form, headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {} });
  assert.strictEqual(tr.status, 401);
});

test('login gera cookie de sessão válido para as rotas', async () => {
  user = await createTestUser('smoke');
  await seedItem(user, 'Honda XRE 300', 20000);

  // Mesma biblioteca de cookies do app: garante o formato exato esperado pelo servidor
  const jar = new Map<string, string>();
  const ssr = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(error);
  cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  assert.ok(cookieHeader.includes('auth-token'));
});

test('consulta autenticada responde e informa a fonte da interpretação', async () => {
  const res = await postText('Quanto dinheiro eu tenho na rua?');
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.assistant?.status, 'answered');
  assert.ok(!('error' in res.body), 'erro técnico nunca vai ao front');
  console.log(`      interpretação: ${res.body.metrics?.interpretationSource} ${res.body.metrics?.provider ?? ''} ${res.body.metrics?.model ?? ''}`);
});

test('diálogo canônico via HTTP grava a troca e liquida a dívida', async () => {
  const turns = [
    'Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.',
    'Ele mandou 500 daquela primeira.',
    'Abate mil porque ele ficou com meu som.',
    'Ele quitou o resto.',
  ];
  for (const t of turns) {
    const res = await postText(t);
    console.log(`      > ${t}\n      < ${res.status} ${res.body.assistant?.message}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.assistant?.status, 'executed', res.body.assistant?.message);
  }
  const { data: rec } = await user.client.from('receivables').select('total_amount, balance, status').single();
  assert.strictEqual(Number(rec!.total_amount), 8000);
  assert.strictEqual(Number(rec!.balance), 0);
  assert.strictEqual(rec!.status, 'paid');
});

test('transcribe autenticado: áudio inválido cai no fallbackText sem erro 500', async () => {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(64)], { type: 'audio/webm' }), 'a.webm');
  form.append('fallbackText', 'Quanto dinheiro eu tenho na rua?');
  const res = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', body: form, headers: headers() });
  const body = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(body));
  assert.strictEqual(body.processResult?.assistant?.status, 'answered');
  console.log(`      stt: ${body.metrics?.provider}`);
});

test('áudio de fala real (TTS) → Whisper → LLM → resposta e telemetria de áudio', async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log('      (sem OPENAI_API_KEY: teste de áudio real pulado)');
    return;
  }
  const tts = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: 'Quanto dinheiro eu tenho na rua?', response_format: 'mp3' }),
  });
  assert.ok(tts.ok, `TTS falhou: HTTP ${tts.status}`);
  const audio = new Uint8Array(await tts.arrayBuffer());

  const form = new FormData();
  form.append('audio', new Blob([audio], { type: 'audio/mpeg' }), 'fala.mp3');
  const res = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', body: form, headers: headers() });
  const body = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(body));
  console.log(`      stt: ${body.metrics?.provider} · "${body.transcribedText}" → ${body.processResult?.assistant?.message}`);
  assert.strictEqual(body.metrics?.provider, 'openai_whisper');
  assert.match(body.transcribedText, /rua/i);
  assert.strictEqual(body.processResult?.assistant?.status, 'answered');

  const [row] = await (async () => {
    const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
      return (await db.query(`SELECT stt_provider, audio_duration_seconds::float8 AS secs, stt_latency_ms, llm_model, success
                              FROM ai_telemetry WHERE user_id = $1 AND input_type = 'audio' AND stt_provider = 'openai_whisper'`, [user.id])).rows;
    } finally {
      await db.end();
    }
  })();
  assert.ok(row && row.secs > 0 && row.stt_latency_ms > 0 && row.success, `telemetria de áudio: ${JSON.stringify(row)}`);
});

test('rate limit distribuído devolve 429 com Retry-After ao passar do limite por minuto', async () => {
  let limited: Awaited<ReturnType<typeof postText>> | undefined;
  for (let i = 0; i < 25 && !limited; i++) {
    const res = await postText('Quanto dinheiro eu tenho na rua?');
    if (res.status === 429) limited = res;
    else assert.strictEqual(res.status, 200);
  }
  assert.ok(limited, 'esperava 429 dentro de 25 requisições');
  assert.strictEqual(limited!.body.assistant?.code, 'rate_limited');
  assert.ok(Number(limited!.headers.get('retry-after')) > 0);
});

test('telemetria estruturada registrada para o usuário (sem texto nem áudio)', async () => {
  const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const r = await db.query(
      `SELECT endpoint, input_type, interpretation_source, total_latency_ms, success FROM public.ai_telemetry WHERE user_id = $1`,
      [user.id]
    );
    assert.ok(r.rows.length >= 6, `esperava >= 6 eventos, veio ${r.rows.length}`);
    assert.ok(r.rows.some((row) => row.endpoint === 'voice/transcribe' && row.input_type === 'audio'));
    assert.ok(r.rows.every((row) => row.total_latency_ms !== null));
  } finally {
    await db.end();
  }
});

run('SMOKE HTTP DOS ENDPOINTS DE VOZ');
