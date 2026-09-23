// scripts/apply_migrations.mjs
// Executor e Rastreador de Migrations do Supabase (Fase A)
// Garante sincronia 100% entre Git, supabase_migrations.schema_migrations e o banco real

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env.local prioritariamente, com fallback para .env
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { Client } = pg;

const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('\x1b[31m%s\x1b[0m', 'Erro: DATABASE_DIRECT_CONNECTION_STRING ou DATABASE_URL não foi definida.');
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', 'Iniciando aplicação e sincronização de migrations no Supabase...');
console.log(`Conectando em: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);

const client = new Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 15000,
});

async function runMigrations() {
  try {
    await client.connect();
    console.log('\x1b[32m%s\x1b[0m', '✓ Conexão estabelecida com sucesso no PostgreSQL!');

    // 1. Assegura a existência do schema e tabela oficial de migrations do Supabase
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version TEXT PRIMARY KEY,
        statements TEXT[],
        name TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Busca versões já aplicadas
    const appliedRes = await client.query('SELECT version FROM supabase_migrations.schema_migrations');
    const appliedVersions = new Set(appliedRes.rows.map((r) => r.version));

    const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    console.log(`\nEncontradas ${files.length} migrations no repositório:\n`);

    for (const file of files) {
      const version = file.split('_')[0];
      const name = file.replace(`${version}_`, '').replace('.sql', '');

      const isAlreadyApplied = appliedVersions.has(version);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      if (!isAlreadyApplied) {
        console.log(`  -> Aplicando ${file}...`);
        const startTime = Date.now();

        await client.query('BEGIN');
        try {
          await client.query(sql);

          // Registra ou atualiza na tabela oficial de migrations
          await client.query(`
            INSERT INTO supabase_migrations.schema_migrations (version, name, inserted_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (version) DO UPDATE SET inserted_at = NOW();
          `, [version, name]);

          await client.query('COMMIT');
          const duration = Date.now() - startTime;
          console.log(`  \x1b[32m✓\x1b[0m ${file} aplicada e registrada com sucesso (${duration}ms)`);
        } catch (sqlError) {
          await client.query('ROLLBACK');
          console.error(`  \x1b[31m✗\x1b[0m Falha ao executar ${file}:`);
          console.error(sqlError);
          throw sqlError;
        }
      } else {
        console.log(`  \x1b[90m-\x1b[0m ${file} (já aplicada previamente)`);
      }
    }

    console.log('\n\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
    console.log('\x1b[32m%s\x1b[0m', '  SINCRONIZAÇÃO DE MIGRATIONS CONCLUÍDA COM SUCESSO!         ');
    console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════\n');

    // Validação de hardening das funções
    const funcRes = await client.query(`
      SELECT proname, proconfig, prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' 
        AND proname IN (
          'handle_updated_at',
          'handle_new_user',
          'handle_installment_payment_received',
          'get_dashboard_indicators',
          'update_overdue_installments',
          'execute_deal_transaction'
        );
    `);

    console.log('\x1b[33m%s\x1b[0m', 'Verificação de Hardening das Funções:');
    for (const f of funcRes.rows) {
      const configStr = f.proconfig ? f.proconfig.join(', ') : 'SEM SEARCH_PATH';
      const secDefStr = f.prosecdef ? 'SECURITY DEFINER' : 'INVOKER';
      console.log(`  - ${f.proname}: [${secDefStr}] [search_path: ${configStr}]`);
    }

  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '\nFalha na execução das migrations:');
    console.error(error.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
