// Relatório interno de custo por plano. Requer DATABASE_DIRECT_CONNECTION_STRING em .env.local.
// Uso: npm run report:ai-usage -- --days=30 --json=arquivo.json
// USD_BRL é uma estimativa configurável; estimated_cost_usd já inclui STT e LLM.
import fs from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const days = Number(args.days ?? 30);
const usdBrl = Number(process.env.USD_BRL || 5.4);
if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(usdBrl) || usdBrl <= 0)
  throw new Error('Parâmetros days ou USD_BRL inválidos.');

const client = new pg.Client({
  connectionString: process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  const { rows } = await client.query(`
    WITH accounts AS (
      SELECT s.user_id,
        CASE WHEN s.status = 'trialing' AND now() < s.trial_ends_at THEN 'trial_pro'
             WHEN s.status = 'active' AND now() <= s.current_period_end + interval '3 days'
               OR s.status = 'canceled' AND now() < s.current_period_end
               OR s.status = 'past_due' AND now() <= coalesce(s.past_due_at, s.updated_at) + interval '3 days'
               THEN CASE WHEN s.plan_code = 'figo_pro_plus_mensal' THEN 'pro_plus' ELSE 'pro' END
             ELSE 'free' END AS plan,
        CASE WHEN s.status = 'active' AND now() <= s.current_period_end + interval '3 days'
             THEN s.price_cents ELSE 0 END AS revenue_cents
      FROM public.subscriptions s
    ), usage AS (
      SELECT t.user_id, count(*)::int AS commands,
        count(*) FILTER (WHERE t.input_type = 'audio')::int AS voice_commands,
        coalesce(sum(t.audio_duration_seconds), 0)::float8 / 60 AS audio_minutes,
        coalesce(sum(t.prompt_tokens), 0)::bigint AS input_tokens,
        coalesce(sum(t.completion_tokens), 0)::bigint AS output_tokens,
        coalesce(sum(t.estimated_cost_usd), 0)::float8 AS ai_cost_usd
      FROM public.ai_telemetry t
      WHERE t.created_at >= now() - make_interval(days => $1)
      GROUP BY t.user_id
    )
    SELECT a.plan, count(*)::int AS users,
      count(*) FILTER (WHERE u.commands > 0)::int AS active_users,
      coalesce(sum(u.commands), 0)::int AS commands,
      coalesce(sum(u.voice_commands), 0)::int AS voice_commands,
      coalesce(sum(u.audio_minutes), 0)::float8 AS audio_minutes,
      coalesce(sum(u.input_tokens), 0)::bigint AS input_tokens,
      coalesce(sum(u.output_tokens), 0)::bigint AS output_tokens,
      coalesce(sum(u.ai_cost_usd), 0)::float8 AS ai_cost_usd,
      coalesce(sum(a.revenue_cents), 0)::int AS revenue_cents
    FROM accounts a LEFT JOIN usage u ON u.user_id = a.user_id
    GROUP BY a.plan ORDER BY a.plan`, [days]);
  const byPlan = rows.map((row) => {
    const monthlyAiCostBrl = row.ai_cost_usd * usdBrl * 30 / days;
    const revenueBrl = row.revenue_cents / 100;
    return {
      ...row,
      input_tokens: Number(row.input_tokens),
      output_tokens: Number(row.output_tokens),
      audio_minutes: Number(row.audio_minutes.toFixed(2)),
      ai_cost_usd: Number(row.ai_cost_usd.toFixed(4)),
      revenue_brl_estimated: Number(revenueBrl.toFixed(2)),
      monthly_ai_cost_brl_estimated: Number(monthlyAiCostBrl.toFixed(2)),
      ai_cost_per_user_brl: row.users ? Number((monthlyAiCostBrl / row.users).toFixed(2)) : 0,
      gross_margin_per_user_brl: row.users ? Number(((revenueBrl - monthlyAiCostBrl) / row.users).toFixed(2)) : 0,
      price_consumed_by_ai_pct: revenueBrl ? Number((monthlyAiCostBrl / revenueBrl * 100).toFixed(1)) : null,
    };
  });
  console.log(`Custo de IA por plano — últimos ${days} dias; câmbio estimado ${usdBrl} BRL/USD`);
  console.table(byPlan);
  if (typeof args.json === 'string') fs.writeFileSync(args.json, JSON.stringify({ days, usdBrl, byPlan }, null, 2));
} finally {
  await client.end();
}
