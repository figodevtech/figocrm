// tests/e2e/multiturn-db.e2e.ts
// Fase I — diálogo multi-turn ponta a ponta contra o Supabase real, usando o MESMO pipeline de
// produção (runVoicePipeline): interpretação → resolução → RPC atômica → contexto persistido.
//
// Interpretador: E2E_INTERPRETER=llm (exige OPENAI_API_KEY/GEMINI_API_KEY) | rules | auto (padrão:
// LLM se houver chave, senão parser determinístico). O modo usado é impresso no início.
//
// Distratores: outro cliente (João) com parcela ATRASADA e mais antiga, e homônimos/itens parecidos,
// para provar que nenhum pagamento cai na dívida errada.

import assert from 'assert';
import { createTestUser, run, seedCustomer, seedItem, test, TestUser } from './helpers';
import { runVoicePipeline, VoiceProcessResult } from '../../src/lib/ai/orchestrator';
import { interpretVoiceCommandWithLLM, InterpretMode } from '../../src/lib/ai/interpret';
import { isLLMConfigured } from '../../src/lib/ai/provider';

const requested = (process.env.E2E_INTERPRETER || 'auto').toLowerCase();
const mode: InterpretMode = requested === 'rules' ? 'rules_only' : requested === 'llm' ? 'llm_required' : 'auto';
if (mode === 'llm_required' && !isLLMConfigured()) {
  console.error('E2E_INTERPRETER=llm exige OPENAI_API_KEY ou GEMINI_API_KEY.');
  process.exit(2);
}
const interpreterLabel = mode === 'rules_only' || !isLLMConfigured() ? 'parser determinístico (fallback)' : 'LLM real';

let user: TestUser;
const ids: Record<string, string> = {};

async function say(text: string): Promise<VoiceProcessResult> {
  const res = await runVoicePipeline(text, {
    supabase: user.client,
    userId: user.id,
    interpret: (t, ctx) => interpretVoiceCommandWithLLM(t, ctx, { mode }),
  });
  console.log(`      > "${text}"\n      < [${res.executionStatus}/${res.metrics.interpretationSource}] ${res.humanResponse}`);
  return res;
}

async function one<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('registro não encontrado');
  return data as NonNullable<T>;
}

type Inst = { installment_number: number; original_value: number; paid_value: number; adjusted_value: number; balance: number; status: string; due_date: string };

async function carlosInstallments(): Promise<Inst[]> {
  const rows = await one(
    user.client
      .from('installments')
      .select('installment_number, original_value, paid_value, adjusted_value, balance, status, due_date')
      .eq('receivable_id', ids.carlosReceivable)
      .order('installment_number')
  );
  return (rows as Inst[]).map((r) => ({
    ...r,
    original_value: Number(r.original_value),
    paid_value: Number(r.paid_value),
    adjusted_value: Number(r.adjusted_value),
    balance: Number(r.balance),
  }));
}

async function receivable(id: string) {
  const r = await one(user.client.from('receivables').select('total_amount, paid_amount, adjusted_amount, balance, status').eq('id', id).single());
  return {
    total: Number(r.total_amount),
    paid: Number(r.paid_amount),
    adjusted: Number(r.adjusted_amount),
    balance: Number(r.balance),
    status: r.status as string,
  };
}

async function countRows(table: string, filter: Record<string, string> = {}): Promise<number> {
  let q = user.client.from(table).select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

test(`setup: usuário de teste, estoque e dívida distratora de João (interpretador: ${interpreterLabel})`, async () => {
  user = await createTestUser('multiturn');
  ids.xre = await seedItem(user, 'Honda XRE 300', 20000);
  ids.iphonePreto = await seedItem(user, 'iPhone 13 Preto', 2500);
  ids.iphoneAzul = await seedItem(user, 'iPhone 13 Azul', 2600);

  // João tem parcela atrasada e mais antiga que qualquer parcela do Carlos
  ids.joao = await seedCustomer(user, 'João Pereira');
  const joaoItem = await seedItem(user, 'Celta 2010', 9000);
  const { data, error } = await user.client.rpc('execute_deal_transaction', {
    p_payload: {
      customer_id: ids.joao,
      deal_type: 'venda',
      total_value: 12000,
      source: 'manual',
      items_out: [{ item_id: joaoItem, evaluated_value: 12000 }],
      receivables: [{
        total_amount: 12000,
        installments: [
          { installment_number: 1, total_installments: 2, original_value: 6000, due_date: '2026-01-10' },
          { installment_number: 2, total_installments: 2, original_value: 6000, due_date: '2026-02-10' },
        ],
      }],
    },
  });
  assert.ifError(error);
  ids.joaoReceivable = (data as { receivable_ids: string[] }).receivable_ids[0];
});

test('Turno 1 — troca XRE × Bros com entrada no Pix e 4 parcelas todo dia 15', async () => {
  const res = await say(
    'Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.'
  );
  assert.strictEqual(res.executionStatus, 'executed', res.humanResponse);
  assert.ok(res.dealId);
  ids.deal = res.dealId!;

  const deal = await one(user.client.from('deals').select('deal_type, total_value, customer_id, source, customers(name)').eq('id', ids.deal).single());
  assert.strictEqual(deal.deal_type, 'troca');
  assert.strictEqual(Number(deal.total_value), 26000);
  assert.strictEqual(deal.source, 'voice');
  assert.strictEqual((deal.customers as unknown as { name: string }).name, 'Carlos');
  ids.carlos = deal.customer_id;

  const dealItems = await one(user.client.from('deal_items').select('direction, evaluated_value, item_id, items(name, status, acquisition_cost)').eq('deal_id', ids.deal));
  const out = dealItems.find((d) => d.direction === 'OUT')!;
  const inn = dealItems.find((d) => d.direction === 'IN')!;
  assert.strictEqual(out.item_id, ids.xre, 'XRE OUT deve ser a mercadoria do estoque');
  assert.strictEqual(Number(out.evaluated_value), 26000);
  assert.strictEqual((out.items as unknown as { status: string }).status, 'vendido');
  assert.match((inn.items as unknown as { name: string }).name, /bros/i, 'Bros IN');
  assert.strictEqual(Number(inn.evaluated_value), 15000);
  assert.strictEqual(Number((inn.items as unknown as { acquisition_cost: number }).acquisition_cost), 15000);

  const cash = await one(user.client.from('cash_movements').select('direction, amount').eq('deal_id', ids.deal));
  assert.deepStrictEqual(cash.map((c) => [c.direction, Number(c.amount)]), [['IN', 3000]], 'cash IN 3000');

  const rec = await one(user.client.from('receivables').select('id, total_amount, customer_id').eq('deal_id', ids.deal).single());
  assert.strictEqual(Number(rec.total_amount), 8000, 'receivable 8000');
  assert.strictEqual(rec.customer_id, ids.carlos);
  ids.carlosReceivable = rec.id;

  const insts = await carlosInstallments();
  assert.strictEqual(insts.length, 4, '4 parcelas');
  assert.ok(insts.every((i) => i.original_value === 2000), 'parcelas de 2000');
  assert.ok(insts.every((i) => i.due_date.endsWith('-15')), 'vencimento dia 15');
  assert.ok(insts[0].due_date > new Date().toISOString().slice(0, 10), 'primeira parcela no futuro');

  const ctx = await one(user.client.from('conversation_context').select('last_customer_id, last_deal_id, last_receivable_id, last_item_id').eq('user_id', user.id).single());
  assert.strictEqual(ctx.last_customer_id, ids.carlos, 'contexto guarda o ID real do cliente');
  assert.strictEqual(ctx.last_deal_id, ids.deal);
  assert.strictEqual(ctx.last_receivable_id, ids.carlosReceivable);
  assert.strictEqual(ctx.last_item_id, ids.xre);
});

test('Turno 2 — "Ele mandou 500 daquela primeira" cai na parcela 1 do Carlos (não na do João)', async () => {
  const cashBefore = await countRows('cash_movements');
  const res = await say('Ele mandou 500 daquela primeira.');
  assert.strictEqual(res.executionStatus, 'executed', res.humanResponse);

  const [p1] = await carlosInstallments();
  assert.strictEqual(p1.original_value, 2000);
  assert.strictEqual(p1.paid_value, 500);
  assert.strictEqual(p1.balance, 1500);
  assert.strictEqual(p1.status, 'partially_paid');

  const joao = await receivable(ids.joaoReceivable);
  assert.strictEqual(joao.balance, 12000, 'dívida do João intacta');
  assert.strictEqual(await countRows('payments'), 1, 'histórico: 1 pagamento');
  assert.strictEqual(await countRows('cash_movements'), cashBefore + 1, 'pagamento gera movimento de caixa');
});

test('Turno 3 — "Abate mil porque ele ficou com meu som" gera abatimento item_offset sem caixa', async () => {
  const cashBefore = await countRows('cash_movements');
  const res = await say('Abate mil porque ele ficou com meu som.');
  assert.strictEqual(res.executionStatus, 'executed', res.humanResponse);

  const adjustments = await one(user.client.from('adjustments').select('amount, adjustment_type, installment_id, deal_id').eq('user_id', user.id));
  assert.strictEqual(adjustments.length, 1);
  assert.strictEqual(Number(adjustments[0].amount), 1000, 'adjustment = 1000');
  assert.strictEqual(adjustments[0].adjustment_type, 'item_trade_in', 'tipo item_offset (item_trade_in no banco)');
  assert.strictEqual(adjustments[0].deal_id, ids.deal);
  assert.strictEqual(await countRows('cash_movements'), cashBefore, 'abatimento NÃO movimenta caixa');

  const rec = await receivable(ids.carlosReceivable);
  assert.strictEqual(rec.balance, 6500, 'saldo 8000 − 500 − 1000');
  assert.strictEqual(rec.adjusted, 1000);
  assert.strictEqual(rec.paid, 500);
});

test('Turno 4 — "Ele quitou o resto" zera a dívida do Carlos', async () => {
  const res = await say('Ele quitou o resto.');
  assert.strictEqual(res.executionStatus, 'executed', res.humanResponse);

  const rec = await receivable(ids.carlosReceivable);
  assert.strictEqual(rec.balance, 0, 'saldo total = 0');
  assert.strictEqual(rec.status, 'paid');
  assert.strictEqual(rec.paid + rec.adjusted, 8000);

  const insts = await carlosInstallments();
  assert.ok(insts.every((i) => i.status === 'paid' && i.balance === 0), 'todas as parcelas quitadas');

  const cash = await one(user.client.from('cash_movements').select('amount').eq('deal_id', ids.deal).order('created_at'));
  assert.deepStrictEqual(cash.map((c) => Number(c.amount)), [3000, 500, 6500]);

  const joao = await receivable(ids.joaoReceivable);
  assert.strictEqual(joao.balance, 12000, 'dívida do João continua intacta');

  const audit = await one(user.client.from('audit_log').select('action_type').eq('user_id', user.id));
  const actions = audit.map((a) => a.action_type).sort();
  assert.deepStrictEqual(
    actions.filter((a) => a !== 'EXECUTE_DEAL_TRANSACTION_ATOMIC'),
    ['REGISTER_ADJUSTMENT', 'REGISTER_PAYMENT', 'REGISTER_PAYMENT'],
    'auditoria de cada operação'
  );
});

test('Homônimos: "João pagou 500" com João Silva e João Santos pergunta e não grava nada', async () => {
  ids.joaoSilva = await seedCustomer(user, 'João Silva');
  ids.joaoSantos = await seedCustomer(user, 'João Santos');
  // João Pereira (com dívida), João Silva e João Santos: "João" casa com os três
  const paymentsBefore = await countRows('payments');

  const res = await say('O João pagou 500 no Pix.');
  assert.strictEqual(res.executionStatus, 'requires_confirmation');
  assert.match(res.humanResponse, /João Silva/);
  assert.match(res.humanResponse, /João Santos/);
  assert.strictEqual(await countRows('payments'), paymentsBefore, 'nenhum pagamento gravado');

  // Resposta escolhe um candidato; João Santos não tem dívida → nada é gravado
  const answer = await say('João Santos');
  assert.match(answer.humanResponse, /João Santos não tem dívida em aberto/);
  assert.strictEqual(await countRows('payments'), paymentsBefore);
});

test('Resposta à desambiguação aplica o pagamento na dívida do cliente escolhido', async () => {
  const res = await say('O João pagou 500 no Pix.');
  assert.strictEqual(res.executionStatus, 'requires_confirmation');
  const answer = await say('o João Pereira');
  assert.strictEqual(answer.executionStatus, 'executed', answer.humanResponse);
  const joao = await receivable(ids.joaoReceivable);
  assert.strictEqual(joao.balance, 11500, 'pagamento aplicado somente ao João Pereira');
});

test('Itens ambíguos: "iPhone 13" com Preto e Azul no estoque pergunta qual e não vende nada', async () => {
  const dealsBefore = await countRows('deals');
  const res = await say('Vendi o iPhone 13 pro Pedro por 3000 no Pix.');
  assert.strictEqual(res.executionStatus, 'requires_confirmation', res.humanResponse);
  assert.match(res.humanResponse, /iPhone 13 Preto/);
  assert.match(res.humanResponse, /iPhone 13 Azul/);
  assert.strictEqual(await countRows('deals'), dealsBefore, 'nenhuma venda gravada');

  const answer = await say('o azul');
  assert.strictEqual(answer.executionStatus, 'executed', answer.humanResponse);
  const azul = await one(user.client.from('items').select('status').eq('id', ids.iphoneAzul).single());
  const preto = await one(user.client.from('items').select('status').eq('id', ids.iphonePreto).single());
  assert.strictEqual(azul.status, 'vendido');
  assert.strictEqual(preto.status, 'disponivel');
});

test('Pagamento acima do saldo pergunta antes e não grava', async () => {
  const paymentsBefore = await countRows('payments');
  const res = await say('O João Pereira pagou 50000 no Pix.');
  assert.strictEqual(res.executionStatus, 'requires_confirmation', res.humanResponse);
  assert.strictEqual(await countRows('payments'), paymentsBefore);
});

run('E2E MULTI-TURN CONTRA O BANCO REAL');
