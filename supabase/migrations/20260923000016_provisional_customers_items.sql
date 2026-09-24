-- 20260923000016_provisional_customers_items.sql
-- Voz não fica refém de cadastro. Cliente ou mercadoria que a fala citou e não existe (ou nem foi dito)
-- entra como AVULSO (is_provisional): a venda/empréstimo é registrada na hora e depois o usuário
--   • vincula o avulso a um cadastro existente (tudo dele passa para o cadastro e o avulso some), ou
--   • confirma o avulso como cadastro de verdade.
-- Nada de dinheiro muda de valor: vincular só troca a quem os lançamentos pertencem, com auditoria.

-- 1. Flags ---------------------------------------------------------------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_customers_provisional ON public.customers(user_id) WHERE is_provisional;
CREATE INDEX IF NOT EXISTS idx_items_provisional ON public.items(user_id) WHERE is_provisional;

-- Mercadoria que já nasce vendida (não passou pelo estoque) é avulsa por definição
CREATE OR REPLACE FUNCTION public.mark_unstocked_item_provisional()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'vendido' THEN
        NEW.is_provisional := true;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_unstocked_item_provisional() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_unstocked_item_provisional() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_item_insert_mark_provisional ON public.items;
CREATE TRIGGER on_item_insert_mark_provisional
BEFORE INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION public.mark_unstocked_item_provisional();

-- 2. Vincular cliente avulso a um cadastro existente ------------------------------------------------------
-- DEFINER porque settlements é só-inclusão para o cliente (sem UPDATE); a função confere que os dois
-- clientes são do usuário autenticado, que a origem é avulsa e só troca customer_id. Valores intactos.
CREATE OR REPLACE FUNCTION public.merge_provisional_customer(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_source public.customers%ROWTYPE;
    v_target public.customers%ROWTYPE;
    v_counts JSONB;
    n_deals INT; n_rec INT; n_pay INT; n_loans INT; n_set INT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_source FROM public.customers
    WHERE id = NULLIF(p_payload->>'source_id', '')::UUID AND user_id = v_user_id FOR UPDATE;
    SELECT * INTO v_target FROM public.customers
    WHERE id = NULLIF(p_payload->>'target_id', '')::UUID AND user_id = v_user_id FOR UPDATE;

    IF v_source.id IS NULL OR v_target.id IS NULL THEN
        RAISE EXCEPTION 'Cliente não encontrado para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF v_source.id = v_target.id THEN
        RAISE EXCEPTION 'Escolha outro cliente para vincular.';
    END IF;
    IF NOT v_source.is_provisional THEN
        RAISE EXCEPTION 'Só cliente avulso pode ser vinculado.' USING HINT = 'NOT_PROVISIONAL';
    END IF;

    UPDATE public.deals SET customer_id = v_target.id WHERE user_id = v_user_id AND customer_id = v_source.id;
    GET DIAGNOSTICS n_deals = ROW_COUNT;
    UPDATE public.receivables SET customer_id = v_target.id WHERE user_id = v_user_id AND customer_id = v_source.id;
    GET DIAGNOSTICS n_rec = ROW_COUNT;
    UPDATE public.payables SET customer_id = v_target.id WHERE user_id = v_user_id AND customer_id = v_source.id;
    GET DIAGNOSTICS n_pay = ROW_COUNT;
    UPDATE public.loan_contracts SET customer_id = v_target.id WHERE user_id = v_user_id AND customer_id = v_source.id;
    GET DIAGNOSTICS n_loans = ROW_COUNT;
    UPDATE public.settlements SET customer_id = v_target.id WHERE user_id = v_user_id AND customer_id = v_source.id;
    GET DIAGNOSTICS n_set = ROW_COUNT;
    UPDATE public.conversation_context
    SET last_customer_id = v_target.id, last_customer_name = v_target.name
    WHERE user_id = v_user_id AND last_customer_id = v_source.id;

    DELETE FROM public.customers WHERE id = v_source.id AND user_id = v_user_id;

    v_counts := jsonb_build_object('deals', n_deals, 'receivables', n_rec, 'payables', n_pay, 'loan_contracts', n_loans, 'settlements', n_set);
    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (v_user_id, 'customers', v_target.id, 'MERGE_PROVISIONAL_CUSTOMER', 'MANUAL_WEB',
            to_jsonb(v_source), jsonb_build_object('target_id', v_target.id, 'moved', v_counts));

    RETURN jsonb_build_object('success', true, 'target_id', v_target.id, 'moved', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_provisional_customer(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_provisional_customer(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_provisional_customer(JSONB) TO authenticated, service_role;

-- 3. Vincular mercadoria avulsa a uma do estoque -----------------------------------------------------------
-- O negócio passa a apontar para a mercadoria do estoque (que vira vendida); o custo dela entra no lucro.
CREATE OR REPLACE FUNCTION public.merge_provisional_item(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_source public.items%ROWTYPE;
    v_target public.items%ROWTYPE;
    v_deal RECORD;
    v_cmv NUMERIC(14, 2);
    v_deals JSONB := '[]'::jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_source FROM public.items
    WHERE id = NULLIF(p_payload->>'source_id', '')::UUID AND user_id = v_user_id FOR UPDATE;
    SELECT * INTO v_target FROM public.items
    WHERE id = NULLIF(p_payload->>'target_id', '')::UUID AND user_id = v_user_id FOR UPDATE;

    IF v_source.id IS NULL OR v_target.id IS NULL THEN
        RAISE EXCEPTION 'Mercadoria não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_source.is_provisional THEN
        RAISE EXCEPTION 'Só mercadoria avulsa pode ser vinculada.' USING HINT = 'NOT_PROVISIONAL';
    END IF;
    IF v_target.is_provisional OR v_target.status NOT IN ('disponivel', 'reservado') THEN
        RAISE EXCEPTION 'Escolha uma mercadoria disponível no estoque.' USING HINT = 'TARGET_UNAVAILABLE';
    END IF;

    UPDATE public.deal_items SET item_id = v_target.id WHERE item_id = v_source.id;
    UPDATE public.item_costs SET item_id = v_target.id WHERE item_id = v_source.id AND user_id = v_user_id;
    UPDATE public.items SET status = v_source.status, updated_at = NOW() WHERE id = v_target.id;
    UPDATE public.conversation_context SET last_item_id = v_target.id, last_item_name = v_target.name
    WHERE user_id = v_user_id AND last_item_id = v_source.id;
    DELETE FROM public.items WHERE id = v_source.id AND user_id = v_user_id;

    -- Lucro dos negócios afetados com o custo real da mercadoria do estoque
    FOR v_deal IN
        SELECT d.id, d.total_value FROM public.deals d
        WHERE d.user_id = v_user_id
          AND d.id IN (SELECT deal_id FROM public.deal_items WHERE item_id = v_target.id AND direction = 'OUT')
        FOR UPDATE
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.deal_items di JOIN public.items i ON i.id = di.item_id
            WHERE di.deal_id = v_deal.id AND di.direction = 'OUT' AND i.cost_pending
        ) THEN
            SELECT COALESCE(SUM(i.acquisition_cost + COALESCE((SELECT SUM(c.amount) FROM public.item_costs c WHERE c.item_id = i.id), 0)), 0)
            INTO v_cmv
            FROM public.deal_items di JOIN public.items i ON i.id = di.item_id
            WHERE di.deal_id = v_deal.id AND di.direction = 'OUT';
            UPDATE public.deals SET recognized_profit = v_deal.total_value - v_cmv, profit_pending = false WHERE id = v_deal.id;
            v_deals := v_deals || jsonb_build_object('deal_id', v_deal.id, 'recognized_profit', v_deal.total_value - v_cmv);
        END IF;
    END LOOP;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (v_user_id, 'items', v_target.id, 'MERGE_PROVISIONAL_ITEM', 'MANUAL_WEB',
            to_jsonb(v_source), jsonb_build_object('target_id', v_target.id, 'deals', v_deals));

    RETURN jsonb_build_object('success', true, 'target_id', v_target.id, 'deals', v_deals);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_provisional_item(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_provisional_item(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_provisional_item(JSONB) TO authenticated, service_role;
