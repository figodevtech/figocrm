// Aplica somente as três migrations Free/Pro/Asaas autorizadas, em uma transação.
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente.');

const files = [
  '20260924131613_free_pro_entitlements.sql',
  '20260924131911_voice_plan_quota.sql',
  '20260924132517_asaas_billing_support.sql',
];
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('figocrm_free_pro_asaas_migrations'))");
  for (const file of files) {
    const version = file.split('_')[0];
    const name = file.slice(version.length + 1, -4);
    const { rowCount } = await client.query('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1', [version]);
    if (rowCount) {
      console.log(`Já aplicada: ${file}`);
      continue;
    }
    const source = await fs.readFile(path.join('supabase', 'migrations', file), 'utf8');
    await client.query(source);
    await client.query('INSERT INTO supabase_migrations.schema_migrations (version, name, inserted_at) VALUES ($1, $2, now())', [version, name]);
    console.log(`Aplicada: ${file}`);
  }
  await client.query('COMMIT');
  console.log('Migrations Free/Pro/Asaas confirmadas no Supabase.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
