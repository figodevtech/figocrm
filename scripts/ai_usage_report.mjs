// scripts/ai_usage_report.mjs
// Painel interno mínimo de custo de IA (lê ai_telemetry com a conexão direta do banco; nunca exposto ao app).
// Responde: quanto custa um usuário ativo? quem consome mais IA? a margem de R$ 24,90/mês se sustenta?
//
// Uso: npm run report:ai-usage -- [--days=30] [--top=10] [--json=arquivo]
// Premissas (env): USD_BRL (padrão 5.40, ajuste para o câmbio do dia), PLAN_PRICE_BRL (padrão 24.90).
// Custo de STT: US$ 0,006/min de áudio (whisper-1). Custo de LLM: estimated_cost_usd gravado na requisição
// (tabela de preços/LLM_PRICE_*_PER_1M do servidor) menos o STT.

import fs from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const days = Number(args.days ?? 30);
const top = Number(args.top ?? 10);
const usdBrl = Number(process.env.USD_BRL || 5.4);
const planBrl = Number(process.env.PLAN_PRICE_BRL || 24.9);

const client = new pg.Client({ connectionString: process.env.DATABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const perUser = (
  await client.query(
    `
    SELECT u.email,
           count(*)::int AS commands,
           count(*) FILTER (WHERE t.input_type = 'audio')::int AS audio_commands,
           round(coalesce(sum(t.audio_duration_seconds), 0)::numeric, 1)::float8 AS audio_seconds,
           coalesce(sum(t.prompt_tokens), 0)::int AS prompt_tokens,
           coalesce(sum(t.completion_tokens), 0)::int AS completion_tokens,
           round((coalesce(sum(t.audio_duration_seconds), 0) / 60 * 0.006)::numeric, 6)::float8 AS stt_cost_usd,
           round(coalesce(sum(t.estimated_cost_usd), 0)::numeric, 6)::float8 AS total_cost_usd,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_latency_ms)::int AS p50_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY t.total_latency_ms)::int AS p95_ms,
           round(100.0 * count(*) FILTER (WHERE t.interpretation_source = 'rules_fallback') / count(*), 1)::float8 AS fallback_pct,
           round(100.0 * count(*) FILTER (WHERE NOT t.success) / count(*), 1)::float8 AS error_pct
    FROM ai_telemetry t
    JOIN auth.users u ON u.id = t.user_id
    WHERE t.created_at >= NOW() - make_interval(days => $1)
    GROUP BY u.email
    ORDER BY total_cost_usd DESC
    `,
    [days]
  )
).rows.map((r) => ({ ...r, llm_cost_usd: Math.max(0, r.total_cost_usd - r.stt_cost_usd) }));

const [overall] = (
  await client.query(
    `SELECT count(*)::int AS commands,
            count(DISTINCT user_id)::int AS active_users,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY total_latency_ms)::int AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY total_latency_ms)::int AS p95_ms,
            coalesce(sum(estimated_cost_usd), 0)::float8 AS total_cost_usd,
            round(100.0 * count(*) FILTER (WHERE interpretation_source = 'rules_fallback') / greatest(count(*), 1), 1)::float8 AS fallback_pct,
            round(100.0 * count(*) FILTER (WHERE NOT success) / greatest(count(*), 1), 1)::float8 AS error_pct,
            string_agg(DISTINCT llm_model, ', ') AS models
     FROM ai_telemetry WHERE created_at >= NOW() - make_interval(days => $1)`,
    [days]
  )
).rows;
await client.end();

const perActiveUsd = overall.active_users ? overall.total_cost_usd / overall.active_users : 0;
const monthlyPerActiveBrl = perActiveUsd * (30 / days) * usdBrl;

console.log(`\nCUSTO DE IA — últimos ${days} dias`);
console.log('─'.repeat(60));
console.log(`Comandos: ${overall.commands} · usuários ativos: ${overall.active_users} · modelos: ${overall.models || '-'}`);
console.log(`Latência total p50 ${overall.p50_ms ?? '-'} ms · p95 ${overall.p95_ms ?? '-'} ms`);
console.log(`Fallback por regras: ${overall.fallback_pct}% · erros: ${overall.error_pct}%`);
console.log(`Custo total: US$ ${overall.total_cost_usd.toFixed(4)}`);
console.log(`Custo por usuário ativo: US$ ${perActiveUsd.toFixed(4)} no período ≈ R$ ${monthlyPerActiveBrl.toFixed(2)}/mês (câmbio ${usdBrl})`);
console.log(`Participação no plano de R$ ${planBrl.toFixed(2)}: ${planBrl ? ((monthlyPerActiveBrl / planBrl) * 100).toFixed(1) : '-'}%`);
console.log(`\nMaiores consumidores (top ${top}):`);
console.table(perUser.slice(0, top));

if (typeof args.json === 'string') {
  fs.writeFileSync(args.json, JSON.stringify({ days, usdBrl, planBrl, overall, perActiveUsd, monthlyPerActiveBrl, perUser }, null, 2));
  console.log(`Relatório salvo em ${args.json}`);
}
