// Executa as migrations Free/Pro em uma transação descartada antes do deploy.
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente.');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  for (const file of ['20260924131613_free_pro_entitlements.sql', '20260924131911_voice_plan_quota.sql', '20260924132517_asaas_billing_support.sql']) {
    await client.query(await fs.readFile(path.join('supabase', 'migrations', file), 'utf8'));
    console.log(`SQL validado: ${file}`);
  }
  const { rows: plans } = await client.query('SELECT plan_code, price_cents, customer_limit, voice_monthly_limit FROM public.plan_entitlements ORDER BY plan_code');
  if (plans.length !== 2 || plans[0].price_cents !== 0 || plans[0].customer_limit !== 10 || plans[1].price_cents !== 2450 || plans[1].voice_monthly_limit !== 1000) {
    throw new Error('Catálogo Free/Pro inesperado.');
  }
  const userId = randomUUID();
  await client.query(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now())`,
    [userId, `tx-${userId}@figocrm.test`]);
  await client.query("UPDATE public.subscriptions SET status = 'expired', trial_ends_at = now() - interval '1 day' WHERE user_id = $1", [userId]);
  await client.query('SET LOCAL ROLE authenticated');
  await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
  const { rows: [free] } = await client.query('SELECT * FROM public.account_entitlements()');
  if (free.effective_plan !== 'free' || !free.can_write || free.customer_limit !== 10) throw new Error('Fallback Free incorreto.');
  await client.query(`INSERT INTO public.customers (user_id, name, is_provisional)
    SELECT $1, 'Cliente ' || i, i = 10 FROM generate_series(1, 10) AS i`, [userId]);
  await client.query('SAVEPOINT quota_customer');
  try {
    await client.query('INSERT INTO public.customers (user_id, name) VALUES ($1, $2)', [userId, 'Cliente 11']);
    throw new Error('11º cliente aceito indevidamente.');
  } catch (error) {
    if (error.message === '11º cliente aceito indevidamente.') throw error;
    if (error.hint !== 'FREE_CUSTOMER_LIMIT') throw error;
    await client.query('ROLLBACK TO SAVEPOINT quota_customer');
  }
  const { rows: [after] } = await client.query('SELECT * FROM public.account_entitlements()');
  if (Number(after.customer_count) !== 10 || after.can_create_customer) throw new Error('Contagem de clientes incorreta.');
  for (let i = 0; i < 21; i++) {
    const { rows: [{ result }] } = await client.query(`SELECT public.consume_voice_rate_limit('voice', 100, 100) AS result`);
    if (i < 20 && !result.allowed) throw new Error(`Voz ${i + 1} negada indevidamente.`);
    if (i === 20 && (result.allowed || result.reason !== 'monthly_limit')) throw new Error('21º comando de voz aceito indevidamente.');
  }
  await client.query('RESET ROLE');
  await client.query("UPDATE public.subscriptions SET status = 'active', current_period_end = now() + interval '30 days' WHERE user_id = $1", [userId]);
  await client.query('SET LOCAL ROLE authenticated');
  const { rows: [pro] } = await client.query('SELECT * FROM public.account_entitlements()');
  if (pro.effective_plan !== 'pro' || pro.customer_limit !== null || pro.voice_monthly_limit !== 1000)
    throw new Error('Entitlement Pro incorreto.');
  await client.query('INSERT INTO public.customers (user_id, name) VALUES ($1, $2)', [userId, 'Cliente Pro 11']);
  await client.query('RESET ROLE');
  await client.query("UPDATE public.subscriptions SET status = 'expired' WHERE user_id = $1", [userId]);
  await client.query('SET LOCAL ROLE authenticated');
  const { rows: [downgraded] } = await client.query('SELECT * FROM public.account_entitlements()');
  if (downgraded.effective_plan !== 'free' || Number(downgraded.customer_count) !== 11 || downgraded.can_create_customer)
    throw new Error('Downgrade Pro → Free incorreto.');
  await client.query('RESET ROLE');
  console.log('Catálogo e SQL Free/Pro válidos. Rollback aplicado.');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
