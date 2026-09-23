-- 20260923000013_reverse_settlement_locking.sql
-- Correção da 000011 após a 000012 (histórico só-inclusão): reverse_settlement fazia SELECT ... FOR UPDATE
-- em settlements, o que exige privilégio de UPDATE que o usuário não tem mais. Agora trava a dívida
-- (receivable/payable), serializando estornos concorrentes da mesma dívida; o índice único em
-- settlements.reversal_of continua impedindo estorno duplo.

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

    -- settlements é só-inclusão (sem UPDATE para o usuário): a serialização é feita travando a dívida
    SELECT * INTO v_settlement FROM public.settlements
    WHERE id = NULLIF(p_payload->>'settlement_id', '')::UUID AND user_id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operação não encontrada para este usuário.' USING ERRCODE = '42501';
    END IF;
    IF v_settlement.reversal_of IS NOT NULL THEN
        RAISE EXCEPTION 'Esta operação já é um estorno.' USING HINT = 'IS_REVERSAL';
    END IF;

    IF v_settlement.receivable_id IS NOT NULL THEN
        SELECT balance INTO v_balance_before FROM public.receivables WHERE id = v_settlement.receivable_id AND user_id = v_user_id FOR UPDATE;
    ELSE
        SELECT balance INTO v_balance_before FROM public.payables WHERE id = v_settlement.payable_id AND user_id = v_user_id FOR UPDATE;
    END IF;

    -- Idempotência: com a dívida travada, um segundo estorno concorrente espera e cai aqui
    SELECT id INTO v_existing FROM public.settlements WHERE reversal_of = v_settlement.id;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'already_reversed', true, 'reversal_settlement_id', v_existing,
                                  'settlement_id', v_settlement.id, 'amount', v_settlement.amount, 'kind', v_settlement.kind);
    END IF;

    v_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'voice')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;
    v_reason := COALESCE(p_payload->>'reason', 'Estorno');

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

REVOKE ALL ON FUNCTION public.reverse_settlement(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_settlement(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_settlement(JSONB) TO authenticated, service_role;
