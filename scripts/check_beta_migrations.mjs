// Executa as migrations beta em uma transação descartada para validar SQL sem alterar o banco.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const connectionString = process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente.');

const files = [
  '20260924113532_derive_deal_profit_from_cmv.sql',
  '20260924114640_loan_document_snapshots.sql',
];
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  for (const file of files) {
    const sql = await fs.readFile(path.join('supabase', 'migrations', file), 'utf8');
    await client.query(sql);
    console.log(`SQL validado: ${file}`);
  }
  const { rows: [grants] } = await client.query("SELECT has_column_privilege('authenticated', 'public.deals', 'total_value', 'UPDATE') AS price_update, has_column_privilege('authenticated', 'public.deals', 'recognized_profit', 'UPDATE') AS profit_update, has_table_privilege('authenticated', 'public.deals', 'DELETE') AS deal_delete");
  assert.deepEqual(grants, { price_update: false, profit_update: true, deal_delete: false });
  const { rows: profiles } = await client.query('SELECT id FROM public.profiles LIMIT 1');
  if (profiles[0]) {
    const userId = profiles[0].id;
    const customer = (await client.query("INSERT INTO public.customers(user_id, name) VALUES ($1, 'Teste rollback') RETURNING id", [userId])).rows[0].id;
    const item = (await client.query("INSERT INTO public.items(user_id, name, acquisition_cost) VALUES ($1, 'Mercadoria rollback', 2000) RETURNING id", [userId])).rows[0].id;
    const deal = (await client.query("INSERT INTO public.deals(user_id, customer_id, deal_type, total_value, recognized_profit) VALUES ($1, $2, 'venda', 3000, 50000) RETURNING id", [userId, customer])).rows[0].id;
    const state = async () => (await client.query('SELECT recognized_profit, profit_pending FROM public.deals WHERE id = $1', [deal])).rows[0];
    assert.deepEqual([Number((await state()).recognized_profit), (await state()).profit_pending], [0, true]);
    await client.query("INSERT INTO public.deal_items(deal_id, item_id, direction) VALUES ($1, $2, 'OUT')", [deal, item]);
    assert.equal(Number((await state()).recognized_profit), 1000);
    await client.query("INSERT INTO public.item_costs(user_id, item_id, category, description, amount) VALUES ($1, $2, 'reparo', 'Teste', 150)", [userId, item]);
    assert.equal(Number((await state()).recognized_profit), 850);
    await client.query('UPDATE public.deals SET recognized_profit = 99999 WHERE id = $1', [deal]);
    assert.equal(Number((await state()).recognized_profit), 850);
    await client.query('UPDATE public.items SET cost_pending = true WHERE id = $1', [item]);
    assert.deepEqual([Number((await state()).recognized_profit), (await state()).profit_pending], [0, true]);
    await client.query('UPDATE public.items SET cost_pending = false WHERE id = $1', [item]);
    assert.deepEqual([Number((await state()).recognized_profit), (await state()).profit_pending], [850, false]);
    console.log('Lucro derivado, custos adicionais e custo pendente validados; todos os dados serão revertidos.');
  }
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
