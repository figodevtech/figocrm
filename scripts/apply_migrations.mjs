// scripts/apply_migrations.mjs
// Executor de Migrations para o PostgreSQL do Supabase

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env da raiz do projeto
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Client } = pg;

const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING;
const password = process.env.DATABASE_PASSWORD;

if (!connectionString) {
  console.error('\x1b[31m%s\x1b[0m', 'Erro: DATABASE_DIRECT_CONNECTION_STRING não foi definida no .env');
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', 'Iniciando aplicação das migrations no Supabase...');
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
    console.log('\x1b[32m%s\x1b[0m', 'Conexão estabelecida com sucesso no PostgreSQL!');

    const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    console.log(`\nEncontradas ${files.length} migrations:\n`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`  -> Executando ${file}...`);
      const startTime = Date.now();

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        const duration = Date.now() - startTime;
        console.log(`  \x1b[32m✓\x1b[0m ${file} aplicada com sucesso em ${duration}ms`);
      } catch (sqlError) {
        await client.query('ROLLBACK');
        console.error(`  \x1b[31m✗\x1b[0m Falha ao executar ${file}:`);
        console.error(sqlError);
        throw sqlError;
      }
    }

    console.log('\n\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
    console.log('\x1b[32m%s\x1b[0m', '  TODAS AS MIGRATIONS FORAM APLICADAS COM SUCESSO NO BANCO!   ');
    console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════\n');

    // Validação: Listar tabelas criadas no schema public
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log('\x1b[33m%s\x1b[0m', `Tabelas ativas no schema public (${res.rows.length}):`);
    for (const row of res.rows) {
      console.log(`  - ${row.table_name}`);
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
