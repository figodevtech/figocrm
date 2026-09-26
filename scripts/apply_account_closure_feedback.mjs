// Migration específica, transacional. Sem --apply executa SQL e faz ROLLBACK para validação.
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente.');
const files = [
  ['20260926151552_account_closure_feedback.sql', '20260926151552', 'account_closure_feedback'],
  ['20260926154510_feedback_user_index.sql', '20260926154510', 'feedback_user_index'],
];
const apply = process.argv.includes('--apply');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('figocrm_account_closure_feedback'))");
  let pending = 0;
  for (const [file, version, name] of files) {
    const existing = await client.query('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1', [version]);
    if (existing.rowCount) continue;
    pending++;
    const sql = await fs.readFile(path.join('supabase', 'migrations', file), 'utf8');
    await client.query(sql);
    if (apply) {
      await client.query('INSERT INTO supabase_migrations.schema_migrations (version, name, inserted_at) VALUES ($1, $2, now())', [version, name]);
    }
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(`${pending} migration(s) ${apply ? 'aplicadas' : 'validadas sem alterações'}.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
