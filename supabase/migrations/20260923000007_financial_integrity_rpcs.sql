-- 20260923000007_financial_integrity_rpcs.sql
-- Fases C, J e M: integridade financeira, histórico obrigatório e validação explícita de IDs.
--
-- Correções:
--  * execute_deal_transaction passa a SECURITY INVOKER (RLS como defesa em profundidade) e valida
--    explicitamente customer_id/item_id do payload contra auth.uid(). Também corrige colunas e valores
--    que violavam CHECKs (deals.source, audit_log.source, adjustments.adjustment_type, payables.customer_id).
--  * Abatimentos passam a ser acumulados em installments.adjusted_value. Antes, o abatimento reduzia o
--    saldo "na mão" e o próximo pagamento recalculava balance = original - paid, apagando o abatimento.
--  * Pagamento acima do saldo da parcela é rejeitado (nunca absorvido silenciosamente).
--  * receivables/payables são recalculados a partir das parcelas por trigger.
--  * Novas RPCs atômicas: apply_obligation_settlement (pagamento/abatimento/quitação sobre UMA dívida
--    resolvida) e reschedule_installment (mudança de vencimento com auditoria).

-- 1. Colunas de abatimento acumulado ------------------------------------------------------------
ALTER TABLE public.installments ADD COLUMN IF NOT EXISTS adjusted_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.installments DROP CONSTRAINT IF EXISTS installments_adjusted_value_check;
ALTER TABLE public.installments ADD CONSTRAINT installments_adjusted_value_check CHECK (adjusted_value >= 0);

ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.receivables DROP CONSTRAINT IF EXISTS receivables_adjusted_amount_check;
ALTER TABLE public.receivables ADD CONSTRAINT receivables_adjusted_amount_check CHECK (adjusted_amount >= 0);

ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_adjusted_amount_check;
ALTER TABLE public.payables ADD CONSTRAINT payables_adjusted_amount_check CHECK (adjusted_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_installments_receivable ON public.installments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_installments_payable ON public.installments(payable_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_installment ON public.adjustments(installment_id);
CREATE INDEX IF NOT EXISTS idx_receivables_deal ON public.receivables(deal_id);
CREATE INDEX IF NOT EXISTS idx_payables_deal ON public.payables(deal_id);

-- 2. Pagamento de parcela: rejeita excesso e considera abatimentos -----------------------------
CREATE OR REPLACE FUNCTION public.handle_installment_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inst public.installments%ROWTYPE;
    v_new_paid NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
BEGIN
    SELECT * INTO v_inst FROM public.installments WHERE id = NEW.installment_id FOR UPDATE;

    IF NOT FOUND OR v_inst.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Parcela % não encontrada para este usuário.', NEW.installment_id
            USING ERRCODE = '42501';
    END IF;

    IF v_inst.status IN ('paid', 'canceled') THEN
        RAISE EXCEPTION 'Parcela % já está quitada ou cancelada.', v_inst.installment_number;
    END IF;

    IF NEW.amount > v_inst.balance THEN
        RAISE EXCEPTION 'Pagamento de % excede o saldo de % da parcela %.', NEW.amount, v_inst.balance, v_inst.installment_number
            USING HINT = 'EXCEEDS_BALANCE';
    END IF;

    v_new_paid := v_inst.paid_value + NEW.amount;
    v_new_balance := v_inst.original_value - v_new_paid - v_inst.adjusted_value;

    UPDATE public.installments
    SET paid_value = v_new_paid,
        balance = GREATEST(v_new_balance, 0.00),
        status = CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partially_paid' END,
        updated_at = NOW()
    WHERE id = v_inst.id;

    RETURN NEW;
END;
$$;

-- 3. Abatimento de parcela: histórico em adjustments, saldo via trigger ------------------------
CREATE OR REPLACE FUNCTION public.handle_installment_adjustment_applied()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inst public.installments%ROWTYPE;
    v_new_adjusted NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
BEGIN
    IF NEW.installment_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_inst FROM public.installments WHERE id = NEW.installment_id FOR UPDATE;

    IF NOT FOUND OR v_inst.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Parcela % não encontrada para este usuário.', NEW.installment_id
            USING ERRCODE = '42501';
    END IF;

    IF v_inst.status IN ('paid', 'canceled') THEN
        RAISE EXCEPTION 'Parcela % já está quitada ou cancelada.', v_inst.installment_number;
    END IF;

    IF NEW.amount > v_inst.balance THEN
        RAISE EXCEPTION 'Abatimento de % excede o saldo de % da parcela %.', NEW.amount, v_inst.balance, v_inst.installment_number
            USING HINT = 'EXCEEDS_BALANCE';
    END IF;

    v_new_adjusted := v_inst.adjusted_value + NEW.amount;
    v_new_balance := v_inst.original_value - v_inst.paid_value - v_new_adjusted;

    UPDATE public.installments
    SET adjusted_value = v_new_adjusted,
        balance = GREATEST(v_new_balance, 0.00),
        status = CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partially_paid' END,
        updated_at = NOW()
    WHERE id = v_inst.id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_adjustment_created ON public.adjustments;
CREATE TRIGGER on_adjustment_created
AFTER INSERT ON public.adjustments
FOR EACH ROW EXECUTE FUNCTION public.handle_installment_adjustment_applied();

-- 4. Totais de receivable/payable derivados das parcelas ---------------------------------------
CREATE OR REPLACE FUNCTION public.handle_installment_totals_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_paid NUMERIC(12, 2);
    v_adjusted NUMERIC(12, 2);
    v_balance NUMERIC(12, 2);
BEGIN
    IF NEW.receivable_id IS NOT NULL THEN
        SELECT COALESCE(SUM(paid_value), 0), COALESCE(SUM(adjusted_value), 0),
               COALESCE(SUM(balance) FILTER (WHERE status <> 'canceled'), 0)
        INTO v_paid, v_adjusted, v_balance
        FROM public.installments WHERE receivable_id = NEW.receivable_id;

        UPDATE public.receivables
        SET paid_amount = v_paid,
            adjusted_amount = v_adjusted,
            balance = v_balance,
            status = CASE
                WHEN status IN ('canceled', 'renegotiated') THEN status
                WHEN v_balance <= 0 THEN 'paid'
                WHEN v_paid + v_adjusted > 0 THEN 'partially_paid'
                ELSE 'pending'
            END,
            updated_at = NOW()
        WHERE id = NEW.receivable_id;
    ELSIF NEW.payable_id IS NOT NULL THEN
        SELECT COALESCE(SUM(paid_value), 0), COALESCE(SUM(adjusted_value), 0),
               COALESCE(SUM(balance) FILTER (WHERE status <> 'canceled'), 0)
        INTO v_paid, v_adjusted, v_balance
        FROM public.installments WHERE payable_id = NEW.payable_id;

        UPDATE public.payables
        SET paid_amount = v_paid,
            adjusted_amount = v_adjusted,
            balance = v_balance,
            status = CASE
                WHEN status IN ('canceled', 'renegotiated') THEN status
                WHEN v_balance <= 0 THEN 'paid'
                WHEN v_paid + v_adjusted > 0 THEN 'partially_paid'
                ELSE 'pending'
            END,
            updated_at = NOW()
        WHERE id = NEW.payable_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_installment_totals_changed ON public.installments;
CREATE TRIGGER on_installment_totals_changed
AFTER UPDATE OF paid_value, adjusted_value, balance, status ON public.installments
FOR EACH ROW EXECUTE FUNCTION public.handle_installment_totals_changed();

-- 5. execute_deal_transaction: INVOKER + validação explícita de IDs -----------------------------
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

    -- Itens de saída: precisam pertencer ao usuário e estar disponíveis
    FOR v_item IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'items_out', '[]'::jsonb))
            AS x(item_id UUID, evaluated_value NUMERIC)
    LOOP
        IF v_item.item_id IS NULL OR COALESCE(v_item.evaluated_value, 0) < 0 THEN
            RAISE EXCEPTION 'Item de saída inválido no payload.';
        END IF;

        PERFORM 1 FROM public.items
        WHERE id = v_item.item_id AND user_id = v_user_id AND status = 'disponivel'
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Mercadoria % não encontrada ou não está disponível para venda.', v_item.item_id
                USING ERRCODE = '42501';
        END IF;

        UPDATE public.items SET status = 'vendido', updated_at = NOW()
        WHERE id = v_item.item_id AND user_id = v_user_id;

        INSERT INTO public.deal_items (deal_id, item_id, direction, evaluated_value)
        VALUES (v_deal_id, v_item.item_id, 'OUT', COALESCE(v_item.evaluated_value, 0.00));
    END LOOP;

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
        'items_in_ids', to_jsonb(v_items_in_ids)
    );
END;
$$;

-- 6. apply_obligation_settlement: pagamento / abatimento / quitação sobre UMA dívida ------------
-- Payload:
--   receivable_id | payable_id (exatamente um), kind ('payment' | 'adjustment'),
--   amount (obrigatório salvo settle_full), settle_full (bool), installment_id (opcional: parcela alvo),
--   payment_method, adjustment_type, reason, source ('voice' | 'manual')
-- Sem installment_id, o valor é alocado nas parcelas abertas DESTA dívida por vencimento
-- (mais antigas primeiro). Nunca atravessa para outra dívida ou outro cliente.
CREATE OR REPLACE FUNCTION public.apply_obligation_settlement(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_kind TEXT;
    v_receivable_id UUID;
    v_payable_id UUID;
    v_installment_id UUID;
    v_settle_full BOOLEAN;
    v_amount NUMERIC(12, 2);
    v_remaining NUMERIC(12, 2);
    v_open_total NUMERIC(12, 2);
    v_alloc NUMERIC(12, 2);
    v_deal_id UUID;
    v_customer_id UUID;
    v_balance_before NUMERIC(12, 2);
    v_method TEXT;
    v_adj_type TEXT;
    v_reason TEXT;
    v_audit_source TEXT;
    v_inst RECORD;
    v_allocations JSONB := '[]'::jsonb;
    v_final RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    v_kind := p_payload->>'kind';
    IF v_kind NOT IN ('payment', 'adjustment') THEN
        RAISE EXCEPTION 'Tipo de liquidação inválido: %', v_kind;
    END IF;

    v_receivable_id := NULLIF(p_payload->>'receivable_id', '')::UUID;
    v_payable_id := NULLIF(p_payload->>'payable_id', '')::UUID;
    IF (v_receivable_id IS NULL) = (v_payable_id IS NULL) THEN
        RAISE EXCEPTION 'Informe exatamente uma dívida (receivable_id ou payable_id).';
    END IF;

    v_installment_id := NULLIF(p_payload->>'installment_id', '')::UUID;
    v_settle_full := COALESCE((p_payload->>'settle_full')::BOOLEAN, false);
    v_amount := NULLIF(p_payload->>'amount', '')::NUMERIC;
    v_reason := p_payload->>'reason';
    v_audit_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant')
        THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END;

    IF NOT v_settle_full AND (v_amount IS NULL OR v_amount <= 0) THEN
        RAISE EXCEPTION 'Valor da liquidação deve ser maior que zero.';
    END IF;

    -- Dívida alvo: pertence ao usuário e está aberta (bloqueio para concorrência)
    IF v_receivable_id IS NOT NULL THEN
        SELECT deal_id, customer_id, balance INTO v_deal_id, v_customer_id, v_balance_before
        FROM public.receivables
        WHERE id = v_receivable_id AND user_id = v_user_id AND status IN ('pending', 'partially_paid')
        FOR UPDATE;
    ELSE
        SELECT deal_id, customer_id, balance INTO v_deal_id, v_customer_id, v_balance_before
        FROM public.payables
        WHERE id = v_payable_id AND user_id = v_user_id AND status IN ('pending', 'partially_paid')
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dívida não encontrada ou já encerrada para este usuário.' USING ERRCODE = '42501';
    END IF;

    IF v_kind = 'payment' THEN
        v_method := CASE COALESCE(p_payload->>'payment_method', 'pix') WHEN 'card' THEN 'credit_card' ELSE COALESCE(p_payload->>'payment_method', 'pix') END;
        IF v_method NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'bank_transfer', 'other') THEN
            RAISE EXCEPTION 'Forma de pagamento inválida: %', v_method;
        END IF;
    ELSE
        v_adj_type := CASE COALESCE(p_payload->>'adjustment_type', 'discount')
            WHEN 'item_offset' THEN 'item_trade_in'
            WHEN 'service_offset' THEN 'service_labor'
            WHEN 'debt_offset' THEN 'write_off'
            WHEN 'manual_adjustment' THEN 'write_off'
            ELSE COALESCE(p_payload->>'adjustment_type', 'discount')
        END;
        IF v_adj_type NOT IN ('item_trade_in', 'service_labor', 'discount', 'write_off') THEN
            RAISE EXCEPTION 'Tipo de abatimento inválido: %', p_payload->>'adjustment_type';
        END IF;
    END IF;

    -- Parcelas elegíveis da dívida alvo (somente dela)
    SELECT COALESCE(SUM(balance), 0) INTO v_open_total
    FROM public.installments
    WHERE user_id = v_user_id
      AND (receivable_id = v_receivable_id OR payable_id = v_payable_id)
      AND (v_installment_id IS NULL OR id = v_installment_id)
      AND status NOT IN ('paid', 'canceled')
      AND balance > 0;

    IF v_installment_id IS NOT NULL AND v_open_total = 0 THEN
        RAISE EXCEPTION 'Parcela % não pertence a esta dívida ou já está quitada.', v_installment_id USING ERRCODE = '42501';
    END IF;

    IF v_settle_full THEN
        v_amount := v_open_total;
    END IF;

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Não há saldo em aberto nesta dívida.';
    END IF;

    IF v_amount > v_open_total THEN
        RAISE EXCEPTION 'Valor de % excede o saldo em aberto de %.', v_amount, v_open_total USING HINT = 'EXCEEDS_BALANCE';
    END IF;

    v_remaining := v_amount;
    FOR v_inst IN
        SELECT id, installment_number, balance
        FROM public.installments
        WHERE user_id = v_user_id
          AND (receivable_id = v_receivable_id OR payable_id = v_payable_id)
          AND (v_installment_id IS NULL OR id = v_installment_id)
          AND status NOT IN ('paid', 'canceled')
          AND balance > 0
        ORDER BY due_date ASC, installment_number ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_alloc := LEAST(v_remaining, v_inst.balance);

        IF v_kind = 'payment' THEN
            INSERT INTO public.payments (user_id, installment_id, amount, payment_method, notes, payment_date)
            VALUES (v_user_id, v_inst.id, v_alloc, v_method, v_reason, CURRENT_DATE);
        ELSE
            INSERT INTO public.adjustments (user_id, deal_id, installment_id, adjustment_type, amount, reason)
            VALUES (v_user_id, v_deal_id, v_inst.id, v_adj_type, v_alloc, COALESCE(v_reason, 'Abatimento'));
        END IF;

        v_allocations := v_allocations || jsonb_build_object(
            'installment_id', v_inst.id,
            'installment_number', v_inst.installment_number,
            'amount', v_alloc,
            'balance_before', v_inst.balance,
            'balance_after', v_inst.balance - v_alloc
        );
        v_remaining := v_remaining - v_alloc;
    END LOOP;

    -- Pagamento movimenta caixa; abatimento NÃO movimenta caixa
    IF v_kind = 'payment' THEN
        INSERT INTO public.cash_movements (user_id, deal_id, direction, amount, payment_method, description)
        VALUES (
            v_user_id, v_deal_id,
            CASE WHEN v_receivable_id IS NOT NULL THEN 'IN' ELSE 'OUT' END,
            v_amount, v_method,
            COALESCE(v_reason, CASE WHEN v_receivable_id IS NOT NULL THEN 'Recebimento de parcela' ELSE 'Pagamento de parcela' END)
        );
    END IF;

    IF v_receivable_id IS NOT NULL THEN
        SELECT balance, status INTO v_final FROM public.receivables WHERE id = v_receivable_id;
    ELSE
        SELECT balance, status INTO v_final FROM public.payables WHERE id = v_payable_id;
    END IF;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id,
        CASE WHEN v_receivable_id IS NOT NULL THEN 'receivables' ELSE 'payables' END,
        COALESCE(v_receivable_id, v_payable_id),
        CASE WHEN v_kind = 'payment' THEN 'REGISTER_PAYMENT' ELSE 'REGISTER_ADJUSTMENT' END,
        v_audit_source,
        jsonb_build_object('balance', v_balance_before),
        jsonb_build_object(
            'kind', v_kind, 'amount', v_amount, 'settle_full', v_settle_full,
            'payment_method', v_method, 'adjustment_type', v_adj_type, 'reason', v_reason,
            'allocations', v_allocations, 'balance', v_final.balance, 'status', v_final.status
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'kind', v_kind,
        'amount', v_amount,
        'deal_id', v_deal_id,
        'customer_id', v_customer_id,
        'receivable_id', v_receivable_id,
        'payable_id', v_payable_id,
        'allocations', v_allocations,
        'obligation_balance', v_final.balance,
        'obligation_status', v_final.status
    );
END;
$$;

-- 7. reschedule_installment: mudança de vencimento com histórico --------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_installment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_installment_id UUID;
    v_new_due DATE;
    v_inst public.installments%ROWTYPE;
    v_new_status TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    v_installment_id := NULLIF(p_payload->>'installment_id', '')::UUID;
    v_new_due := NULLIF(p_payload->>'new_due_date', '')::DATE;
    IF v_installment_id IS NULL OR v_new_due IS NULL THEN
        RAISE EXCEPTION 'Parcela e nova data de vencimento são obrigatórias.';
    END IF;

    SELECT * INTO v_inst FROM public.installments
    WHERE id = v_installment_id AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;

    IF v_inst.status IN ('paid', 'canceled') THEN
        RAISE EXCEPTION 'Parcela % já está quitada ou cancelada.', v_inst.installment_number;
    END IF;

    v_new_status := CASE WHEN v_inst.status = 'overdue' AND v_new_due >= CURRENT_DATE THEN 'pending' ELSE v_inst.status END;

    UPDATE public.installments
    SET due_date = v_new_due, status = v_new_status, updated_at = NOW()
    WHERE id = v_inst.id;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id, 'installments', v_inst.id, 'UPDATE_DUE_DATE',
        CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
        jsonb_build_object('due_date', v_inst.due_date, 'status', v_inst.status),
        jsonb_build_object('due_date', v_new_due, 'status', v_new_status, 'reason', p_payload->>'reason')
    );

    RETURN jsonb_build_object(
        'success', true,
        'installment_id', v_inst.id,
        'installment_number', v_inst.installment_number,
        'previous_due_date', v_inst.due_date,
        'new_due_date', v_new_due
    );
END;
$$;

-- 8. Privilégios ---------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_deal_transaction(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_obligation_settlement(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_obligation_settlement(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_obligation_settlement(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reschedule_installment(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_installment(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_installment(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_installment_adjustment_applied() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_adjustment_applied() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_installment_totals_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_totals_changed() FROM anon, authenticated;
