import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const poolerUrl = `postgresql://postgres.wjtsxomfezrqwdnnxcuh:${process.env.DATABASE_PASSWORD}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;

const client = new pg.Client({
  connectionString: poolerUrl,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('Conectado ao Supabase via Pooler IPv4 com sucesso!');
  
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('Tabelas existentes no schema public:');
  console.log(tables.rows.map(r => r.table_name));

  const mig = await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') as has_mig");
  console.log('supabase_migrations existe?', mig.rows[0].has_mig !== null);

  if (mig.rows[0].has_mig) {
    const migRows = await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version");
    console.log('Migrations registradas:', migRows.rows.map(r => r.version));
  }

  const func = await client.query(`
    SELECT proname, prosrc, prosecdef, proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND proname IN ('handle_updated_at', 'handle_new_user', 'handle_installment_payment_received', 'get_dashboard_indicators', 'update_overdue_installments')
  `);
  console.log('Funções e suas configurações:');
  for (const f of func.rows) {
    console.log(`- ${f.proname}: secdef=${f.prosecdef}, config=${JSON.stringify(f.proconfig)}`);
  }

  await client.end();
}

main().catch(err => {
  console.error('Erro na inspeção:', err);
  process.exit(1);
});
