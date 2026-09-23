// tests/e2e/finance-ops.e2e.ts
// Estorno financeiro, renegociação e equivalência manual = voz contra o Supabase real,
// pelo mesmo pipeline de produção (runVoicePipeline) e pelo mesmo executor das ações manuais.
// E2E_INTERPRETER=llm | rules | auto (padrão: LLM se houver chave).

import assert from 'assert';
import { createTestUser, run, seedItem, sql, test, TestUser } from './helpers';
import { runVoicePipeline, VoiceProcessResult } from '../../src/lib/ai/orchestrator';
import { interpretVoiceCommandWithLLM, InterpretMode } from '../../src/lib/ai/interpret';
import { isLLMConfigured } from '../../src/lib/ai/provider';
import { reverseSettlement } from '../../src/lib/domain/financial-operations';
import { LLMProviderError } from '../../src/lib/ai/provider';
import { executeDealCommand } from '../../src/lib/domain/command-executor';
import { buildManualTradeCommand } from '../../src/lib/domain/manual-deal-commands';

const requested = (process.env.E2E_INTERPRETER || 'auto').toLowerCase();
const mode: InterpretMode = requested === 'rules' ? 'rules_only' : requested === 'llm' ? 'llm_required' : 'auto';
const label = mode === 'rules_only' || !isLLMConfigured() ? 'parser determinístico' : 'LLM real';

let user: TestUser;
const ids: Record<string, string> = {};

async function say(text: string): Promise<VoiceProcessResult> {
  const res = await runVoicePipeline(text, { supabase: user.client, userId: user.id, interpret: (t, ctx) => interpretVoiceCommandWithLLM(t, ctx, { mode }) });
  console.log(`      > "${text}"\n      < [${res.assistant.status}] ${res.humanResponse}`);
  return res;
}

type Inst = { id: string; installment_number: number; original_value: number; paid_value: number; adjusted_value: number; renegotiated_value: number; balance: number; status: string; due_date: string; renegotiation_id: string | null };
const installments = () =>
  sql<Inst>(
    `SELECT id, installment_number, original_value::float8, paid_value::float8, adjusted_value::float8, renegotiated_value::float8,
            balance::float8, status, due_date::text, renegotiation_id FROM installments WHERE receivable_id = $1 ORDER BY installment_number`,
    [ids.receivable]
  );
const receivable = async () => (await sql<{ balance: number; paid: number; adjusted: number; status: string; total: number }>(
  `SELECT balance::float8, paid_amount::float8 AS paid, adjusted_amount::float8 AS adjusted, status, total_amount::float8 AS total FROM receivables WHERE id = $1`,
  [ids.receivable]
))[0];

test(`setup + negócio canônico por voz (interpretador: ${label})`, async () => {
  user = await createTestUser('finops');
  ids.xre = await seedItem(user, 'Honda XRE 300', 20000);
  ids.lander = await seedItem(user, 'Yamaha Lander 250', 18000);
  const res = await say('Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.');
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  assert.strictEqual(res.assistant.status === 'executed' && res.assistant.undoAvailable, false, 'negócio ainda não tem desfazer automático');
  ids.deal = res.dealId!;
  ids.receivable = (await sql<{ id: string; customer_id: string }>('SELECT id, customer_id FROM receivables WHERE deal_id = $1', [ids.deal]))[0].id;
  ids.carlos = (await sql<{ customer_id: string }>('SELECT customer_id FROM receivables WHERE id = $1', [ids.receivable]))[0].customer_id;
});

test('pagamento devolve operationId e desfazer por voz estorna sem apagar histórico', async () => {
  const pay = await say('Ele mandou 500 daquela primeira.');
  assert.strictEqual(pay.assistant.status, 'executed');
  assert.ok(pay.assistant.status === 'executed' && pay.assistant.undoAvailable && pay.assistant.operationId, 'pagamento tem desfazer');
  ids.payment1 = (pay.assistant as { operationId: string }).operationId;

  const undo = await say('Desfaz aquele pagamento de 500 do Carlos.');
  assert.strictEqual(undo.assistant.status, 'executed', undo.humanResponse);
  assert.match(undo.humanResponse, /Desfiz o pagamento de R\$ 500/);

  const [p1] = await installments();
  assert.strictEqual(p1.paid_value, 0);
  assert.strictEqual(p1.balance, 2000);
  assert.strictEqual((await receivable()).balance, 8000);

  const payments = await sql<{ amount: number; reversal_of: string | null }>('SELECT amount::float8, reversal_of FROM payments WHERE user_id = $1 ORDER BY created_at', [user.id]);
  assert.deepStrictEqual(payments.map((p) => p.amount), [500, -500], 'original preservado + estorno negativo');
  assert.ok(payments[1].reversal_of);

  const cash = await sql<{ direction: string; amount: number; reversal_of: string | null }>(
    'SELECT direction, amount::float8, reversal_of FROM cash_movements WHERE settlement_id IS NOT NULL AND user_id = $1 ORDER BY created_at', [user.id]);
  assert.deepStrictEqual(cash.map((c) => [c.direction, c.amount]), [['IN', 500], ['OUT', 500]], 'caixa compensado');

  const audit = await sql<{ action_type: string }>(`SELECT action_type FROM audit_log WHERE user_id = $1 AND action_type = 'REVERSE_SETTLEMENT'`, [user.id]);
  assert.strictEqual(audit.length, 1);
});

test('estornar de novo é idempotente e estornar o estorno é bloqueado', async () => {
  const again = await reverseSettlement(user.client, { settlementId: ids.payment1, source: 'manual' });
  assert.strictEqual(again.success, true);
  assert.strictEqual(again.alreadyReversed, true);
  const count = await sql<{ n: number }>('SELECT count(*)::int AS n FROM payments WHERE user_id = $1', [user.id]);
  assert.strictEqual(count[0].n, 2, 'nenhum estorno duplicado');

  const reversal = (await sql<{ id: string }>('SELECT id FROM settlements WHERE reversal_of = $1', [ids.payment1]))[0].id;
  const nested = await reverseSettlement(user.client, { settlementId: reversal, source: 'manual' });
  assert.strictEqual(nested.success, false);
});

test('abatimento e estorno do abatimento (sem caixa)', async () => {
  const adj = await say('Abate mil porque ele ficou com meu som.');
  assert.strictEqual(adj.assistant.status, 'executed', adj.humanResponse);
  assert.strictEqual((await receivable()).balance, 7000);

  const cashBefore = (await sql<{ n: number }>('SELECT count(*)::int AS n FROM cash_movements WHERE user_id = $1', [user.id]))[0].n;
  const undo = await say('Estorna o abatimento de mil do Carlos.');
  assert.strictEqual(undo.assistant.status, 'executed', undo.humanResponse);
  const rec = await receivable();
  assert.strictEqual(rec.balance, 8000);
  assert.strictEqual(rec.adjusted, 0);
  const cashAfter = (await sql<{ n: number }>('SELECT count(*)::int AS n FROM cash_movements WHERE user_id = $1', [user.id]))[0].n;
  assert.strictEqual(cashAfter, cashBefore, 'estorno de abatimento não mexe no caixa');
});

test('renegociação que não fecha pergunta e não altera nada', async () => {
  await sql(`UPDATE installments SET due_date = CURRENT_DATE - (10 * installment_number), status = 'overdue' WHERE receivable_id = $1 AND installment_number IN (1, 2)`, [ids.receivable]);
  const pay = await say('O Carlos pagou 500 da primeira.');
  assert.strictEqual(pay.assistant.status, 'executed', pay.humanResponse);
  ids.payment2 = (pay.assistant as { operationId: string }).operationId;

  const before = await installments();
  const res = await say('Junta as duas atrasadas do Carlos e faz quatro de 500 todo dia 10.');
  assert.strictEqual(res.assistant.status, 'needs_input', res.humanResponse);
  assert.match(res.humanResponse, /somam R\$ 3\.500/);
  assert.deepStrictEqual(await installments(), before, 'nada muda quando a conta não fecha');
});

test('renegociação 2 parcelas atrasadas → 7 de 500 todo dia 10, histórico preservado', async () => {
  const res = await say('Junta as duas atrasadas do Carlos e faz sete de 500 todo dia 10.');
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);

  const all = await installments();
  const old = all.filter((i) => i.installment_number <= 2);
  const kept = all.filter((i) => i.installment_number > 2 && !i.renegotiation_id);
  const fresh = all.filter((i) => i.renegotiation_id);
  assert.ok(old.every((i) => i.status === 'renegotiated' && i.balance === 0), 'parcelas antigas marcadas, não apagadas');
  assert.deepStrictEqual(old.map((i) => i.renegotiated_value), [1500, 2000]);
  assert.strictEqual(old[0].paid_value, 500, 'pagamento anterior preservado');
  assert.strictEqual(kept.length, 2);
  assert.strictEqual(fresh.length, 7);
  assert.ok(fresh.every((i) => i.original_value === 500 && i.due_date.endsWith('-10')));
  assert.ok(fresh[0].due_date > new Date().toISOString().slice(0, 10));

  const rec = await receivable();
  assert.strictEqual(rec.total, 8000, 'total da dívida não muda');
  assert.strictEqual(rec.balance, 7500, 'saldo = 8000 − 500 pago');

  const reneg = await sql<{ old_installment_ids: string[]; new_installment_ids: string[]; renegotiated_amount: number }>(
    'SELECT old_installment_ids, new_installment_ids, renegotiated_amount::float8 FROM renegotiations WHERE receivable_id = $1', [ids.receivable]);
  assert.strictEqual(reneg.length, 1);
  assert.strictEqual(reneg[0].old_installment_ids.length, 2);
  assert.strictEqual(reneg[0].new_installment_ids.length, 7);
  assert.strictEqual(reneg[0].renegotiated_amount, 3500);
});

test('pagamento em parcela já renegociada não pode ser estornado (nada muda)', async () => {
  const outcome = await reverseSettlement(user.client, { settlementId: ids.payment2, source: 'manual' });
  assert.strictEqual(outcome.success, false);
  assert.strictEqual(outcome.installmentReplaced, true);
  assert.strictEqual((await receivable()).balance, 7500);
});

test('pagamento depois da renegociação cai nas parcelas novas', async () => {
  const res = await say('O Carlos pagou 500.');
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  const fresh = (await installments()).filter((i) => i.renegotiation_id);
  assert.strictEqual(fresh[0].paid_value, 500, 'primeira parcela nova (vencimento mais próximo)');
  assert.strictEqual((await receivable()).balance, 7000);
});

test('LLM indisponível: fallback lê de volta e só grava com "sim"; "não" descarta', async () => {
  const down = async () => { throw new LLMProviderError('timeout', 'teste'); };
  const sayDown = (text: string) =>
    runVoicePipeline(text, { supabase: user.client, userId: user.id, interpret: (t, ctx) => interpretVoiceCommandWithLLM(t, ctx, { llm: down }) });
  const before = (await receivable()).balance;

  const ask = await sayDown('O Carlos pagou 200 no pix.');
  assert.strictEqual(ask.assistant.status, 'needs_input');
  assert.match(ask.humanResponse, /^Entendi: recebimento de R\$ 200 do Carlos no Pix\. Confirma\?$/);
  assert.strictEqual((await receivable()).balance, before, 'nada gravado antes de confirmar');

  const yes = await sayDown('sim');
  assert.strictEqual(yes.assistant.status, 'executed', yes.humanResponse);
  assert.strictEqual((await receivable()).balance, before - 200);

  await sayDown('O Carlos pagou 100 no pix.');
  const no = await sayDown('não, tá errado');
  assert.strictEqual(no.assistant.status, 'needs_input');
  assert.match(no.humanResponse, /não lancei nada/);
  assert.strictEqual((await receivable()).balance, before - 200);
});

test('manual = voz: a mesma troca pelo formulário produz a mesma estrutura financeira', async () => {
  const built = buildManualTradeCommand({
    customerId: ids.carlos, itemOutId: ids.lander, itemIn: { name: 'Bros', evaluatedValue: 15000 }, tradeBalance: 11000,
    direction: 'received', immediateCash: 3000, immediatePaymentMethod: 'pix', installments: { count: 4, value: 2000, dueDay: 15 },
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  const res = await executeDealCommand(built.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' });
  assert.ok(res.success, res.humanSummary);

  const shape = async (dealId: string) => {
    const [deal] = await sql<Record<string, unknown>>('SELECT deal_type, total_value::float8, customer_id, status FROM deals WHERE id = $1', [dealId]);
    const items = await sql('SELECT direction, evaluated_value::float8 FROM deal_items WHERE deal_id = $1 ORDER BY direction', [dealId]);
    const cash = await sql(`SELECT direction, amount::float8, payment_method FROM cash_movements WHERE deal_id = $1 AND settlement_id IS NULL ORDER BY amount`, [dealId]);
    const rec = await sql('SELECT total_amount::float8, customer_id FROM receivables WHERE deal_id = $1', [dealId]);
    const inst = await sql(`SELECT installment_number, original_value::float8 FROM installments i JOIN receivables r ON r.id = i.receivable_id
                            WHERE r.deal_id = $1 AND i.renegotiation_id IS NULL ORDER BY installment_number`, [dealId]);
    const audit = await sql(`SELECT action_type FROM audit_log WHERE entity_id = $1`, [dealId]);
    return { deal, items, cash, rec, inst, audit };
  };
  const voice = await shape(ids.deal);
  const manual = await shape(res.dealId!);
  assert.deepStrictEqual(manual, voice);
  const due = await sql<{ due_date: string }>(`SELECT i.due_date::text FROM installments i JOIN receivables r ON r.id = i.receivable_id WHERE r.deal_id = $1`, [res.dealId]);
  assert.ok(due.every((d) => d.due_date.endsWith('-15')), 'mesmo dia de vencimento');
  const [src] = await sql<{ source: string }>('SELECT source FROM deals WHERE id = $1', [res.dealId]);
  assert.strictEqual(src.source, 'manual');
});

run('E2E: ESTORNO, RENEGOCIAÇÃO E MANUAL = VOZ');
