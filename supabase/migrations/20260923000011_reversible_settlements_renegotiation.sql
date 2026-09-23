-- 20260923000011_reversible_settlements_renegotiation.sql
-- Fases 6 e 7: estorno financeiro real e renegociação de parcelas, sempre preservando histórico.
--
-- Estorno: nada é apagado. Cada liquidação (pagamento ou abatimento) passa a ser uma linha em
-- public.settlements que agrupa os payments/adjustments/cash_movements que ela gerou. Estornar cria
-- uma settlement de estorno (reversal_of → original, única: não dá para estornar duas vezes), com
-- pagamentos/abatimentos NEGATIVOS vinculados um a um ao original e movimento de caixa compensatório.
--
-- Renegociação: parcelas antigas ficam com status 'renegotiated' e renegotiated_value = saldo
-- transferido (saldo delas vai a zero); novas parcelas nascem com renegotiation_id. Invariante mantido:
-- total da dívida = pago + abatido + saldo das parcelas ativas.

-- 1. Colunas e restrições ---------------------------------------------------------------------------
ALTER TABLE public.installments ADD COLUMN IF NOT EXISTS renegotiated_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.installments DROP CONSTRAINT IF EXISTS installments_renegotiated_value_check;
ALTER TABLE public.installments ADD CONSTRAINT installments_renegotiated_value_check CHECK (renegotiated_value >= 0);
ALTER TABLE public.installments DROP CONSTRAINT IF EXISTS installments_status_check;
ALTER TABLE public.installments ADD CONSTRAINT installments_status_check
    CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'canceled', 'renegotiated'));

CREATE TABLE IF NOT EXISTS public.renegotiations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receivable_id UUID REFERENCES public.receivables(id) ON DELETE CASCADE,
    old_installment_ids UUID[] NOT NULL,
    new_installment_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    renegotiated_amount NUMERIC(12, 2) NOT NULL CHECK (renegotiated_amount > 0),
    new_count INT NOT NULL CHECK (new_count > 0),
    source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'manual')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_renegotiations_user ON public.renegotiations(user_id);
CREATE INDEX IF NOT EXISTS idx_renegotiations_receivable ON public.renegotiations(receivable_id);

ALTER TABLE public.installments ADD COLUMN IF NOT EXISTS renegotiation_id UUID REFERENCES public.renegotiations(id) ON DELETE SET NULL;
ALTER TABLE public.installments ADD COLUMN IF NOT EXISTS replaced_by_renegotiation_id UUID REFERENCES public.renegotiations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_installments_renegotiation ON public.installments(renegotiation_id) WHERE renegotiation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installments_replaced_by ON public.installments(replaced_by_renegotiation_id) WHERE replaced_by_renegotiation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('payment', 'adjustment')),
    receivable_id UUID REFERENCES public.receivables(id) ON DELETE CASCADE,
    payable_id UUID REFERENCES public.payables(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT,
    adjustment_type TEXT,
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'manual')),
    reversal_of UUID REFERENCES public.settlements(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((receivable_id IS NULL) <> (payable_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_settlements_user_created ON public.settlements(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_receivable ON public.settlements(receivable_id) WHERE receivable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_payable ON public.settlements(payable_id) WHERE payable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_customer ON public.settlements(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_deal ON public.settlements(deal_id) WHERE deal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_single_reversal ON public.settlements(reversal_of) WHERE reversal_of IS NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.settlements(id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.payments(id) ON DELETE RESTRICT;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_check
    CHECK ((reversal_of IS NULL AND amount > 0) OR (reversal_of IS NOT NULL AND amount < 0));
CREATE INDEX IF NOT EXISTS idx_payments_settlement ON public.payments(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_single_reversal ON public.payments(reversal_of) WHERE reversal_of IS NOT NULL;

ALTER TABLE public.adjustments ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.settlements(id) ON DELETE RESTRICT;
ALTER TABLE public.adjustments ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.adjustments(id) ON DELETE RESTRICT;
ALTER TABLE public.adjustments DROP CONSTRAINT IF EXISTS adjustments_amount_check;
ALTER TABLE public.adjustments ADD CONSTRAINT adjustments_amount_check
    CHECK ((reversal_of IS NULL AND amount > 0) OR (reversal_of IS NOT NULL AND amount < 0));
CREATE INDEX IF NOT EXISTS idx_adjustments_settlement ON public.adjustments(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_adjustments_single_reversal ON public.adjustments(reversal_of) WHERE reversal_of IS NOT NULL;

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.settlements(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.cash_movements(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_cash_movements_settlement ON public.cash_movements(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_single_reversal ON public.cash_movements(reversal_of) WHERE reversal_of IS NOT NULL;

-- RLS das tabelas novas (mesmo padrão do schema; escrita também passa pelo fail-closed de assinatura)
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renegotiations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settlements FROM anon;
REVOKE ALL ON public.renegotiations FROM anon;

DROP POLICY IF EXISTS "settlements_select_own" ON public.settlements;
CREATE POLICY "settlements_select_own" ON public.settlements FOR SELECT USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "settlements_insert_own" ON public.settlements;
CREATE POLICY "settlements_insert_own" ON public.settlements FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "renegotiations_select_own" ON public.renegotiations;
CREATE POLICY "renegotiations_select_own" ON public.renegotiations FOR SELECT USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "renegotiations_insert_own" ON public.renegotiations;
CREATE POLICY "renegotiations_insert_own" ON public.renegotiations FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "renegotiations_update_own" ON public.renegotiations;
CREATE POLICY "renegotiations_update_own" ON public.renegotiations FOR UPDATE
    USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS enforce_write_access ON public.settlements;
CREATE TRIGGER enforce_write_access BEFORE INSERT OR UPDATE OR DELETE ON public.settlements
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_write_access();
DROP TRIGGER IF EXISTS enforce_write_access ON public.renegotiations;
CREATE TRIGGER enforce_write_access BEFORE INSERT OR UPDATE OR DELETE ON public.renegotiations
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_write_access();

-- 2. Triggers de saldo: pagamento/abatimento normal ou estorno exato --------------------------------
CREATE OR REPLACE FUNCTION public.installment_status_for(
    p_original NUMERIC, p_paid NUMERIC, p_adjusted NUMERIC, p_renegotiated NUMERIC, p_due DATE
) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_renegotiated > 0 THEN 'renegotiated'
        WHEN p_original - p_paid - p_adjusted <= 0 THEN 'paid'
        WHEN p_paid + p_adjusted > 0 THEN 'partially_paid'
        WHEN p_due < CURRENT_DATE THEN 'overdue'
        ELSE 'pending'
    END;
$$;

CREATE OR REPLACE FUNCTION public.handle_installment_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inst public.installments%ROWTYPE;
    v_orig public.payments%ROWTYPE;
    v_new_paid NUMERIC(12, 2);
BEGIN
    SELECT * INTO v_inst FROM public.installments WHERE id = NEW.installment_id FOR UPDATE;
    IF NOT FOUND OR v_inst.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Parcela % não encontrada para este usuário.', NEW.installment_id USING ERRCODE = '42501';
    END IF;

    IF NEW.reversal_of IS NULL THEN
        IF v_inst.status IN ('paid', 'canceled', 'renegotiated') THEN
            RAISE EXCEPTION 'Parcela % já está quitada, cancelada ou renegociada.', v_inst.installment_number;
        END IF;
        IF NEW.amount > v_inst.balance THEN
            RAISE EXCEPTION 'Pagamento de % excede o saldo de % da parcela %.', NEW.amount, v_inst.balance, v_inst.installment_number
                USING HINT = 'EXCEEDS_BALANCE';
        END IF;
    ELSE
        SELECT * INTO v_orig FROM public.payments WHERE id = NEW.reversal_of;
        IF NOT FOUND OR v_orig.user_id <> NEW.user_id OR v_orig.installment_id <> NEW.installment_id
           OR v_orig.reversal_of IS NOT NULL OR NEW.amount <> -v_orig.amount THEN
            RAISE EXCEPTION 'Estorno de pagamento inválido.' USING ERRCODE = '42501';
        END IF;
        IF v_inst.status IN ('canceled', 'renegotiated') THEN
            RAISE EXCEPTION 'Parcela % foi renegociada ou cancelada depois do pagamento; estorno bloqueado.', v_inst.installment_number
                USING HINT = 'INSTALLMENT_REPLACED';
        END IF;
    END IF;

    v_new_paid := v_inst.paid_value + NEW.amount;
    IF v_new_paid < 0 THEN
        RAISE EXCEPTION 'Estorno deixaria o valor pago negativo.';
    END IF;

    UPDATE public.installments
    SET paid_value = v_new_paid,
        balance = GREATEST(v_inst.original_value - v_new_paid - v_inst.adjusted_value - v_inst.renegotiated_value, 0.00),
        status = public.installment_status_for(v_inst.original_value, v_new_paid, v_inst.adjusted_value, v_inst.renegotiated_value, v_inst.due_date),
        updated_at = NOW()
    WHERE id = v_inst.id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_installment_adjustment_applied()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inst public.installments%ROWTYPE;
    v_orig public.adjustments%ROWTYPE;
    v_new_adjusted NUMERIC(12, 2);
BEGIN
    IF NEW.installment_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_inst FROM public.installments WHERE id = NEW.installment_id FOR UPDATE;
    IF NOT FOUND OR v_inst.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Parcela % não encontrada para este usuário.', NEW.installment_id USING ERRCODE = '42501';
    END IF;

    IF NEW.reversal_of IS NULL THEN
        IF v_inst.status IN ('paid', 'canceled', 'renegotiated') THEN
            RAISE EXCEPTION 'Parcela % já está quitada, cancelada ou renegociada.', v_inst.installment_number;
        END IF;
        IF NEW.amount > v_inst.balance THEN
            RAISE EXCEPTION 'Abatimento de % excede o saldo de % da parcela %.', NEW.amount, v_inst.balance, v_inst.installment_number
                USING HINT = 'EXCEEDS_BALANCE';
        END IF;
    ELSE
        SELECT * INTO v_orig FROM public.adjustments WHERE id = NEW.reversal_of;
        IF NOT FOUND OR v_orig.user_id <> NEW.user_id OR v_orig.installment_id IS DISTINCT FROM NEW.installment_id
           OR v_orig.reversal_of IS NOT NULL OR NEW.amount <> -v_orig.amount THEN
            RAISE EXCEPTION 'Estorno de abatimento inválido.' USING ERRCODE = '42501';
        END IF;
        IF v_inst.status IN ('canceled', 'renegotiated') THEN
            RAISE EXCEPTION 'Parcela % foi renegociada ou cancelada depois do abatimento; estorno bloqueado.', v_inst.installment_number
                USING HINT = 'INSTALLMENT_REPLACED';
        END IF;
    END IF;

    v_new_adjusted := v_inst.adjusted_value + NEW.amount;
    IF v_new_adjusted < 0 THEN
        RAISE EXCEPTION 'Estorno deixaria o valor abatido negativo.';
    END IF;

    UPDATE public.installments
    SET adjusted_value = v_new_adjusted,
        balance = GREATEST(v_inst.original_value - v_inst.paid_value - v_new_adjusted - v_inst.renegotiated_value, 0.00),
        status = public.installment_status_for(v_inst.original_value, v_inst.paid_value, v_new_adjusted, v_inst.renegotiated_value, v_inst.due_date),
        updated_at = NOW()
    WHERE id = v_inst.id;

    RETURN NEW;
END;
$$;

-- Totais da dívida: renegociado entra no gatilho (saldo muda) e não conta como pago/abatido
DROP TRIGGER IF EXISTS on_installment_totals_changed ON public.installments;
CREATE TRIGGER on_installment_totals_changed
AFTER UPDATE OF paid_value, adjusted_value, renegotiated_value, balance, status ON public.installments
FOR EACH ROW EXECUTE FUNCTION public.handle_installment_totals_changed();

-- Novas parcelas de renegociação também atualizam o total (INSERT)
DROP TRIGGER IF EXISTS on_installment_inserted_totals ON public.installments;
CREATE TRIGGER on_installment_inserted_totals
AFTER INSERT ON public.installments
FOR EACH ROW WHEN (NEW.renegotiation_id IS NOT NULL)
EXECUTE FUNCTION public.handle_installment_totals_changed();

-- 3. Liquidação agora registra uma settlement (agrupador reversível) --------------------------------
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
    v_source TEXT;
    v_audit_source TEXT;
    v_settlement_id UUID;
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
    v_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;
    v_audit_source := CASE WHEN v_source = 'voice' THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END;

    IF NOT v_settle_full AND (v_amount IS NULL OR v_amount <= 0) THEN
        RAISE EXCEPTION 'Valor da liquidação deve ser maior que zero.';
    END IF;

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

    SELECT COALESCE(SUM(balance), 0) INTO v_open_total
    FROM public.installments
    WHERE user_id = v_user_id
      AND (receivable_id = v_receivable_id OR payable_id = v_payable_id)
      AND (v_installment_id IS NULL OR id = v_installment_id)
      AND status NOT IN ('paid', 'canceled', 'renegotiated')
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

    INSERT INTO public.settlements (user_id, kind, receivable_id, payable_id, deal_id, customer_id, amount, payment_method, adjustment_type, reason, source)
    VALUES (v_user_id, v_kind, v_receivable_id, v_payable_id, v_deal_id, v_customer_id, v_amount, v_method, v_adj_type, v_reason, v_source)
    RETURNING id INTO v_settlement_id;

    v_remaining := v_amount;
    FOR v_inst IN
        SELECT id, installment_number, balance
        FROM public.installments
        WHERE user_id = v_user_id
          AND (receivable_id = v_receivable_id OR payable_id = v_payable_id)
          AND (v_installment_id IS NULL OR id = v_installment_id)
          AND status NOT IN ('paid', 'canceled', 'renegotiated')
          AND balance > 0
        ORDER BY due_date ASC, installment_number ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_alloc := LEAST(v_remaining, v_inst.balance);

        IF v_kind = 'payment' THEN
            INSERT INTO public.payments (user_id, installment_id, amount, payment_method, notes, payment_date, settlement_id)
            VALUES (v_user_id, v_inst.id, v_alloc, v_method, v_reason, CURRENT_DATE, v_settlement_id);
        ELSE
            INSERT INTO public.adjustments (user_id, deal_id, installment_id, adjustment_type, amount, reason, settlement_id)
            VALUES (v_user_id, v_deal_id, v_inst.id, v_adj_type, v_alloc, COALESCE(v_reason, 'Abatimento'), v_settlement_id);
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

    IF v_kind = 'payment' THEN
        INSERT INTO public.cash_movements (user_id, deal_id, direction, amount, payment_method, description, settlement_id)
        VALUES (
            v_user_id, v_deal_id,
            CASE WHEN v_receivable_id IS NOT NULL THEN 'IN' ELSE 'OUT' END,
            v_amount, v_method,
            COALESCE(v_reason, CASE WHEN v_receivable_id IS NOT NULL THEN 'Recebimento de parcela' ELSE 'Pagamento de parcela' END),
            v_settlement_id
        );
    END IF;

    IF v_receivable_id IS NOT NULL THEN
        SELECT balance, status INTO v_final FROM public.receivables WHERE id = v_receivable_id;
    ELSE
        SELECT balance, status INTO v_final FROM public.payables WHERE id = v_payable_id;
    END IF;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id, 'settlements', v_settlement_id,
        CASE WHEN v_kind = 'payment' THEN 'REGISTER_PAYMENT' ELSE 'REGISTER_ADJUSTMENT' END,
        v_audit_source,
        jsonb_build_object('balance', v_balance_before),
        jsonb_build_object(
            'settlement_id', v_settlement_id, 'kind', v_kind, 'amount', v_amount, 'settle_full', v_settle_full,
            'receivable_id', v_receivable_id, 'payable_id', v_payable_id,
            'payment_method', v_method, 'adjustment_type', v_adj_type, 'reason', v_reason,
            'allocations', v_allocations, 'balance', v_final.balance, 'status', v_final.status
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'settlement_id', v_settlement_id,
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

-- 4. Estorno de liquidação (idempotente) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_settlement(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_settlement public.settlements%ROWTYPE;
    v_existing UUID;
    v_reversal_id UUID;
    v_source TEXT;
    v_reason TEXT;
    v_row RECORD;
    v_balance_before NUMERIC(12, 2);
    v_final RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_settlement FROM public.settlements
    WHERE id = NULLIF(p_payload->>'settlement_id', '')::UUID AND user_id = v_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operação não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF v_settlement.reversal_of IS NOT NULL THEN
        RAISE EXCEPTION 'Esta operação já é um estorno.' USING HINT = 'IS_REVERSAL';
    END IF;

    SELECT id INTO v_existing FROM public.settlements WHERE reversal_of = v_settlement.id;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'already_reversed', true, 'reversal_settlement_id', v_existing,
                                  'settlement_id', v_settlement.id, 'amount', v_settlement.amount, 'kind', v_settlement.kind);
    END IF;

    v_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;
    v_reason := COALESCE(p_payload->>'reason', 'Estorno');

    IF v_settlement.receivable_id IS NOT NULL THEN
        SELECT balance INTO v_balance_before FROM public.receivables WHERE id = v_settlement.receivable_id FOR UPDATE;
    ELSE
        SELECT balance INTO v_balance_before FROM public.payables WHERE id = v_settlement.payable_id FOR UPDATE;
    END IF;

    INSERT INTO public.settlements (user_id, kind, receivable_id, payable_id, deal_id, customer_id, amount,
                                    payment_method, adjustment_type, reason, source, reversal_of)
    VALUES (v_user_id, v_settlement.kind, v_settlement.receivable_id, v_settlement.payable_id, v_settlement.deal_id,
            v_settlement.customer_id, v_settlement.amount, v_settlement.payment_method, v_settlement.adjustment_type,
            v_reason, v_source, v_settlement.id)
    RETURNING id INTO v_reversal_id;

    FOR v_row IN SELECT * FROM public.payments WHERE settlement_id = v_settlement.id AND reversal_of IS NULL LOOP
        INSERT INTO public.payments (user_id, installment_id, amount, payment_method, notes, payment_date, settlement_id, reversal_of)
        VALUES (v_user_id, v_row.installment_id, -v_row.amount, v_row.payment_method, v_reason, CURRENT_DATE, v_reversal_id, v_row.id);
    END LOOP;

    FOR v_row IN SELECT * FROM public.adjustments WHERE settlement_id = v_settlement.id AND reversal_of IS NULL LOOP
        INSERT INTO public.adjustments (user_id, deal_id, installment_id, adjustment_type, amount, reason, settlement_id, reversal_of)
        VALUES (v_user_id, v_row.deal_id, v_row.installment_id, v_row.adjustment_type, -v_row.amount, v_reason, v_reversal_id, v_row.id);
    END LOOP;

    FOR v_row IN SELECT * FROM public.cash_movements WHERE settlement_id = v_settlement.id AND reversal_of IS NULL LOOP
        INSERT INTO public.cash_movements (user_id, deal_id, direction, amount, payment_method, description, settlement_id, reversal_of)
        VALUES (v_user_id, v_row.deal_id, CASE WHEN v_row.direction = 'IN' THEN 'OUT' ELSE 'IN' END, v_row.amount,
                v_row.payment_method, 'Estorno: ' || COALESCE(v_row.description, ''), v_reversal_id, v_row.id);
    END LOOP;

    IF v_settlement.receivable_id IS NOT NULL THEN
        SELECT balance, status INTO v_final FROM public.receivables WHERE id = v_settlement.receivable_id;
    ELSE
        SELECT balance, status INTO v_final FROM public.payables WHERE id = v_settlement.payable_id;
    END IF;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id, 'settlements', v_reversal_id, 'REVERSE_SETTLEMENT',
        CASE WHEN v_source = 'voice' THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
        jsonb_build_object('settlement_id', v_settlement.id, 'balance', v_balance_before),
        jsonb_build_object('reversal_settlement_id', v_reversal_id, 'kind', v_settlement.kind, 'amount', v_settlement.amount,
                           'reason', v_reason, 'balance', v_final.balance, 'status', v_final.status)
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_reversed', false,
        'settlement_id', v_settlement.id,
        'reversal_settlement_id', v_reversal_id,
        'kind', v_settlement.kind,
        'amount', v_settlement.amount,
        'receivable_id', v_settlement.receivable_id,
        'obligation_balance', v_final.balance,
        'obligation_status', v_final.status
    );
END;
$$;

-- 5. Renegociação de parcelas ------------------------------------------------------------------------
-- Vencimento mensal: dia p_day, p_offset meses após a primeira ocorrência depois de p_base (fim de mês limitado)
CREATE OR REPLACE FUNCTION public.monthly_due_date(p_base DATE, p_day INT, p_offset INT)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_first_month DATE;
    v_target DATE;
    v_last INT;
BEGIN
    v_first_month := date_trunc('month', p_base)::DATE + CASE WHEN EXTRACT(DAY FROM p_base) < p_day THEN 0 ELSE 1 END * INTERVAL '1 month';
    v_target := (v_first_month + p_offset * INTERVAL '1 month')::DATE;
    v_last := EXTRACT(DAY FROM (date_trunc('month', v_target) + INTERVAL '1 month - 1 day'))::INT;
    RETURN make_date(EXTRACT(YEAR FROM v_target)::INT, EXTRACT(MONTH FROM v_target)::INT, LEAST(p_day, v_last));
END;
$$;

CREATE OR REPLACE FUNCTION public.renegotiate_installments(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_receivable_id UUID;
    v_requested UUID[];
    v_selected UUID[];
    v_total NUMERIC(12, 2);
    v_count INT;
    v_amount NUMERIC(12, 2);
    v_due_day INT;
    v_first_due DATE;
    v_base_cents BIGINT;
    v_rest_cents BIGINT;
    v_value NUMERIC(12, 2);
    v_due DATE;
    v_max_number INT;
    v_reneg_id UUID;
    v_new_id UUID;
    v_new_ids UUID[] := ARRAY[]::UUID[];
    v_new_list JSONB := '[]'::jsonb;
    v_old_list JSONB;
    v_source TEXT;
    v_final RECORD;
    i INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    v_receivable_id := NULLIF(p_payload->>'receivable_id', '')::UUID;
    v_count := NULLIF(p_payload->>'new_count', '')::INT;
    v_amount := NULLIF(p_payload->>'new_installment_amount', '')::NUMERIC;
    v_due_day := NULLIF(p_payload->>'due_day', '')::INT;
    v_first_due := NULLIF(p_payload->>'first_due_date', '')::DATE;
    v_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;

    IF v_count IS NULL OR v_count < 1 OR v_count > 120 THEN
        RAISE EXCEPTION 'Quantidade de parcelas inválida.';
    END IF;
    IF v_due_day IS NOT NULL AND (v_due_day < 1 OR v_due_day > 31) THEN
        RAISE EXCEPTION 'Dia de vencimento inválido.';
    END IF;
    IF v_first_due IS NOT NULL AND v_first_due < CURRENT_DATE THEN
        RAISE EXCEPTION 'Primeiro vencimento não pode ser no passado.';
    END IF;

    PERFORM 1 FROM public.receivables
    WHERE id = v_receivable_id AND user_id = v_user_id AND status IN ('pending', 'partially_paid')
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dívida não encontrada ou já encerrada para este usuário.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_payload->'installment_ids') = 'array' AND jsonb_array_length(p_payload->'installment_ids') > 0 THEN
        SELECT array_agg(value::UUID) INTO v_requested FROM jsonb_array_elements_text(p_payload->'installment_ids');
    END IF;

    SELECT array_agg(id ORDER BY due_date, installment_number), COALESCE(SUM(balance), 0)
    INTO v_selected, v_total
    FROM public.installments
    WHERE receivable_id = v_receivable_id AND user_id = v_user_id
      AND status NOT IN ('paid', 'canceled', 'renegotiated') AND balance > 0
      AND (v_requested IS NULL OR id = ANY (v_requested));

    IF v_selected IS NULL THEN
        RAISE EXCEPTION 'Não há parcelas em aberto para renegociar.';
    END IF;
    IF v_requested IS NOT NULL AND cardinality(v_selected) <> cardinality(v_requested) THEN
        RAISE EXCEPTION 'Alguma parcela informada não pertence a esta dívida ou não está em aberto.' USING ERRCODE = '42501';
    END IF;

    -- A conta precisa fechar: nunca criar ou perder dinheiro na renegociação
    IF v_amount IS NOT NULL AND v_amount * v_count <> v_total THEN
        RAISE EXCEPTION 'Novo parcelamento (% x %) não fecha com o saldo renegociado (%).', v_count, v_amount, v_total
            USING HINT = 'SCHEDULE_MISMATCH';
    END IF;

    SELECT jsonb_agg(jsonb_build_object('id', id, 'installment_number', installment_number, 'balance', balance,
                                        'due_date', due_date, 'status', status) ORDER BY due_date, installment_number)
    INTO v_old_list
    FROM public.installments WHERE id = ANY (v_selected);

    INSERT INTO public.renegotiations (user_id, receivable_id, old_installment_ids, renegotiated_amount, new_count, source, reason)
    VALUES (v_user_id, v_receivable_id, v_selected, v_total, v_count, v_source, p_payload->>'reason')
    RETURNING id INTO v_reneg_id;

    UPDATE public.installments
    SET renegotiated_value = balance,
        balance = 0.00,
        status = 'renegotiated',
        replaced_by_renegotiation_id = v_reneg_id,
        updated_at = NOW()
    WHERE id = ANY (v_selected);

    SELECT COALESCE(MAX(installment_number), 0) INTO v_max_number FROM public.installments WHERE receivable_id = v_receivable_id;

    v_base_cents := FLOOR(v_total * 100 / v_count);
    v_rest_cents := (v_total * 100)::BIGINT - v_base_cents * v_count;

    FOR i IN 1..v_count LOOP
        v_value := (v_base_cents + CASE WHEN i <= v_rest_cents THEN 1 ELSE 0 END) / 100.0;
        v_due := CASE
            WHEN v_first_due IS NOT NULL THEN public.monthly_due_date(v_first_due - 1, EXTRACT(DAY FROM v_first_due)::INT, i - 1)
            WHEN v_due_day IS NOT NULL THEN public.monthly_due_date(CURRENT_DATE, v_due_day, i - 1)
            ELSE CURRENT_DATE + 30 * i
        END;

        INSERT INTO public.installments (user_id, receivable_id, installment_number, total_installments, original_value,
                                         paid_value, balance, due_date, status, renegotiation_id)
        VALUES (v_user_id, v_receivable_id, v_max_number + i, v_max_number + v_count, v_value, 0.00, v_value, v_due, 'pending', v_reneg_id)
        RETURNING id INTO v_new_id;

        v_new_ids := v_new_ids || v_new_id;
        v_new_list := v_new_list || jsonb_build_object('id', v_new_id, 'installment_number', v_max_number + i,
                                                       'amount', v_value, 'due_date', v_due);
    END LOOP;

    UPDATE public.renegotiations SET new_installment_ids = v_new_ids WHERE id = v_reneg_id;

    SELECT balance, status INTO v_final FROM public.receivables WHERE id = v_receivable_id;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (v_user_id, 'renegotiations', v_reneg_id, 'RENEGOTIATE_INSTALLMENTS',
            CASE WHEN v_source = 'voice' THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
            jsonb_build_object('receivable_id', v_receivable_id, 'installments', v_old_list),
            jsonb_build_object('renegotiated_amount', v_total, 'new_installments', v_new_list, 'reason', p_payload->>'reason'));

    RETURN jsonb_build_object(
        'success', true,
        'renegotiation_id', v_reneg_id,
        'receivable_id', v_receivable_id,
        'renegotiated_amount', v_total,
        'old_installments', v_old_list,
        'new_installments', v_new_list,
        'obligation_balance', v_final.balance,
        'obligation_status', v_final.status
    );
END;
$$;

-- Vencimento: parcela renegociada não é reagendada
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

    SELECT * INTO v_inst FROM public.installments WHERE id = v_installment_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF v_inst.status IN ('paid', 'canceled', 'renegotiated') THEN
        RAISE EXCEPTION 'Parcela % já está quitada, cancelada ou renegociada.', v_inst.installment_number;
    END IF;

    v_new_status := CASE WHEN v_inst.status = 'overdue' AND v_new_due >= CURRENT_DATE THEN 'pending' ELSE v_inst.status END;

    UPDATE public.installments SET due_date = v_new_due, status = v_new_status, updated_at = NOW() WHERE id = v_inst.id;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_before, payload_after)
    VALUES (
        v_user_id, 'installments', v_inst.id, 'UPDATE_DUE_DATE',
        CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
        jsonb_build_object('due_date', v_inst.due_date, 'status', v_inst.status),
        jsonb_build_object('due_date', v_new_due, 'status', v_new_status, 'reason', p_payload->>'reason')
    );

    RETURN jsonb_build_object('success', true, 'installment_id', v_inst.id, 'installment_number', v_inst.installment_number,
                              'previous_due_date', v_inst.due_date, 'new_due_date', v_new_due);
END;
$$;

-- 6. Privilégios -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_obligation_settlement(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_obligation_settlement(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_obligation_settlement(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reverse_settlement(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_settlement(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_settlement(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.renegotiate_installments(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renegotiate_installments(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.renegotiate_installments(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reschedule_installment(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_installment(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_installment(JSONB) TO authenticated, service_role;

-- Funções puras chamadas dentro de triggers/RPCs INVOKER precisam de EXECUTE para authenticated
REVOKE ALL ON FUNCTION public.installment_status_for(NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installment_status_for(NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.installment_status_for(NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.monthly_due_date(DATE, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.monthly_due_date(DATE, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.monthly_due_date(DATE, INT, INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_installment_adjustment_applied() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_adjustment_applied() FROM anon, authenticated;
