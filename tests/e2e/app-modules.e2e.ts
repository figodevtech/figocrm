// tests/e2e/app-modules.e2e.ts
// Fluxos obrigatórios do ciclo "módulos com atalhos" contra o Supabase real, pelo MESMO código que as telas
// chamam (domínio + RPCs) e pelo mesmo pipeline de voz (runVoicePipeline com contexto da tela).
// E2E_INTERPRETER=llm | rules | auto (padrão: LLM se houver chave).

import assert from 'assert';
import { createTestUser, run, sql, test, TestUser } from './helpers';
import { createCustomer, mergeProvisionalCustomer, updateCustomer } from '../../src/lib/domain/customers';
import { createItem, mergeProvisionalItem } from '../../src/lib/domain/items';
import { buildManualSaleCommand, buildManualTradeCommand } from '../../src/lib/domain/manual-deal-commands';
import { executeDealCommand } from '../../src/lib/domain/command-executor';
import { createLoanContract } from '../../src/lib/domain/loans';
import { todayISO } from '../../src/lib/domain/loan-plan';
import { applySettlement, renegotiateInstallments, reverseSettlement } from '../../src/lib/domain/financial-operations';
import { getCustomerDetail, getDashboard, getLoanDetail, listCustomers, listDeals, listOpenDebts, listStock } from '../../src/lib/domain/app-data';
import { runVoicePipeline, VoiceProcessResult } from '../../src/lib/ai/orchestrator';
import { interpretVoiceCommandWithLLM, InterpretMode } from '../../src/lib/ai/interpret';
import { isLLMConfigured } from '../../src/lib/ai/provider';
import { addDaysISO } from '../../src/lib/format';
import type { ScreenContext } from '../../src/lib/ai/screen-context';

const requested = (process.env.E2E_INTERPRETER || 'auto').toLowerCase();
const mode: InterpretMode = requested === 'rules' ? 'rules_only' : requested === 'llm' ? 'llm_required' : 'auto';
const label = mode === 'rules_only' || !isLLMConfigured() ? 'parser determinístico' : 'LLM real';

let user: TestUser;
const ids: Record<string, string> = {};
const today = todayISO();
const firstDue = addDaysISO(today, 30);

async function say(text: string, screen?: ScreenContext): Promise<VoiceProcessResult> {
  const res = await runVoicePipeline(text, {
    supabase: user.client,
    userId: user.id,
    screen,
    interpret: (t, ctx) => interpretVoiceCommandWithLLM(t, ctx, { mode }),
  });
  console.log(`      > "${text}"${screen ? ' [tela do cliente]' : ''}\n      < [${res.assistant.status}] ${res.humanResponse}`);
  return res;
}

const one = async <T>(query: string, params: unknown[]) => (await sql<T>(query, params))[0];

/** Mesmo dia no mês seguinte, limitado ao último dia (31/01 → 28/02). */
function nextMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
const num = (v: unknown) => Number(v);

test('fluxo 1: cadastro cria perfil (telefone, negócio) + teste de 7 dias; Home → Novo cliente → Carlos', async () => {
  user = await createTestUser('app', { phone: '(83) 98888-7777', business_name: 'Figo Motos' });
  const profile = await one<{ phone: string; business_name: string }>('SELECT phone, business_name FROM profiles WHERE id = $1', [user.id]);
  assert.deepStrictEqual([profile.phone, profile.business_name], ['(83) 98888-7777', 'Figo Motos']);
  const sub = await one<{ status: string; days: number }>(
    `SELECT status, round(extract(epoch FROM trial_ends_at - now()) / 86400)::int AS days FROM subscriptions WHERE user_id = $1`,
    [user.id]
  );
  assert.deepStrictEqual([sub.status, sub.days], ['trialing', 7]);

  const created = await createCustomer(user.client, user.id, { name: 'Carlos', phone: '(83) 99999-9999', address: 'Rua A, 10' });
  assert.ok(created.ok, !created.ok ? created.error : '');
  ids.carlos = created.ok ? created.customer.id : '';

  const dup = await createCustomer(user.client, user.id, { name: 'carlos' });
  assert.ok(!dup.ok && dup.duplicate?.id === ids.carlos, 'homônimo não é reaproveitado em silêncio: a tela pergunta');

  const list = await listCustomers(user.client, user.id);
  assert.deepStrictEqual(list.map((c) => [c.name, c.owes]), [['Carlos', 0]]);
});

test('fluxo 2: nova mercadoria iPhone com compra 2000 + conserto 200 + frete 50 → custo total 2250 (CMV)', async () => {
  const res = await createItem(
    user.client,
    user.id,
    { name: 'iPhone 13 128GB Preto', category: 'celular', brand: 'Apple', model: '13', imei: '356938035643809', acquisitionCost: 2000, targetSalePrice: 2900 },
    [{ category: 'reparo', amount: 200 }, { category: 'transporte', amount: 50 }]
  );
  assert.ok(res.ok && res.costsSaved, !res.ok ? res.error : 'custos');
  ids.iphone = res.ok ? res.itemId : '';

  const [item] = await listStock(user.client, user.id);
  assert.deepStrictEqual([item.name, item.totalCost, item.targetSalePrice, item.statusLabel, item.imei], ['iPhone 13 128GB Preto', 2250, 2900, 'Disponível', '356938035643809']);
  const dash = await getDashboard(user.client, user.id);
  assert.strictEqual(dash?.emMercadoria, 2250);
});

test('fluxo 3: nova venda → Carlos → iPhone → 3200 → 1000 Pix → 4×550 (mesmo executor da voz, idempotente)', async () => {
  const built = buildManualSaleCommand({
    customerId: ids.carlos,
    itemId: ids.iphone,
    totalValue: 3200,
    paymentMethod: 'pix',
    cashInflow: 1000,
    receivable: { totalAmount: 2200, installmentsCount: 4, installmentValue: 550, firstDueDate: firstDue, intervalDays: 30 },
    idempotencyKey: `venda-${user.id}`,
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  const res = await executeDealCommand(built.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' });
  assert.ok(res.success && res.dealId, res.humanSummary);
  ids.saleDeal = res.dealId!;

  const deal = await one<{ total_value: string; recognized_profit: string; source: string; deal_type: string }>(
    'SELECT total_value, recognized_profit, source, deal_type FROM deals WHERE id = $1',
    [ids.saleDeal]
  );
  assert.deepStrictEqual([num(deal.total_value), num(deal.recognized_profit), deal.source, deal.deal_type], [3200, 950, 'manual', 'venda']);
  assert.strictEqual((await one<{ status: string }>('SELECT status FROM items WHERE id = $1', [ids.iphone])).status, 'vendido');

  const rec = await one<{ id: string; total_amount: string; balance: string }>('SELECT id, total_amount, balance FROM receivables WHERE deal_id = $1', [ids.saleDeal]);
  ids.saleRec = rec.id;
  assert.deepStrictEqual([num(rec.total_amount), num(rec.balance)], [2200, 2200]);
  const inst = await sql<{ original_value: string; due_date: string }>(
    'SELECT original_value, due_date::text FROM installments WHERE receivable_id = $1 ORDER BY installment_number',
    [rec.id]
  );
  assert.deepStrictEqual(inst.map((i) => num(i.original_value)), [550, 550, 550, 550]);
  assert.strictEqual(inst[0].due_date, firstDue);
  const cash = await sql<{ direction: string; amount: string; payment_method: string }>('SELECT direction, amount, payment_method FROM cash_movements WHERE deal_id = $1', [ids.saleDeal]);
  assert.deepStrictEqual(cash.map((c) => [c.direction, num(c.amount), c.payment_method]), [['IN', 1000, 'pix']]);

  const again = await executeDealCommand(built.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' });
  assert.ok(again.success && again.alreadyExecuted, 'duplo clique não duplica a venda');
  assert.strictEqual((await one<{ n: number }>('SELECT count(*)::int AS n FROM deals WHERE user_id = $1', [user.id])).n, 1);

  const dash = await getDashboard(user.client, user.id);
  assert.deepStrictEqual([dash?.naRua, dash?.quantoGanhouMes, dash?.emMercadoria], [2200, 950, 0]);
});

test('troca manual: entreguei Bros (17 mil), recebi XRE (22 mil), paguei 5 mil no Pix → XRE entra no estoque', async () => {
  const paulo = await createCustomer(user.client, user.id, { name: 'Paulo' });
  assert.ok(paulo.ok);
  ids.paulo = paulo.ok ? paulo.customer.id : '';
  const bros = await createItem(user.client, user.id, { name: 'Honda Bros 2019', category: 'moto', plate: 'ABC1D23', acquisitionCost: 15000 });
  assert.ok(bros.ok);
  ids.bros = bros.ok ? bros.itemId : '';

  const built = buildManualTradeCommand({
    customerId: ids.paulo, itemOutId: ids.bros, itemIn: { name: 'Honda XRE 300', evaluatedValue: 22000 }, tradeBalance: 5000, direction: 'paid',
    immediateCash: 5000, immediatePaymentMethod: 'pix', idempotencyKey: `troca-${user.id}`,
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  const res = await executeDealCommand(built.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' });
  assert.ok(res.success, res.humanSummary);
  ids.tradeDeal = res.dealId!;

  const xre = await one<{ id: string; status: string; acquisition_cost: string }>(
    `SELECT i.id, i.status, i.acquisition_cost FROM items i JOIN deal_items di ON di.item_id = i.id WHERE di.deal_id = $1 AND di.direction = 'IN'`,
    [ids.tradeDeal]
  );
  assert.deepStrictEqual([xre.status, num(xre.acquisition_cost)], ['disponivel', 22000]);
  const stock = await listStock(user.client, user.id, ['disponivel']);
  assert.deepStrictEqual(stock.map((s) => [s.name, s.statusLabel, s.totalCost]), [['Honda XRE 300', 'Recebido em troca', 22000]]);
  const cash = await sql<{ direction: string; amount: string }>('SELECT direction, amount FROM cash_movements WHERE deal_id = $1', [ids.tradeDeal]);
  assert.deepStrictEqual(cash.map((c) => [c.direction, num(c.amount)]), [['OUT', 5000]]);
});

test('fluxo 4: novo empréstimo → Carlos → 2000 → 500 de juros → 5×500 (contrato + dívida + parcelas + caixa + auditoria)', async () => {
  const input = {
    customerId: ids.carlos,
    principal: 2000,
    interestType: 'fixed_amount' as const,
    interestAmount: 500,
    installmentsCount: 5,
    firstDueDate: firstDue,
    paymentMethod: 'pix' as const,
    source: 'manual' as const,
    idempotencyKey: `emprestimo-${user.id}`,
  };
  const res = await createLoanContract(user.client, input);
  assert.ok(res.success && res.loanContractId, res.error);
  ids.loan = res.loanContractId!;
  ids.loanRec = res.receivableId!;

  const loan = await one<{ principal_amount: string; interest_amount: string; total_amount: string; status: string; interest_type: string }>(
    'SELECT principal_amount, interest_amount, total_amount, status, interest_type FROM loan_contracts WHERE id = $1',
    [ids.loan]
  );
  assert.deepStrictEqual([num(loan.principal_amount), num(loan.interest_amount), num(loan.total_amount), loan.status, loan.interest_type], [2000, 500, 2500, 'active', 'fixed_amount']);

  const rec = await one<{ deal_id: string | null; loan_contract_id: string; total_amount: string; customer_id: string }>(
    'SELECT deal_id, loan_contract_id, total_amount, customer_id FROM receivables WHERE id = $1',
    [ids.loanRec]
  );
  assert.deepStrictEqual([rec.deal_id, rec.loan_contract_id, num(rec.total_amount), rec.customer_id], [null, ids.loan, 2500, ids.carlos]);

  const inst = await sql<{ original_value: string; due_date: string }>('SELECT original_value, due_date::text FROM installments WHERE receivable_id = $1 ORDER BY installment_number', [ids.loanRec]);
  assert.deepStrictEqual(inst.map((i) => num(i.original_value)), [500, 500, 500, 500, 500]);
  assert.strictEqual(inst[0].due_date, firstDue);
  assert.strictEqual(inst[1].due_date, nextMonth(firstDue), 'parcelas seguintes no mesmo dia do mês seguinte');

  const cash = await sql<{ direction: string; amount: string }>('SELECT direction, amount FROM cash_movements WHERE loan_contract_id = $1', [ids.loan]);
  assert.deepStrictEqual(cash.map((c) => [c.direction, num(c.amount)]), [['OUT', 2000]]);
  const audit = await sql('SELECT 1 FROM audit_log WHERE entity_id = $1 AND action_type = $2', [ids.loan, 'CREATE_LOAN_CONTRACT']);
  assert.strictEqual(audit.length, 1);

  const again = await createLoanContract(user.client, input);
  assert.ok(again.success && again.alreadyExecuted && again.loanContractId === ids.loan, 'reenvio não duplica o empréstimo');

  const dash = await getDashboard(user.client, user.id);
  assert.strictEqual(dash?.naRua, 2200 + 2500, '"A receber" inclui o empréstimo');
});

test('empréstimo com % ao mês (juros simples) e banco recusando payload adulterado', async () => {
  const monthly = await createLoanContract(user.client, {
    customerId: ids.paulo, principal: 1000, interestType: 'percent_monthly', interestRate: 10, installmentsCount: 3, firstDueDate: firstDue, source: 'manual',
  });
  assert.ok(monthly.success, monthly.error);
  const loan = await one<{ interest_amount: string; total_amount: string; interest_rate: string }>(
    'SELECT interest_amount, total_amount, interest_rate FROM loan_contracts WHERE id = $1',
    [monthly.loanContractId]
  );
  assert.deepStrictEqual([num(loan.interest_amount), num(loan.total_amount), num(loan.interest_rate)], [300, 1300, 10]);

  const base = {
    customer_id: ids.paulo, principal_amount: 1000, interest_type: 'percent_total', interest_rate: 20, interest_amount: 200, total_amount: 1200,
    installments_count: 2, start_date: today,
    installments: [{ installment_number: 1, original_value: 600, due_date: firstDue }, { installment_number: 2, original_value: 600, due_date: addDaysISO(firstDue, 30) }],
  };
  const tampered = await user.client.rpc('create_loan_contract', { p_payload: { ...base, interest_amount: 50, total_amount: 1050 } });
  assert.strictEqual(tampered.error?.hint, 'INTEREST_MISMATCH', tampered.error?.message);
  const badSchedule = await user.client.rpc('create_loan_contract', {
    p_payload: { ...base, installments: [{ installment_number: 1, original_value: 600, due_date: firstDue }, { installment_number: 2, original_value: 500, due_date: firstDue }] },
  });
  assert.strictEqual(badSchedule.error?.hint, 'SCHEDULE_MISMATCH', badSchedule.error?.message);
  const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM loan_contracts WHERE user_id = $1', [user.id]);
  assert.strictEqual(n.n, 2, 'nada gravado quando o banco recusa');
});

test('fluxo 5: receber pagamento → Carlos (2 dívidas, escolha explícita) → empréstimo → 500; parcial de 200 deixa 300', async () => {
  const debts = await listOpenDebts(user.client, user.id, ids.carlos);
  assert.deepStrictEqual(debts.map((d) => d.label).sort(), ['Empréstimo de R$ 2.000', 'iPhone 13 128GB Preto']);
  const loanDebt = debts.find((d) => d.loanContractId === ids.loan)!;
  const [first, second] = loanDebt.installments;

  const pay = await applySettlement(user.client, { kind: 'payment', receivableId: loanDebt.receivableId, installmentId: first.id, amount: 500, paymentMethod: 'pix', source: 'manual' });
  assert.ok(pay.success && pay.settlementId, pay.error);
  assert.strictEqual((await one<{ status: string }>('SELECT status FROM installments WHERE id = $1', [first.id])).status, 'paid');

  const partial = await applySettlement(user.client, { kind: 'payment', receivableId: loanDebt.receivableId, installmentId: second.id, amount: 200, paymentMethod: 'cash', source: 'manual' });
  assert.ok(partial.success, partial.error);
  const inst2 = await one<{ status: string; balance: string }>('SELECT status, balance FROM installments WHERE id = $1', [second.id]);
  assert.deepStrictEqual([inst2.status, num(inst2.balance)], ['partially_paid', 300]);

  const view = await getLoanDetail(user.client, user.id, ids.loan);
  assert.deepStrictEqual([view?.paid, view?.balance, view?.statusLabel], [700, 1800, 'Em dia']);

  const over = await applySettlement(user.client, { kind: 'payment', receivableId: loanDebt.receivableId, installmentId: second.id, amount: 400, paymentMethod: 'pix', source: 'manual' });
  assert.ok(!over.success && over.exceedsBalance, 'pagamento acima da parcela é recusado');

  const undo = await reverseSettlement(user.client, { settlementId: partial.settlementId!, reason: 'teste', source: 'manual' });
  assert.ok(undo.success);
  assert.strictEqual(num((await one<{ balance: string }>('SELECT balance FROM installments WHERE id = $1', [second.id])).balance), 500);
  assert.strictEqual(num((await one<{ balance: string }>('SELECT balance FROM receivables WHERE id = $1', [ids.loanRec])).balance), 2000);
});

test(`fluxo 6: voz contextual na tela do Carlos — "Ele pagou mais 500 do empréstimo." (${label})`, async () => {
  const saleBefore = num((await one<{ balance: string }>('SELECT balance FROM receivables WHERE id = $1', [ids.saleRec])).balance);
  const res = await say('Ele pagou mais 500 do empréstimo.', { customerId: ids.carlos });
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  assert.ok(res.assistant.status === 'executed' && res.assistant.undoAvailable && res.assistant.operationType === 'payment');

  const settlement = await one<{ customer_id: string; receivable_id: string; amount: string }>(
    `SELECT customer_id, receivable_id, amount FROM settlements WHERE user_id = $1 AND reversal_of IS NULL ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  assert.deepStrictEqual([settlement.customer_id, settlement.receivable_id, num(settlement.amount)], [ids.carlos, ids.loanRec, 500], 'Carlos, empréstimo certo, valor certo');
  assert.strictEqual(num((await one<{ balance: string }>('SELECT balance FROM receivables WHERE id = $1', [ids.loanRec])).balance), 1500, 'saldo certo');
  assert.strictEqual(num((await one<{ balance: string }>('SELECT balance FROM receivables WHERE id = $1', [ids.saleRec])).balance), saleBefore, 'a venda do iPhone não foi tocada');
});

test(`voz: "Emprestei dois mil pro Pedro em cinco de quinhentos" cria o mesmo contrato do formulário (${label})`, async () => {
  const res = await say('Emprestei dois mil pro Pedro em cinco de quinhentos.');
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  assert.match(res.humanResponse, /Emprestei R\$ 2\.000 pro Pedro/);
  const loan = await one<{ principal_amount: string; interest_amount: string; total_amount: string; installments_count: number; source: string; name: string }>(
    `SELECT l.principal_amount, l.interest_amount, l.total_amount, l.installments_count, l.source, c.name
       FROM loan_contracts l JOIN customers c ON c.id = l.customer_id WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 1`,
    [user.id]
  );
  assert.deepStrictEqual(
    [num(loan.principal_amount), num(loan.interest_amount), num(loan.total_amount), loan.installments_count, loan.source, loan.name],
    [2000, 500, 2500, 5, 'voice', 'Pedro']
  );
});

test('histórico e telas do Carlos: venda, empréstimo, pagamentos e estorno; negócios com recebido / a receber', async () => {
  const detail = await getCustomerDetail(user.client, user.id, ids.carlos);
  assert.ok(detail);
  if (!detail) return;
  assert.deepStrictEqual([detail.owes, detail.debts.length], [2200 + 1500, 2]);
  const kinds = new Set(detail.timeline.map((e) => e.kind));
  for (const k of ['sale', 'loan', 'payment', 'reversal'] as const) assert.ok(kinds.has(k), `histórico tem ${k}`);
  assert.ok(detail.next && detail.next.amount > 0);
  assert.strictEqual(detail.customer.address, 'Rua A, 10');

  const deals = await listDeals(user.client, user.id);
  const sale = deals.find((d) => d.id === ids.saleDeal)!;
  assert.deepStrictEqual([sale.title, sale.received, sale.toReceive], ['iPhone 13 128GB Preto', 1000, 2200]);
  const trade = deals.find((d) => d.id === ids.tradeDeal)!;
  assert.deepStrictEqual([trade.type, trade.paid, trade.title], ['troca', 5000, 'Honda Bros 2019 ⇄ Honda XRE 300']);
});

test('renegociar o empréstimo pela tela mantém histórico; quitar tudo marca o contrato como quitado', async () => {
  const debts = await listOpenDebts(user.client, user.id, ids.carlos);
  const loanDebt = debts.find((d) => d.loanContractId === ids.loan)!;
  const open = loanDebt.installments.filter((i) => i.open);
  const reneg = await renegotiateInstallments(user.client, {
    receivableId: ids.loanRec, installmentIds: open.map((i) => i.id), newCount: 3, firstDueDate: addDaysISO(today, 40), source: 'manual',
  });
  assert.ok(reneg.success, reneg.error);
  assert.strictEqual(reneg.newInstallments?.reduce((acc, i) => acc + i.amount, 0), 1500);
  const statuses = await sql<{ status: string }>('SELECT status FROM installments WHERE receivable_id = $1 ORDER BY installment_number', [ids.loanRec]);
  assert.strictEqual(statuses.filter((s) => s.status === 'renegotiated').length, open.length, 'parcelas antigas ficam no histórico');

  const payoff = await applySettlement(user.client, { kind: 'payment', receivableId: ids.loanRec, settleFull: true, paymentMethod: 'pix', source: 'manual' });
  assert.ok(payoff.success, payoff.error);
  const loan = await one<{ status: string }>('SELECT status FROM loan_contracts WHERE id = $1', [ids.loan]);
  assert.strictEqual(loan.status, 'paid');
  assert.strictEqual((await getLoanDetail(user.client, user.id, ids.loan))?.statusLabel, 'Quitado');
});

test('fotos de mercadoria: bucket privado, pasta do próprio usuário, lida por URL assinada', async () => {
  const path = `${user.id}/teste.jpg`;
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const up = await user.client.storage.from('item-photos').upload(path, jpeg, { contentType: 'image/jpeg' });
  assert.ifError(up.error);
  const outside = await user.client.storage.from('item-photos').upload(`outro-usuario/teste.jpg`, jpeg, { contentType: 'image/jpeg' });
  assert.ok(outside.error, 'não grava fora da própria pasta');

  const other = await createTestUser('app-b');
  const peek = await other.client.storage.from('item-photos').download(path);
  assert.ok(peek.error, 'outro usuário não lê a foto');

  const item = await createItem(user.client, user.id, { name: 'Notebook com foto', acquisitionCost: 1000, photoPath: path });
  assert.ok(item.ok);
  const listed = (await listStock(user.client, user.id)).find((i) => i.name === 'Notebook com foto');
  assert.ok(listed?.photoUrl?.startsWith('http'), 'lista traz URL assinada');
});

// ------------------------------------------------------------------ voz não fica refém de cadastro

test(`voz: "Vendi o iPhone 15 pro Marcos por 3 mil no Pix" sem iPhone nem Marcos → venda avulsa + pergunta o custo (${label})`, async () => {
  const res = await say('Vendi o iPhone 15 pro Marcos por 3 mil no Pix.');
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  assert.match(res.humanResponse, /Não estavam no cadastro: Marcos e iPhone 15/);
  assert.match(res.humanResponse, /Quanto você pagou/);
  ids.avulsoDeal = res.dealId!;

  const deal = await one<{ total_value: string; recognized_profit: string; profit_pending: boolean; customer_id: string }>(
    'SELECT total_value, recognized_profit, profit_pending, customer_id FROM deals WHERE id = $1', [ids.avulsoDeal]);
  assert.deepStrictEqual([num(deal.total_value), num(deal.recognized_profit), deal.profit_pending], [3000, 0, true], 'lucro não é inventado');
  const cust = await one<{ name: string; is_provisional: boolean }>('SELECT name, is_provisional FROM customers WHERE id = $1', [deal.customer_id]);
  assert.deepStrictEqual([cust.name, cust.is_provisional], ['Marcos', true]);
  ids.marcos = deal.customer_id;
  const item = await one<{ id: string; name: string; status: string; is_provisional: boolean; cost_pending: boolean }>(
    `SELECT i.id, i.name, i.status, i.is_provisional, i.cost_pending FROM items i JOIN deal_items di ON di.item_id = i.id WHERE di.deal_id = $1`, [ids.avulsoDeal]);
  assert.deepStrictEqual([item.status, item.is_provisional, item.cost_pending], ['vendido', true, true]);
  assert.match(item.name, /iPhone 15/i);
  ids.avulsoItem = item.id;

  const cost = await say('Paguei dois mil nele.');
  assert.strictEqual(cost.assistant.status, 'executed', cost.humanResponse);
  assert.match(cost.humanResponse, /Lucro da venda: R\$ 1\.000/);
  const after = await one<{ recognized_profit: string; profit_pending: boolean }>('SELECT recognized_profit, profit_pending FROM deals WHERE id = $1', [ids.avulsoDeal]);
  assert.deepStrictEqual([num(after.recognized_profit), after.profit_pending], [1000, false]);
  assert.strictEqual((await one<{ n: number }>('SELECT count(*)::int AS n FROM deals WHERE user_id = $1 AND total_value = 3000 AND customer_id = $2', [user.id, ids.marcos])).n, 1, 'a resposta do custo não gerou venda nova');
});

test(`voz: venda sem dizer o cliente vira "Cliente avulso"; empréstimo para nome desconhecido também (${label})`, async () => {
  const sale = await say('Vendi um carregador por 80 reais no Pix.');
  assert.strictEqual(sale.assistant.status, 'executed', sale.humanResponse);
  const c = await one<{ name: string; is_provisional: boolean }>(
    'SELECT c.name, c.is_provisional FROM deals d JOIN customers c ON c.id = d.customer_id WHERE d.id = $1', [sale.dealId]);
  assert.deepStrictEqual([c.name, c.is_provisional], ['Cliente avulso', true]);

  const loan = await say('Emprestei mil pro Jonas em duas de 600.');
  assert.strictEqual(loan.assistant.status, 'executed', loan.humanResponse);
  const j = await one<{ id: string; is_provisional: boolean; total: string }>(
    `SELECT c.id, c.is_provisional, l.total_amount AS total FROM loan_contracts l JOIN customers c ON c.id = l.customer_id
      WHERE l.user_id = $1 AND c.name = 'Jonas'`, [user.id]);
  assert.deepStrictEqual([j.is_provisional, num(j.total)], [true, 1200]);
  ids.jonas = j.id;
});

test(`voz na tela do Carlos sem dizer o nome: "Vendi um fone por 100 no Pix" é venda para o Carlos, não avulso (${label})`, async () => {
  const res = await say('Vendi um fone por 100 no Pix.', { customerId: ids.carlos });
  assert.strictEqual(res.assistant.status, 'executed', res.humanResponse);
  const deal = await one<{ customer_id: string }>('SELECT customer_id FROM deals WHERE id = $1', [res.dealId]);
  assert.strictEqual(deal.customer_id, ids.carlos);
});

test('vincular cliente avulso a um cadastro: dívidas, empréstimos e pagamentos passam; avulso some', async () => {
  const debts = await listOpenDebts(user.client, user.id, ids.jonas);
  const pay = await applySettlement(user.client, { kind: 'payment', receivableId: debts[0].receivableId, amount: 600, paymentMethod: 'pix', source: 'manual' });
  assert.ok(pay.success, pay.error);

  const notProvisional = await mergeProvisionalCustomer(user.client, ids.carlos, ids.paulo);
  assert.ok(!notProvisional.ok, 'cadastro normal não é "vinculável"');

  const merged = await mergeProvisionalCustomer(user.client, ids.jonas, ids.paulo);
  assert.ok(merged.ok, !merged.ok ? merged.error : '');
  assert.strictEqual((await sql('SELECT 1 FROM customers WHERE id = $1', [ids.jonas])).length, 0);
  for (const table of ['loan_contracts', 'receivables', 'settlements']) {
    const left = await sql(`SELECT 1 FROM ${table} WHERE customer_id = $1`, [ids.jonas]);
    assert.strictEqual(left.length, 0, `${table} passou para o cadastro`);
  }
  const paulo = await getCustomerDetail(user.client, user.id, ids.paulo);
  assert.ok(paulo?.timeline.some((e) => e.kind === 'payment' && e.amount === 600), 'pagamento aparece no histórico do cadastro');
  assert.ok(paulo?.debts.some((d) => d.kind === 'loan'));

  const confirm = await updateCustomer(user.client, user.id, ids.marcos, { name: 'Marcos Lima', phone: '83977776666' }, { confirmProvisional: true });
  assert.ok(confirm.ok);
  assert.strictEqual((await one<{ is_provisional: boolean }>('SELECT is_provisional FROM customers WHERE id = $1', [ids.marcos])).is_provisional, false);
});

test('vincular mercadoria avulsa a uma do estoque recalcula o lucro com o custo dela', async () => {
  const tv = await createItem(user.client, user.id, { name: 'TV Samsung 50', acquisitionCost: 700 });
  assert.ok(tv.ok);
  const sale = await say('Vendi uma televisão pro Paulo por mil no Pix.');
  assert.strictEqual(sale.assistant.status, 'executed', sale.humanResponse);
  const avulso = await one<{ id: string; is_provisional: boolean }>(
    `SELECT i.id, i.is_provisional FROM items i JOIN deal_items di ON di.item_id = i.id WHERE di.deal_id = $1`, [sale.dealId]);
  assert.strictEqual(avulso.is_provisional, true, '"televisão" não casou com "TV Samsung 50": entrou avulsa');

  const merged = await mergeProvisionalItem(user.client, avulso.id, tv.ok ? tv.itemId : '');
  assert.ok(merged.ok, !merged.ok ? merged.error : '');
  const deal = await one<{ recognized_profit: string; profit_pending: boolean }>('SELECT recognized_profit, profit_pending FROM deals WHERE id = $1', [sale.dealId]);
  assert.deepStrictEqual([num(deal.recognized_profit), deal.profit_pending], [300, false]);
  const stock = await one<{ status: string }>('SELECT status FROM items WHERE id = $1', [tv.ok ? tv.itemId : '']);
  assert.strictEqual(stock.status, 'vendido');
  assert.strictEqual((await sql('SELECT 1 FROM items WHERE id = $1', [avulso.id])).length, 0);
});

test('formulário: venda de mercadoria fora do estoque com custo informado já reconhece o lucro', async () => {
  const built = buildManualSaleCommand({ customerId: ids.carlos, newItem: { name: 'Capinha', acquisitionCost: 15 }, totalValue: 50, cashInflow: 50, paymentMethod: 'cash' });
  assert.ok(built.ok);
  if (!built.ok) return;
  const res = await executeDealCommand(built.command, { supabase: user.client, userId: user.id, source: 'MANUAL_WEB' });
  assert.ok(res.success, res.humanSummary);
  const deal = await one<{ recognized_profit: string; profit_pending: boolean }>('SELECT recognized_profit, profit_pending FROM deals WHERE id = $1', [res.dealId]);
  assert.deepStrictEqual([num(deal.recognized_profit), deal.profit_pending], [35, false]);
});

run('E2E: MÓDULOS DO APP (clientes, estoque, venda, troca, empréstimo, recebimento, voz contextual)');
