-- 20260923000004_db_hardening_security.sql
-- Fase 24: Hardening do Banco de Dados e Segurança Estrita Multi-tenant
-- Corrige search_path mutável, valida permissões em SECURITY DEFINER e reforça integridade do audit log

-- 1. handle_updated_at com search_path imutável
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 2. handle_new_user com search_path imutável e proteção SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, trial_started_at, trial_ends_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuário'),
        NOW(),
        NOW() + INTERVAL '7 days'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- 3. get_dashboard_indicators com search_path imutável e validação rigorosa de auth.uid()
CREATE OR REPLACE FUNCTION public.get_dashboard_indicators(p_user_id UUID)
RETURNS TABLE (
    na_rua NUMERIC(12, 2),
    atrasado NUMERIC(12, 2),
    em_mercadoria NUMERIC(12, 2),
    quanto_ganhou_mes NUMERIC(12, 2)
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_na_rua NUMERIC(12, 2) := 0.00;
    v_atrasado NUMERIC(12, 2) := 0.00;
    v_em_mercadoria NUMERIC(12, 2) := 0.00;
    v_quanto_ganhou_mes NUMERIC(12, 2) := 0.00;
BEGIN
    -- Validação de isolamento: usuário autenticado só pode consultar seus próprios indicadores
    IF p_user_id IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() <> p_user_id) THEN
        RAISE EXCEPTION 'Acesso não autorizado aos indicadores deste perfil.';
    END IF;

    -- 1. Na Rua (Soma dos saldos de parcelas a receber em aberto)
    SELECT COALESCE(SUM(i.balance), 0.00)
    INTO v_na_rua
    FROM public.installments i
    JOIN public.receivables r ON r.id = i.receivable_id
    WHERE i.user_id = p_user_id
      AND i.status IN ('pending', 'partially_paid', 'overdue');

    -- 2. Atrasado (Parcelas a receber com vencimento expirado)
    SELECT COALESCE(SUM(i.balance), 0.00)
    INTO v_atrasado
    FROM public.installments i
    JOIN public.receivables r ON r.id = i.receivable_id
    WHERE i.user_id = p_user_id
      AND i.due_date < CURRENT_DATE
      AND i.status IN ('pending', 'partially_paid', 'overdue');

    -- 3. Em Mercadoria (Custo de compra + custos adicionais do estoque ativo)
    WITH item_base AS (
        SELECT it.id, it.acquisition_cost
        FROM public.items it
        WHERE it.user_id = p_user_id
          AND it.status IN ('disponivel', 'em_preparacao', 'reservado')
    ),
    item_extra AS (
        SELECT ic.item_id, COALESCE(SUM(ic.amount), 0.00) AS total_extra
        FROM public.item_costs ic
        WHERE ic.user_id = p_user_id
        GROUP BY ic.item_id
    )
    SELECT COALESCE(SUM(ib.acquisition_cost + COALESCE(ie.total_extra, 0.00)), 0.00)
    INTO v_em_mercadoria
    FROM item_base ib
    LEFT JOIN item_extra ie ON ie.item_id = ib.id;

    -- 4. Quanto Ganhou no Mês Corrente (Lucro reconhecido em negócios concluídos)
    SELECT COALESCE(SUM(d.recognized_profit), 0.00)
    INTO v_quanto_ganhou_mes
    FROM public.deals d
    WHERE d.user_id = p_user_id
      AND d.status = 'concluida'
      AND d.deal_date >= DATE_TRUNC('month', CURRENT_DATE)::DATE;

    RETURN QUERY SELECT v_na_rua, v_atrasado, v_em_mercadoria, v_quanto_ganhou_mes;
END;
$$;

-- 4. handle_installment_payment_received com search_path imutável
CREATE OR REPLACE FUNCTION public.handle_installment_payment_received()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_installment RECORD;
    v_new_paid NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
    v_new_status TEXT;
BEGIN
    SELECT * INTO v_installment FROM public.installments WHERE id = NEW.installment_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela % não encontrada.', NEW.installment_id;
    END IF;

    v_new_paid := v_installment.paid_value + NEW.amount;
    v_new_balance := v_installment.original_value - v_new_paid;

    IF v_new_balance <= 0 THEN
        v_new_status := 'paid';
        v_new_balance := 0.00;
    ELSE
        v_new_status := 'partially_paid';
    END IF;

    -- Atualiza a parcela
    UPDATE public.installments
    SET paid_value = v_new_paid,
        balance = v_new_balance,
        status = v_new_status,
        updated_at = NOW()
    WHERE id = NEW.installment_id;

    -- Se vinculada a um receivable, atualiza o acumulado do receivable
    IF v_installment.receivable_id IS NOT NULL THEN
        UPDATE public.receivables
        SET paid_amount = paid_amount + NEW.amount,
            balance = GREATEST(0.00, balance - NEW.amount),
            status = CASE 
                WHEN balance - NEW.amount <= 0 THEN 'paid'
                ELSE 'partially_paid'
            END,
            updated_at = NOW()
        WHERE id = v_installment.receivable_id;
    END IF;

    RETURN NEW;
END;
$$;

-- 5. update_overdue_installments com search_path imutável
CREATE OR REPLACE FUNCTION public.update_overdue_installments()
RETURNS INT 
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated_rows INT;
BEGIN
    UPDATE public.installments
    SET status = 'overdue',
        updated_at = NOW()
    WHERE due_date < CURRENT_DATE
      AND status = 'pending';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RETURN v_updated_rows;
END;
$$;

-- 6. Restrição de privilégios de execução (Least Privilege)
REVOKE EXECUTE ON FUNCTION public.get_dashboard_indicators(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_indicators(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_overdue_installments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_overdue_installments() TO service_role;

-- 7. Imutabilidade do audit_log: garantir que não há políticas de UPDATE ou DELETE
DROP POLICY IF EXISTS "audit_log_update_own" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_delete_own" ON public.audit_log;
