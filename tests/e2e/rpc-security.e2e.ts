// tests/e2e/rpc-security.e2e.ts
// Fase M — testes de segurança das RPCs contra o Supabase real.
// anon sem acesso, isolamento cross-user por payload e rollback total em caso de erro.

import assert from 'assert';
import { anonClient, createTestUser, run, seedCustomer, seedItem, test, TestUser } from './helpers';

function dealPayload(customerId: string, itemIds: string[], total: number) {
  return {
    customer_id: customerId,
    deal_type: 'venda',
    total_value: total,
    recognized_profit: 0,
    source: 'voice',
    items_out: itemIds.map((id) => ({ item_id: id, evaluated_value: total / itemIds.length })),
    items_in: [],
    cash_movements: [{ direction: 'IN', amount: total, payment_method: 'pix' }],
    receivables: [],
    payables: [],
    adjustments: [],
  };
}

async function countDeals(user: TestUser): Promise<number> {
  const { count, error } = await user.client.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function itemStatus(user: TestUser, itemId: string): Promise<string | undefined> {
  const { data } = await user.client.from('items').select('status').eq('id', itemId).maybeSingle();
  return data?.status;
}

let userA: TestUser;
let userB: TestUser;
let customerA: string;
let customerB: string;
let itemA: string;
let itemB: string;

test('setup: dois usuários isolados com cliente e estoque próprios', async () => {
  userA = await createTestUser('sec-a');
  userB = await createTestUser('sec-b');
  customerA = await seedCustomer(userA, 'Cliente do A');
  customerB = await seedCustomer(userB, 'Cliente do B');
  itemA = await seedItem(userA, 'Moto do A', 5000);
  itemB = await seedItem(userB, 'Moto do B', 5000);
});

test('anon não executa execute_deal_transaction (permission denied)', async () => {
  const { error } = await anonClient().rpc('execute_deal_transaction', { p_payload: dealPayload(customerA, [itemA], 6000) });
  assert.ok(error, 'anon deveria receber erro');
  assert.strictEqual(error.code, '42501', `esperado 42501, recebido ${error.code}: ${error.message}`);
});

test('anon não executa apply_obligation_settlement, reschedule_installment nem get_dashboard_indicators', async () => {
  const anon = anonClient();
  for (const [fn, args] of [
    ['apply_obligation_settlement', { p_payload: {} }],
    ['reschedule_installment', { p_payload: {} }],
    ['get_dashboard_indicators', { p_user_id: userA.id }],
  ] as const) {
    const { error } = await anon.rpc(fn, args);
    assert.ok(error, `${fn}: anon deveria receber erro`);
    assert.strictEqual(error.code, '42501', `${fn}: esperado 42501, recebido ${error.code}`);
  }
});

test('usuário A não vende item do B via payload (erro + rollback total)', async () => {
  const before = await countDeals(userA);
  const { error } = await userA.client.rpc('execute_deal_transaction', { p_payload: dealPayload(customerA, [itemB], 6000) });
  assert.ok(error, 'deveria falhar');
  assert.strictEqual(await countDeals(userA), before, 'nenhum deal deve ter sido criado');
  assert.strictEqual(await itemStatus(userB, itemB), 'disponivel', 'item do B deve continuar disponível');
});

test('item próprio + item do B no mesmo payload: rollback total, item próprio não é baixado', async () => {
  const { error } = await userA.client.rpc('execute_deal_transaction', { p_payload: dealPayload(customerA, [itemA, itemB], 6000) });
  assert.ok(error, 'deveria falhar');
  assert.strictEqual(await itemStatus(userA, itemA), 'disponivel', 'item do A não pode ficar vendido após rollback');
  assert.strictEqual(await countDeals(userA), 0);
});

test('usuário A não usa customer_id do B', async () => {
  const { error } = await userA.client.rpc('execute_deal_transaction', { p_payload: dealPayload(customerB, [itemA], 6000) });
  assert.ok(error, 'deveria falhar');
  assert.match(error.message, /Cliente .* não encontrado/);
  assert.strictEqual(await countDeals(userA), 0);
  assert.strictEqual(await itemStatus(userA, itemA), 'disponivel');
});

test('usuário A não lê indicadores do B', async () => {
  const { error } = await userA.client.rpc('get_dashboard_indicators', { p_user_id: userB.id });
  assert.ok(error, 'deveria falhar');
  const own = await userA.client.rpc('get_dashboard_indicators', { p_user_id: userA.id });
  assert.ifError(own.error);
});

test('usuário A não liquida nem reagenda dívida do B', async () => {
  const itemB2 = await seedItem(userB, 'Celular do B', 500);
  const { data, error } = await userB.client.rpc('execute_deal_transaction', {
    p_payload: {
      ...dealPayload(customerB, [itemB2], 1000),
      cash_movements: [],
      receivables: [{
        total_amount: 1000,
        installments: [{ installment_number: 1, total_installments: 1, original_value: 1000, due_date: '2026-12-15' }],
      }],
    },
  });
  assert.ifError(error);
  const receivableId = (data as { receivable_ids: string[] }).receivable_ids[0];
  const { data: inst } = await userB.client.from('installments').select('id').eq('receivable_id', receivableId).single();

  const pay = await userA.client.rpc('apply_obligation_settlement', {
    p_payload: { receivable_id: receivableId, kind: 'payment', amount: 100, payment_method: 'pix' },
  });
  assert.ok(pay.error, 'pagamento cross-user deveria falhar');

  const resched = await userA.client.rpc('reschedule_installment', {
    p_payload: { installment_id: inst!.id, new_due_date: '2027-01-10' },
  });
  assert.ok(resched.error, 'reagendamento cross-user deveria falhar');

  const { data: rec } = await userB.client.from('receivables').select('balance').eq('id', receivableId).single();
  assert.strictEqual(Number(rec!.balance), 1000, 'saldo do B deve permanecer intacto');
});

test('pagamento acima do saldo é rejeitado sem efeito colateral', async () => {
  const item = await seedItem(userA, 'Notebook do A', 800);
  const { data, error } = await userA.client.rpc('execute_deal_transaction', {
    p_payload: {
      ...dealPayload(customerA, [item], 1200),
      cash_movements: [],
      receivables: [{
        total_amount: 1200,
        installments: [
          { installment_number: 1, total_installments: 2, original_value: 600, due_date: '2026-11-10' },
          { installment_number: 2, total_installments: 2, original_value: 600, due_date: '2026-12-10' },
        ],
      }],
    },
  });
  assert.ifError(error);
  const receivableId = (data as { receivable_ids: string[] }).receivable_ids[0];

  const over = await userA.client.rpc('apply_obligation_settlement', {
    p_payload: { receivable_id: receivableId, kind: 'payment', amount: 1500, payment_method: 'pix' },
  });
  assert.ok(over.error, 'excesso deveria falhar');

  const { count } = await userA.client.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', userA.id);
  assert.strictEqual(count, 0, 'nenhum pagamento parcial pode ficar gravado');
});

test('A não estorna operação do B, não renegocia dívida do B e não apaga pagamentos (histórico só-inclusão)', async () => {
  const itemB3 = await seedItem(userB, 'Som do B', 300);
  const { data } = await userB.client.rpc('execute_deal_transaction', {
    p_payload: {
      ...dealPayload(customerB, [itemB3], 2000),
      cash_movements: [],
      receivables: [{
        total_amount: 2000,
        installments: [
          { installment_number: 1, total_installments: 2, original_value: 1000, due_date: '2026-11-15' },
          { installment_number: 2, total_installments: 2, original_value: 1000, due_date: '2026-12-15' },
        ],
      }],
    },
  });
  const receivableId = (data as { receivable_ids: string[] }).receivable_ids[0];
  const pay = await userB.client.rpc('apply_obligation_settlement', {
    p_payload: { receivable_id: receivableId, kind: 'payment', amount: 300, payment_method: 'pix' },
  });
  assert.ifError(pay.error);
  const settlementId = (pay.data as { settlement_id: string }).settlement_id;

  const reverse = await userA.client.rpc('reverse_settlement', { p_payload: { settlement_id: settlementId } });
  assert.ok(reverse.error, 'estorno cross-user deveria falhar');

  const reneg = await userA.client.rpc('renegotiate_installments', { p_payload: { receivable_id: receivableId, new_count: 4 } });
  assert.ok(reneg.error, 'renegociação cross-user deveria falhar');

  const del = await userB.client.from('payments').delete().eq('user_id', userB.id).select();
  assert.ok(del.error || (del.data ?? []).length === 0, 'nem o dono apaga pagamento');
  const upd = await userB.client.from('cash_movements').update({ amount: 1 }).eq('user_id', userB.id).select();
  assert.ok(upd.error || (upd.data ?? []).length === 0, 'nem o dono altera movimento de caixa');

  const { data: rec } = await userB.client.from('receivables').select('balance').eq('id', receivableId).single();
  assert.strictEqual(Number(rec!.balance), 1700, 'saldo do B intacto');
});

test('anon não executa as RPCs de estorno, renegociação e assinatura', async () => {
  const anon = anonClient();
  for (const [fn, args] of [
    ['reverse_settlement', { p_payload: {} }],
    ['renegotiate_installments', { p_payload: {} }],
    ['subscription_access', {}],
  ] as const) {
    const { error } = await anon.rpc(fn, args);
    assert.ok(error, `${fn}: anon deveria receber erro`);
    assert.strictEqual(error.code, '42501', `${fn}: esperado 42501, recebido ${error.code}`);
  }
});

test('RLS: A não enxerga clientes do B por consulta direta', async () => {
  const { data } = await userA.client.from('customers').select('id').eq('id', customerB);
  assert.deepStrictEqual(data, []);
});

// ------------------------------------------------------------------ empréstimos (loan_contracts)

function loanPayload(customerId: string) {
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return {
    customer_id: customerId, principal_amount: 1000, interest_type: 'fixed_amount', interest_rate: null, interest_amount: 200, total_amount: 1200,
    installments_count: 2,
    installments: [{ installment_number: 1, original_value: 600, due_date: due }, { installment_number: 2, original_value: 600, due_date: due }],
  };
}

test('empréstimo: anon não executa create_loan_contract', async () => {
  const { error } = await anonClient().rpc('create_loan_contract', { p_payload: loanPayload(customerA) });
  assert.ok(error);
  assert.strictEqual(error.code, '42501', `esperado 42501, recebido ${error.code}`);
});

test('empréstimo: A não cria empréstimo para cliente do B; B não lê nem liquida o empréstimo do A', async () => {
  const foreign = await userA.client.rpc('create_loan_contract', { p_payload: loanPayload(customerB) });
  assert.ok(foreign.error, 'cliente de outro usuário deve ser recusado');
  assert.strictEqual(foreign.error.code, '42501');

  const own = await userA.client.rpc('create_loan_contract', { p_payload: loanPayload(customerA) });
  assert.ifError(own.error);
  const { loan_contract_id: loanId, receivable_id: receivableId } = own.data as { loan_contract_id: string; receivable_id: string };

  const peek = await userB.client.from('loan_contracts').select('id').eq('id', loanId);
  assert.deepStrictEqual(peek.data, [], 'RLS esconde o contrato do A');
  const pay = await userB.client.rpc('apply_obligation_settlement', {
    p_payload: { kind: 'payment', receivable_id: receivableId, amount: 100, payment_method: 'pix', source: 'manual' },
  });
  assert.ok(pay.error, 'B não liquida dívida de empréstimo do A');
  const { data: rec } = await userA.client.from('receivables').select('balance').eq('id', receivableId).single();
  assert.strictEqual(Number(rec!.balance), 1200);
});

test('empréstimo: dono não altera nem apaga o contrato direto pela API (status só muda pela dívida)', async () => {
  const { data } = await userA.client.from('loan_contracts').select('id').limit(1).single();
  const upd = await userA.client.from('loan_contracts').update({ status: 'paid', total_amount: 1 }).eq('id', data!.id).select('id');
  assert.ok(upd.error || (upd.data ?? []).length === 0, 'UPDATE direto bloqueado');
  const del = await userA.client.from('loan_contracts').delete().eq('id', data!.id).select('id');
  assert.ok(del.error || (del.data ?? []).length === 0, 'DELETE direto bloqueado');
  const { data: after } = await userA.client.from('loan_contracts').select('status, total_amount').eq('id', data!.id).single();
  assert.deepStrictEqual([after!.status, Number(after!.total_amount)], ['active', 1200]);
});

run('SEGURANÇA DAS RPCs (Supabase real)');
