-- 20260923000005_hardened_atomic_execution.sql
-- Fase A, B e E: Hardening do Supabase, Transação PostgreSQL Atômica e Contexto Persistente

-- 1. Contexto Conversacional Persistente (Fase E)
CREATE TABLE IF NOT EXISTS public.conversation_context (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    last_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    last_customer_name TEXT,
    last_item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
    last_item_name TEXT,
    last_deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    last_receivable_id UUID REFERENCES public.receivables(id) ON DELETE SET NULL,
    pending_question TEXT,
    pending_command JSONB,
    pending_confirmation JSONB,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversation_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_context_select_own" ON public.conversation_context;
CREATE POLICY "conversation_context_select_own" ON public.conversation_context
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversation_context_insert_own" ON public.conversation_context;
CREATE POLICY "conversation_context_insert_own" ON public.conversation_context
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversation_context_update_own" ON public.conversation_context;
CREATE POLICY "conversation_context_update_own" ON public.conversation_context
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversation_context_delete_own" ON public.conversation_context;
CREATE POLICY "conversation_context_delete_own" ON public.conversation_context
    FOR DELETE USING (auth.uid() = user_id);

-- 2. Coluna de Idempotência no Banco (Fase B)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_user_idempotency 
    ON public.deals(user_id, idempotency_key) 
    WHERE idempotency_key IS NOT NULL;

-- 3. RPC Transacional Atômica para Execução de Negócios (Fase B)
CREATE OR REPLACE FUNCTION public.execute_deal_transaction(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    v_source TEXT;
    v_deal_date DATE;
    v_notes TEXT;
BEGIN
    -- 1. Validação de Autenticação
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.';
    END IF;

    -- 2. Idempotência em Nível de Banco
    v_idempotency_key := p_payload->>'idempotency_key';
    IF v_idempotency_key IS NOT NULL AND v_idempotency_key <> '' THEN
        SELECT id INTO v_existing_deal_id
        FROM public.deals
        WHERE user_id = v_user_id AND idempotency_key = v_idempotency_key;

        IF v_existing_deal_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'deal_id', v_existing_deal_id,
                'already_executed', true,
                'message', 'Operação já processada anteriormente.'
            );
        END IF;
    END IF;

    -- 3. Extração dos Dados Principais
    v_deal_type := COALESCE(p_payload->>'deal_type', 'venda');
    v_total_value := COALESCE((p_payload->>'total_value')::NUMERIC, 0.00);
    v_recognized_profit := COALESCE((p_payload->>'recognized_profit')::NUMERIC, 0.00);
    v_source := COALESCE(p_payload->>'source', 'ia_voz');
    v_deal_date := COALESCE((p_payload->>'deal_date')::DATE, CURRENT_DATE);
    v_notes := p_payload->>'notes';

    IF p_payload->>'customer_id' IS NOT NULL AND p_payload->>'customer_id' <> '' THEN
        v_customer_id := (p_payload->>'customer_id')::UUID;
    ELSE
        v_customer_id := NULL;
    END IF;

    -- 4. Criação da Negociação (Deal)
    INSERT INTO public.deals (
        user_id,
        customer_id,
        deal_type,
        total_value,
        recognized_profit,
        status,
        idempotency_key,
        notes,
        source,
        deal_date
    ) VALUES (
        v_user_id,
        v_customer_id,
        v_deal_type,
        v_total_value,
        v_recognized_profit,
        'concluida',
        v_idempotency_key,
        v_notes,
        v_source,
        v_deal_date
    ) RETURNING id INTO v_deal_id;

    -- 5. Itens de Saída (OUT) - Baixa de estoque e vínculo
    FOR v_item IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'items_out', '[]'::jsonb)) AS x(item_id UUID, evaluated_value NUMERIC)
    LOOP
        -- Bloqueio FOR UPDATE para garantir consistência e evitar concorrência
        PERFORM 1 FROM public.items 
        WHERE id = v_item.item_id AND user_id = v_user_id AND status = 'disponivel'
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Mercadoria % não encontrada ou não está disponível para venda.', v_item.item_id;
        END IF;

        UPDATE public.items
        SET status = 'vendido',
            updated_at = NOW()
        WHERE id = v_item.item_id;

        INSERT INTO public.deal_items (
            deal_id,
            item_id,
            direction,
            evaluated_value
        ) VALUES (
            v_deal_id,
            v_item.item_id,
            'OUT',
            COALESCE(v_item.evaluated_value, 0.00)
        );
    END LOOP;

    -- 6. Itens de Entrada (IN) - Cadastro de nova mercadoria no estoque
    FOR v_item_in IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'items_in', '[]'::jsonb)) AS x(name TEXT, evaluated_value NUMERIC, category TEXT)
    LOOP
        INSERT INTO public.items (
            user_id,
            name,
            acquisition_cost,
            category,
            status
        ) VALUES (
            v_user_id,
            COALESCE(v_item_in.name, 'Item Recebido na Troca'),
            COALESCE(v_item_in.evaluated_value, 0.00),
            v_item_in.category,
            'disponivel'
        ) RETURNING id INTO v_new_item_id;

        INSERT INTO public.deal_items (
            deal_id,
            item_id,
            direction,
            evaluated_value
        ) VALUES (
            v_deal_id,
            v_new_item_id,
            'IN',
            COALESCE(v_item_in.evaluated_value, 0.00)
        );
    END LOOP;

    -- 7. Movimentações de Caixa (Cash Movements)
    FOR v_cash IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'cash_movements', '[]'::jsonb)) AS x(direction TEXT, amount NUMERIC, payment_method TEXT, description TEXT)
    LOOP
        IF v_cash.amount > 0 THEN
            INSERT INTO public.cash_movements (
                user_id,
                deal_id,
                direction,
                amount,
                payment_method,
                description
            ) VALUES (
                v_user_id,
                v_deal_id,
                v_cash.direction,
                v_cash.amount,
                COALESCE(v_cash.payment_method, 'pix'),
                COALESCE(v_cash.description, 'Movimentação da negociação')
            );
        END IF;
    END LOOP;

    -- 8. Contas a Receber e Parcelamentos
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'receivables', '[]'::jsonb)) AS x(total_amount NUMERIC, installments JSONB)
    LOOP
        IF v_rec.total_amount > 0 THEN
            INSERT INTO public.receivables (
                user_id,
                deal_id,
                customer_id,
                total_amount,
                paid_amount,
                balance,
                status
            ) VALUES (
                v_user_id,
                v_deal_id,
                v_customer_id,
                v_rec.total_amount,
                0.00,
                v_rec.total_amount,
                'pending'
            ) RETURNING id INTO v_rec_id;

            FOR v_inst IN SELECT * FROM jsonb_to_recordset(COALESCE(v_rec.installments, '[]'::jsonb)) AS y(installment_number INT, total_installments INT, original_value NUMERIC, due_date DATE, is_promissory BOOLEAN)
            LOOP
                INSERT INTO public.installments (
                    user_id,
                    receivable_id,
                    installment_number,
                    total_installments,
                    original_value,
                    paid_value,
                    balance,
                    due_date,
                    status,
                    is_promissory
                ) VALUES (
                    v_user_id,
                    v_rec_id,
                    v_inst.installment_number,
                    v_inst.total_installments,
                    v_inst.original_value,
                    0.00,
                    v_inst.original_value,
                    v_inst.due_date,
                    'pending',
                    COALESCE(v_inst.is_promissory, false)
                );
            END LOOP;
        END IF;
    END LOOP;

    -- 9. Contas a Pagar e Parcelamentos
    FOR v_pay IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'payables', '[]'::jsonb)) AS x(total_amount NUMERIC, description TEXT, installments JSONB)
    LOOP
        IF v_pay.total_amount > 0 THEN
            INSERT INTO public.payables (
                user_id,
                deal_id,
                supplier_id,
                description,
                total_amount,
                paid_amount,
                balance,
                status
            ) VALUES (
                v_user_id,
                v_deal_id,
                v_customer_id,
                COALESCE(v_pay.description, 'Volta a pagar de negociação'),
                v_pay.total_amount,
                0.00,
                v_pay.total_amount,
                'pending'
            ) RETURNING id INTO v_pay_id;

            FOR v_inst IN SELECT * FROM jsonb_to_recordset(COALESCE(v_pay.installments, '[]'::jsonb)) AS y(installment_number INT, total_installments INT, original_value NUMERIC, due_date DATE, is_promissory BOOLEAN)
            LOOP
                INSERT INTO public.installments (
                    user_id,
                    payable_id,
                    installment_number,
                    total_installments,
                    original_value,
                    paid_value,
                    balance,
                    due_date,
                    status,
                    is_promissory
                ) VALUES (
                    v_user_id,
                    v_pay_id,
                    v_inst.installment_number,
                    v_inst.total_installments,
                    v_inst.original_value,
                    0.00,
                    v_inst.original_value,
                    v_inst.due_date,
                    'pending',
                    COALESCE(v_inst.is_promissory, false)
                );
            END LOOP;
        END IF;
    END LOOP;

    -- 10. Abatimentos e Ajustes
    FOR v_adj IN SELECT * FROM jsonb_to_recordset(COALESCE(p_payload->'adjustments', '[]'::jsonb)) AS x(type TEXT, amount NUMERIC, reason TEXT)
    LOOP
        IF v_adj.amount > 0 THEN
            INSERT INTO public.adjustments (
                user_id,
                deal_id,
                type,
                amount,
                reason
            ) VALUES (
                v_user_id,
                v_deal_id,
                v_adj.type,
                v_adj.amount,
                COALESCE(v_adj.reason, 'Abatimento da negociação')
            );
        END IF;
    END LOOP;

    -- 11. Auditoria Imutável
    INSERT INTO public.audit_log (
        user_id,
        entity_name,
        entity_id,
        action_type,
        source,
        payload_after
    ) VALUES (
        v_user_id,
        'deals',
        v_deal_id,
        'EXECUTE_DEAL_TRANSACTION_ATOMIC',
        v_source,
        p_payload
    );

    RETURN jsonb_build_object(
        'success', true,
        'deal_id', v_deal_id
    );
END;
$$;

-- 4. Restrição de Privilégios (Least Privilege)
REVOKE EXECUTE ON FUNCTION public.execute_deal_transaction(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_deal_transaction(JSONB) TO authenticated, service_role;
