-- 20260923000015_sell_without_stock.sql
-- Vender não fica refém do estoque.
-- "Vendi o iPhone 13 pro Carlos por 3 mil" sem o iPhone cadastrado: a venda é registrada e a mercadoria
-- nasce já vendida DENTRO da mesma transação. Se o custo não foi dito, ele fica pendente (items.cost_pending)
-- e o lucro do negócio não entra no "Ganhei este mês" (deals.profit_pending, recognized_profit = 0) até o
-- usuário informar quanto pagou (resolve_item_cost recalcula o lucro). Nada de lucro inventado.
-- Item reservado também pode ser vendido (a reserva era justamente para uma venda).

-- 1. Colunas -------------------------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS cost_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS profit_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_items_cost_pending ON public.items(user_id) WHERE cost_pending;

-- 2. execute_deal_transaction: itens de saída sem estoque -----------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_deal_transaction(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_deal_id UUID;
    v_customer_id UUID;
    v_idempotency_key TEXT;
    v_existing_deal_id UUID;
    v_item RECORD;
    v_item_in RECORD;
    v_new_item_id UUID;
    v_cash RECORD;
    v_rec RECORD;
    v_rec_id UUID;
    v_inst RECORD;
    v_pay RECORD;
    v_pay_id UUID;
    v_adj RECORD;
    v_deal_type TEXT;
    v_total_value NUMERIC(12, 2);
    v_recognized_profit NUMERIC(12, 2);
    v_source_raw TEXT;
    v_deal_source TEXT;
    v_audit_source TEXT;
    v_deal_date DATE;
    v_notes TEXT;
    v_method TEXT;
    v_adj_type TEXT;
    v_inst_sum NUMERIC(12, 2);
    v_receivable_ids UUID[] := ARRAY[]::UUID[];
    v_payable_ids UUID[] := ARRAY[]::UUID[];
    v_items_in_ids UUID[] := ARRAY[]::UUID[];
    v_items_out_ids UUID[] := ARRAY[]::UUID[];
    v_out_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    -- Idempotência
    v_idempotency_key := NULLIF(p_payload->>'idempotency_key', '');
    IF v_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_deal_id
        FROM public.deals
        WHERE user_id = v_user_id AND idempotency_key = v_idempotency_key;

        IF v_existing_deal_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'deal_id', v_existing_deal_id, 'already_executed', true);
        END IF;
    END IF;

    v_deal_type := COALESCE(p_payload->>'deal_type', 'venda');
    IF v_deal_type NOT IN ('venda', 'compra', 'troca', 'renegociacao', 'avulso') THEN
        RAISE EXCEPTION 'Tipo de negociação inválido: %', v_deal_type;
    END IF;

    v_total_value := COALESCE((p_payload->>'total_value')::NUMERIC, 0.00);
    v_recognized_profit := COALESCE((p_payload->>'recognized_profit')::NUMERIC, 0.00);
    v_deal_date := COALESCE((p_payload->>'deal_date')::DATE, CURRENT_DATE);
    v_notes := p_payload->>'notes';

    v_source_raw := lower(COALESCE(p_payload->>'source', 'voice'));
    v_deal_source := CASE WHEN v_source_raw IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;
    v_audit_source := CASE WHEN v_deal_source = 'voice' THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END;

    -- Cliente: obrigatório e pertencente ao usuário autenticado (nunca confiar no payload)
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::UUID;
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cliente obrigatório para registrar a negociação.';
    END IF;
    PERFORM 1 FROM public.customers WHERE id = v_customer_id AND user_id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente % não encontrado para este usuário.', v_customer_id USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.deals (
        user_id, customer_id, deal_type, total_value, recognized_profit,
        status, idempotency_key, notes, source, deal_date
    ) VALUES (
        v_user_id, v_customer_id, v_deal_type, v_total_value, v_recognized_profit,
        'concluida', v_idempotency_key, v_notes, v_deal_source, v_deal_date
    ) RETURNING id INTO v_deal_id;

    -- Itens de saída: do estoque (disponível ou reservado) OU vendidos sem estar no estoque.
    -- Sem item_id e com nome, a mercadoria nasce já vendida; custo desconhecido fica pendente e o
    -- lucro do negócio não é reconhecido até o custo ser informado (resolve_item_cost).
    FOR v_item IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'items_out', '[]'::jsonb))
            AS x(item_id UUID, evaluated_value NUMERIC, name TEXT, acquisition_cost NUMERIC, category TEXT)
    LOOP
        IF COALESCE(v_item.evaluated_value, 0) < 0 OR COALESCE(v_item.acquisition_cost, 0) < 0 THEN
            RAISE EXCEPTION 'Item de saída inválido no payload.';
        END IF;

        IF v_item.item_id IS NOT NULL THEN
            PERFORM 1 FROM public.items
            WHERE id = v_item.item_id AND user_id = v_user_id AND status IN ('disponivel', 'reservado')
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Mercadoria % não encontrada ou não está disponível para venda.', v_item.item_id
                    USING ERRCODE = '42501';
            END IF;

            UPDATE public.items SET status = 'vendido', updated_at = NOW()
            WHERE id = v_item.item_id AND user_id = v_user_id;
            v_out_id := v_item.item_id;
        ELSIF NULLIF(trim(v_item.name), '') IS NOT NULL THEN
            INSERT INTO public.items (user_id, name, category, acquisition_cost, cost_pending, status)
            VALUES (
                v_user_id,
                LEFT(trim(v_item.name), 160),
                v_item.category,
                COALESCE(v_item.acquisition_cost, 0.00),
                v_item.acquisition_cost IS NULL,
                'vendido'
            ) RETURNING id INTO v_out_id;
            v_items_out_ids := v_items_out_ids || v_out_id;
        ELSE
            RAISE EXCEPTION 'Item de saída inválido no payload.';
        END IF;

        INSERT INTO public.deal_items (deal_id, item_id, direction, evaluated_value)
        VALUES (v_deal_id, v_out_id, 'OUT', COALESCE(v_item.evaluated_value, 0.00));
    END LOOP;

    -- Custo desconhecido de qualquer item entregue: lucro pendente (nunca lucro inventado)
    IF EXISTS (
        SELECT 1 FROM public.deal_items di JOIN public.items i ON i.id = di.item_id
        WHERE di.deal_id = v_deal_id AND di.direction = 'OUT' AND i.cost_pending
    ) THEN
        UPDATE public.deals SET recognized_profit = 0.00, profit_pending = true WHERE id = v_deal_id;
    END IF;

    -- Itens de entrada: nova mercadoria no estoque do próprio usuário
    FOR v_item_in IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'items_in', '[]'::jsonb))
            AS x(name TEXT, evaluated_value NUMERIC, category TEXT)
    LOOP
        IF COALESCE(v_item_in.evaluated_value, 0) < 0 THEN
            RAISE EXCEPTION 'Valor de item recebido inválido.';
        END IF;

        INSERT INTO public.items (user_id, name, acquisition_cost, category, status)
        VALUES (
            v_user_id,
            COALESCE(NULLIF(trim(v_item_in.name), ''), 'Item Recebido na Troca'),
            COALESCE(v_item_in.evaluated_value, 0.00),
            v_item_in.category,
            'disponivel'
        ) RETURNING id INTO v_new_item_id;

        v_items_in_ids := v_items_in_ids || v_new_item_id;

        INSERT INTO public.deal_items (deal_id, item_id, direction, evaluated_value)
        VALUES (v_deal_id, v_new_item_id, 'IN', COALESCE(v_item_in.evaluated_value, 0.00));
    END LOOP;

    -- Movimentações de caixa
    FOR v_cash IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'cash_movements', '[]'::jsonb))
            AS x(direction TEXT, amount NUMERIC, payment_method TEXT, description TEXT)
    LOOP
        IF v_cash.direction NOT IN ('IN', 'OUT') OR v_cash.amount IS NULL OR v_cash.amount < 0 THEN
            RAISE EXCEPTION 'Movimentação de caixa inválida.';
        END IF;

        v_method := CASE COALESCE(v_cash.payment_method, 'pix') WHEN 'card' THEN 'credit_card' ELSE COALESCE(v_cash.payment_method, 'pix') END;
        IF v_method NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'bank_transfer', 'other') THEN
            RAISE EXCEPTION 'Forma de pagamento inválida: %', v_method;
        END IF;

        IF v_cash.amount > 0 THEN
            INSERT INTO public.cash_movements (user_id, deal_id, direction, amount, payment_method, description)
            VALUES (v_user_id, v_deal_id, v_cash.direction, v_cash.amount, v_method,
                    COALESCE(v_cash.description, 'Movimentação da negociação'));
        END IF;
    END LOOP;

    -- Contas a receber e parcelas (soma das parcelas deve fechar com o total)
    FOR v_rec IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'receivables', '[]'::jsonb))
            AS x(total_amount NUMERIC, installments JSONB)
    LOOP
        IF v_rec.total_amount IS NULL OR v_rec.total_amount <= 0 THEN
            RAISE EXCEPTION 'Valor a receber inválido.';
        END IF;

        SELECT COALESCE(SUM((e->>'original_value')::NUMERIC), 0) INTO v_inst_sum
        FROM jsonb_array_elements(COALESCE(v_rec.installments, '[]'::jsonb)) e;
        IF v_inst_sum <> v_rec.total_amount THEN
            RAISE EXCEPTION 'Parcelas (%) não fecham com o valor a receber (%).', v_inst_sum, v_rec.total_amount;
        END IF;

        INSERT INTO public.receivables (user_id, deal_id, customer_id, total_amount, paid_amount, balance, status)
        VALUES (v_user_id, v_deal_id, v_customer_id, v_rec.total_amount, 0.00, v_rec.total_amount, 'pending')
        RETURNING id INTO v_rec_id;

        v_receivable_ids := v_receivable_ids || v_rec_id;

        FOR v_inst IN
            SELECT * FROM jsonb_to_recordset(v_rec.installments)
                AS y(installment_number INT, total_installments INT, original_value NUMERIC, due_date DATE, is_promissory BOOLEAN)
        LOOP
            INSERT INTO public.installments (
                user_id, receivable_id, installment_number, total_installments,
                original_value, paid_value, balance, due_date, status, is_promissory
            ) VALUES (
                v_user_id, v_rec_id, v_inst.installment_number, v_inst.total_installments,
                v_inst.original_value, 0.00, v_inst.original_value, v_inst.due_date, 'pending',
                COALESCE(v_inst.is_promissory, false)
            );
        END LOOP;
    END LOOP;

    -- Contas a pagar e parcelas
    FOR v_pay IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'payables', '[]'::jsonb))
            AS x(total_amount NUMERIC, description TEXT, installments JSONB)
    LOOP
        IF v_pay.total_amount IS NULL OR v_pay.total_amount <= 0 THEN
            RAISE EXCEPTION 'Valor a pagar inválido.';
        END IF;

        SELECT COALESCE(SUM((e->>'original_value')::NUMERIC), 0) INTO v_inst_sum
        FROM jsonb_array_elements(COALESCE(v_pay.installments, '[]'::jsonb)) e;
        IF v_inst_sum <> v_pay.total_amount THEN
            RAISE EXCEPTION 'Parcelas (%) não fecham com o valor a pagar (%).', v_inst_sum, v_pay.total_amount;
        END IF;

        INSERT INTO public.payables (user_id, deal_id, customer_id, total_amount, paid_amount, balance, status)
        VALUES (v_user_id, v_deal_id, v_customer_id, v_pay.total_amount, 0.00, v_pay.total_amount, 'pending')
        RETURNING id INTO v_pay_id;

        v_payable_ids := v_payable_ids || v_pay_id;

        FOR v_inst IN
            SELECT * FROM jsonb_to_recordset(v_pay.installments)
                AS y(installment_number INT, total_installments INT, original_value NUMERIC, due_date DATE, is_promissory BOOLEAN)
        LOOP
            INSERT INTO public.installments (
                user_id, payable_id, installment_number, total_installments,
                original_value, paid_value, balance, due_date, status, is_promissory
            ) VALUES (
                v_user_id, v_pay_id, v_inst.installment_number, v_inst.total_installments,
                v_inst.original_value, 0.00, v_inst.original_value, v_inst.due_date, 'pending',
                COALESCE(v_inst.is_promissory, false)
            );
        END LOOP;
    END LOOP;

    -- Abatimentos da própria negociação (tipos canônicos do DealCommand → tipos do banco)
    FOR v_adj IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'adjustments', '[]'::jsonb))
            AS x(type TEXT, amount NUMERIC, reason TEXT)
    LOOP
        v_adj_type := CASE v_adj.type
            WHEN 'item_offset' THEN 'item_trade_in'
            WHEN 'service_offset' THEN 'service_labor'
            WHEN 'debt_offset' THEN 'write_off'
            WHEN 'manual_adjustment' THEN 'write_off'
            ELSE v_adj.type
        END;
        IF v_adj_type NOT IN ('item_trade_in', 'service_labor', 'discount', 'write_off') THEN
            RAISE EXCEPTION 'Tipo de abatimento inválido: %', v_adj.type;
        END IF;

        IF v_adj.amount > 0 THEN
            INSERT INTO public.adjustments (user_id, deal_id, adjustment_type, amount, reason)
            VALUES (v_user_id, v_deal_id, v_adj_type, v_adj.amount, COALESCE(v_adj.reason, 'Abatimento da negociação'));
        END IF;
    END LOOP;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_after)
    VALUES (v_user_id, 'deals', v_deal_id, 'EXECUTE_DEAL_TRANSACTION_ATOMIC', v_audit_source, p_payload);

    RETURN jsonb_build_object(
        'success', true,
        'deal_id', v_deal_id,
        'receivable_ids', to_jsonb(v_receivable_ids),
        'payable_ids', to_jsonb(v_payable_ids),
        'items_in_ids', to_jsonb(v_items_in_ids),
        'items_out_ids', to_jsonb(v_items_out_ids)
    );
END;
$$;



REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_deal_transaction(JSONB) TO authenticated, service_role;

-- 3. resolve_item_cost: informa o custo pendente e reconhece o lucro dos negócios afetados -------------
CREATE OR REPLACE FUNCTION public.resolve_item_cost(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_item public.items%ROWTYPE;
    v_cost NUMERIC(12, 2);
    v_deal RECORD;
    v_cmv NUMERIC(14, 2);
    v_profit NUMERIC(14, 2);
    v_deals JSONB := '[]'::jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    v_cost := NULLIF(p_payload->>'acquisition_cost', '')::NUMERIC;
    IF v_cost IS NULL OR v_cost < 0 THEN
        RAISE EXCEPTION 'Informe o custo da mercadoria.';
    END IF;

    SELECT * INTO v_item FROM public.items
    WHERE id = NULLIF(p_payload->>'item_id', '')::UUID AND user_id = v_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mercadoria não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_item.cost_pending THEN
        RAISE EXCEPTION 'O custo dessa mercadoria já foi informado.' USING HINT = 'COST_ALREADY_SET';
    END IF;

    UPDATE public.items SET acquisition_cost = v_cost, cost_pending = false, updated_at = NOW() WHERE id = v_item.id;

    FOR v_deal IN
        SELECT d.id, d.total_value FROM public.deals d
        WHERE d.user_id = v_user_id
          AND d.id IN (SELECT deal_id FROM public.deal_items WHERE item_id = v_item.id AND direction = 'OUT')
        FOR UPDATE
    LOOP
        -- Só reconhece o lucro quando nenhum item entregue no negócio continua sem custo
        IF NOT EXISTS (
            SELECT 1 FROM public.deal_items di JOIN public.items i ON i.id = di.item_id
            WHERE di.deal_id = v_deal.id AND di.direction = 'OUT' AND i.cost_pending
        ) THEN
            SELECT COALESCE(SUM(i.acquisition_cost + COALESCE((SELECT SUM(c.amount) FROM public.item_costs c WHERE c.item_id = i.id), 0)), 0)
            INTO v_cmv
            FROM public.deal_items di JOIN public.items i ON i.id = di.item_id
            WHERE di.deal_id = v_deal.id AND di.direction = 'OUT';

            v_profit := v_deal.total_value - v_cmv;
            UPDATE public.deals SET recognized_profit = v_profit, profit_pending = false WHERE id = v_deal.id;
            v_deals := v_deals || jsonb_build_object('deal_id', v_deal.id, 'recognized_profit', v_profit);
        END IF;
    END LOOP;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id, 'items', v_item.id, 'RESOLVE_ITEM_COST',
        CASE WHEN lower(COALESCE(p_payload->>'source', 'manual')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
        jsonb_build_object('acquisition_cost', v_item.acquisition_cost, 'cost_pending', true),
        jsonb_build_object('acquisition_cost', v_cost, 'cost_pending', false, 'deals', v_deals)
    );

    RETURN jsonb_build_object('success', true, 'item_id', v_item.id, 'acquisition_cost', v_cost, 'deals', v_deals);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_item_cost(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_item_cost(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_item_cost(JSONB) TO authenticated, service_role;
