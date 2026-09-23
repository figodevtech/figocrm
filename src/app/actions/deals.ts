// src/app/actions/deals.ts
// Ações do Sistema: Gestão de Negociações (Vendas, Trocas e Compras) (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritePermission } from '@/lib/subscription';
import { calculateCMV, calculateGrossProfit, generateInstallmentSchedule } from '@/lib/financial_engine';
import { PaymentMethod } from '@/types/domain';

export interface CreateSaleInput {
  customerId: string;
  itemId: string;
  totalValue: number;
  paymentMethod?: PaymentMethod;
  cashInflow?: number;
  receivable?: {
    totalAmount: number;
    installmentsCount: number;
    installmentValue: number;
    firstDueDate?: string;
    dueDayOfMonth?: number;
    intervalDays?: number;
    isPromissory?: boolean;
  };
  notes?: string;
}

export async function createSaleAction(input: CreateSaleInput): Promise<{ dealId?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Usuário não autenticado.' };
    }

    await assertWritePermission(user.id);

    // 1. Validar e buscar item de saída
    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('*, item_costs(*)')
      .eq('id', input.itemId)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return { error: 'Mercadoria não encontrada.' };
    }

    if (item.status === 'vendido') {
      return { error: 'Esta mercadoria já consta como vendida.' };
    }

    // 2. Apurar CMV e Lucro Bruto
    const itemCMV = calculateCMV(Number(item.acquisition_cost), item.item_costs || []);
    const grossProfit = calculateGrossProfit(input.totalValue, [itemCMV]);

    // 3. Criar a negociação principal (Deal)
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        user_id: user.id,
        customer_id: input.customerId,
        deal_type: 'venda',
        total_value: input.totalValue,
        recognized_profit: grossProfit,
        status: 'concluida',
        notes: input.notes || null,
        source: 'manual',
        deal_date: new Date().toISOString().split('T')[0],
      })
      .select('*')
      .single();

    if (dealError || !deal) {
      return { error: dealError?.message || 'Erro ao criar negociação.' };
    }

    // 4. Atualizar item para vendido e vincular em deal_items (OUT)
    await supabase.from('items').update({ status: 'vendido' }).eq('id', item.id);

    await supabase.from('deal_items').insert({
      deal_id: deal.id,
      item_id: item.id,
      direction: 'OUT',
      evaluated_value: input.totalValue,
    });

    // 5. Entrada imediata de caixa (se houver pagamento à vista / entrada)
    if (input.cashInflow && input.cashInflow > 0) {
      await supabase.from('cash_movements').insert({
        user_id: user.id,
        deal_id: deal.id,
        direction: 'IN',
        amount: input.cashInflow,
        payment_method: input.paymentMethod || 'pix',
        description: `Entrada da venda - ${item.name}`,
      });
    }

    // 6. Gerar recebíveis e parcelamento (se houver saldo a prazo)
    if (input.receivable && input.receivable.totalAmount > 0) {
      const rec = input.receivable;
      const { data: createdRec, error: recError } = await supabase
        .from('receivables')
        .insert({
          user_id: user.id,
          deal_id: deal.id,
          customer_id: input.customerId,
          total_amount: rec.totalAmount,
          paid_amount: 0.00,
          balance: rec.totalAmount,
          status: 'pending',
        })
        .select('*')
        .single();

      if (recError || !createdRec) {
        return { error: recError?.message || 'Erro ao gerar recebível.' };
      }

      // Motor determinístico gerando parcelas
      const schedule = generateInstallmentSchedule({
        totalAmount: rec.totalAmount,
        installmentsCount: rec.installmentsCount,
        startDate: rec.firstDueDate ? new Date(rec.firstDueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        dueDayOfMonth: rec.dueDayOfMonth,
        intervalDays: rec.intervalDays || 30,
        isPromissory: rec.isPromissory || false,
      });

      const installmentsToInsert = schedule.map((inst) => ({
        user_id: user.id,
        receivable_id: createdRec.id,
        installment_number: inst.installmentNumber,
        total_installments: inst.totalInstallments,
        original_value: inst.originalValue,
        paid_value: 0.00,
        balance: inst.balance,
        due_date: inst.dueDate,
        status: inst.status,
        is_promissory: inst.isPromissory,
      }));

      await supabase.from('installments').insert(installmentsToInsert);
    }

    // 7. Auditoria para suporte ao Desfazer
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'deals',
      entity_id: deal.id,
      action_type: 'CREATE_SALE',
      source: 'MANUAL_WEB',
      payload_after: { deal, item, input },
    });

    return { dealId: deal.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar venda.';
    return { error: message };
  }
}

export interface CreateTradeInput {
  customerId: string;
  itemOutId: string;
  itemIn: {
    name: string;
    evaluatedValue: number;
    category?: string;
  };
  tradeBalance: number;
  direction: 'received' | 'paid' | 'even';
  immediatePaymentMethod?: PaymentMethod;
  immediateCash?: number;
  installments?: {
    count: number;
    value: number;
    dueDay?: number;
  };
  notes?: string;
}

export async function createTradeAction(input: CreateTradeInput): Promise<{ dealId?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Usuário não autenticado.' };
    }

    await assertWritePermission(user.id);

    // 1. Busca item de saída
    const { data: itemOut } = await supabase
      .from('items')
      .select('*, item_costs(*)')
      .eq('id', input.itemOutId)
      .eq('user_id', user.id)
      .single();

    if (!itemOut) {
      return { error: 'Mercadoria entregue não encontrada.' };
    }

    const itemOutCMV = calculateCMV(Number(itemOut.acquisition_cost), itemOut.item_costs || []);
    // Valor total atribuído ao item de saída na permuta
    const dealTotal = input.direction === 'received' 
      ? input.itemIn.evaluatedValue + input.tradeBalance 
      : input.itemIn.evaluatedValue - input.tradeBalance;

    const grossProfit = calculateGrossProfit(dealTotal, [itemOutCMV]);

    // 2. Cadastra novo item que entra na posse do revendedor
    const { data: itemIn, error: inError } = await supabase
      .from('items')
      .insert({
        user_id: user.id,
        name: input.itemIn.name,
        category: input.itemIn.category || null,
        acquisition_cost: input.itemIn.evaluatedValue,
        status: 'disponivel',
        description: `Recebido em troca da negociação`,
      })
      .select('*')
      .single();

    if (inError || !itemIn) {
      return { error: inError?.message || 'Erro ao cadastrar mercadoria recebida em troca.' };
    }

    // 3. Cria Deal
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        user_id: user.id,
        customer_id: input.customerId,
        deal_type: 'troca',
        total_value: dealTotal,
        recognized_profit: grossProfit,
        status: 'concluida',
        notes: input.notes || null,
        source: 'manual',
      })
      .select('*')
      .single();

    if (dealError || !deal) {
      return { error: dealError?.message || 'Erro ao registrar troca.' };
    }

    // 4. Marca item entregue como vendido e associa ambos no deal_items
    await supabase.from('items').update({ status: 'vendido' }).eq('id', itemOut.id);

    await supabase.from('deal_items').insert([
      { deal_id: deal.id, item_id: itemOut.id, direction: 'OUT', evaluated_value: dealTotal },
      { deal_id: deal.id, item_id: itemIn.id, direction: 'IN', evaluated_value: input.itemIn.evaluatedValue },
    ]);

    // 5. Movimentações de Volta (Recebida ou Paga)
    if (input.direction === 'received' && input.immediateCash && input.immediateCash > 0) {
      await supabase.from('cash_movements').insert({
        user_id: user.id,
        deal_id: deal.id,
        direction: 'IN',
        amount: input.immediateCash,
        payment_method: input.immediatePaymentMethod || 'pix',
        description: `Volta recebida na permuta - ${itemIn.name}`,
      });
    } else if (input.direction === 'paid' && input.immediateCash && input.immediateCash > 0) {
      await supabase.from('cash_movements').insert({
        user_id: user.id,
        deal_id: deal.id,
        direction: 'OUT',
        amount: input.immediateCash,
        payment_method: input.immediatePaymentMethod || 'pix',
        description: `Volta paga na permuta - ${itemIn.name}`,
      });
    }

    // 6. Auditoria
    await supabase.from('audit_log').insert({
      user_id: user.id,
      entity_name: 'deals',
      entity_id: deal.id,
      action_type: 'CREATE_TRADE',
      source: 'MANUAL_WEB',
      payload_after: { deal, itemOut, itemIn, input },
    });

    return { dealId: deal.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar permuta.';
    return { error: message };
  }
}
