// scripts/security_audit.mjs
// Auditoria do schema public — equivalente local das lints dos advisors do Supabase (splinter).
// Segurança: 0011 function_search_path_mutable, 0013 rls_disabled_in_public, 0008 rls_enabled_no_policy,
// 0028/0029 security definer executável por anon/authenticated.
// Performance: 0003 auth_rls_initplan, 0001 unindexed_foreign_keys.
// Também lista os grants reais de EXECUTE por role.
//
// Uso: node scripts/security_audit.mjs [--json=caminho] [--strict]
//   --strict: exit 1 se anon puder executar qualquer função do schema public.

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_DIRECT_CONNECTION_STRING ou DATABASE_URL não definida.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const functions = (
  await client.query(`
    SELECT p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef AS security_definer,
           COALESCE(array_to_string(p.proconfig, ','), '') AS config,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
           EXISTS (
             SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
           ) AS public_grant
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `)
).rows;

const tables = (
  await client.query(`
    SELECT c.relname AS name, c.relrowsecurity AS rls,
           (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = c.relname)::int AS policies
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    ORDER BY c.relname
  `)
).rows;

const policies = (
  await client.query(`SELECT tablename, policyname, COALESCE(qual, '') || ' ' || COALESCE(with_check, '') AS expr
                      FROM pg_policies WHERE schemaname = 'public'`)
).rows;

const unindexedFks = (
  await client.query(`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
  `)
).rows;

await client.end();

const findings = [];
for (const f of functions) {
  const sig = `${f.name}(${f.args})`;
  if (!f.config.includes('search_path')) {
    findings.push({ level: 'WARN', lint: 'function_search_path_mutable', object: sig });
  }
  if (f.security_definer && f.anon) {
    findings.push({ level: 'WARN', lint: 'anon_security_definer_function_executable', object: sig });
  }
  if (f.security_definer && f.authenticated) {
    findings.push({ level: 'WARN', lint: 'authenticated_security_definer_function_executable', object: sig });
  }
  if (!f.security_definer && f.anon) {
    findings.push({ level: 'INFO', lint: 'anon_function_executable', object: sig });
  }
}
for (const p of policies) {
  // auth.<fn>() fora de um SELECT é reavaliado por linha
  const bare = p.expr.replace(/\(\s*SELECT\s+auth\.\w+\(\)(\s+AS\s+\w+)?\s*\)/gi, '');
  if (/auth\.\w+\(\)/.test(bare)) findings.push({ level: 'WARN', lint: 'auth_rls_initplan', object: `${p.tablename}.${p.policyname}` });
}
for (const f of unindexedFks) findings.push({ level: 'INFO', lint: 'unindexed_foreign_keys', object: `${f.tbl}.${f.col}` });
for (const t of tables) {
  if (!t.rls) findings.push({ level: 'ERROR', lint: 'rls_disabled_in_public', object: t.name });
  else if (t.policies === 0) findings.push({ level: 'INFO', lint: 'rls_enabled_no_policy', object: t.name });
}

console.log('\nGRANTS DE EXECUTE (schema public)');
console.table(
  functions.map((f) => ({
    function: `${f.name}(${f.args})`,
    mode: f.security_definer ? 'DEFINER' : 'INVOKER',
    PUBLIC: f.public_grant,
    anon: f.anon,
    authenticated: f.authenticated,
    service_role: f.service_role,
  }))
);

console.log('RLS POR TABELA');
console.table(tables);

console.log('ACHADOS');
if (findings.length === 0) console.log('  nenhum');
else console.table(findings);

if (typeof args.json === 'string') {
  fs.writeFileSync(args.json, JSON.stringify({ functions, tables, findings }, null, 2));
  console.log(`Relatório salvo em ${args.json}`);
}

if (args.strict && functions.some((f) => f.anon)) {
  console.error('FALHA: anon possui EXECUTE em funções do schema public.');
  process.exit(1);
}
