-- 20260923000003_functions_and_views.sql
-- Funções de Banco e Automação Contábil / Indicadores do Painel
-- Banco: PostgreSQL / Supabase

-- 1. Função Determinística para Apuração dos 4 Indicadores da Home
CREATE OR REPLACE FUNCTION public.get_dashboard_indicators(p_user_id UUID)
RETURNS TABLE (
    na_rua NUMERIC(12, 2),
    atrasado NUMERIC(12, 2),
    em_mercadoria NUMERIC(12, 2),
    quanto_ganhou_mes NUMERIC(12, 2)
) AS $$
DECLARE
    v_na_rua NUMERIC(12, 2) := 0.00;
    v_atrasado NUMERIC(12, 2) := 0.00;
    v_em_mercadoria NUMERIC(12, 2) := 0.00;
    v_quanto_ganhou_mes NUMERIC(12, 2) := 0.00;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger de Conciliação Automática ao Inserir Pagamento de Parcela
CREATE OR REPLACE FUNCTION public.handle_installment_payment_received()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_payment_created ON public.payments;
CREATE TRIGGER on_payment_created
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.handle_installment_payment_received();

-- 3. Procedure para Varredura e Atualização de Parcelas Atrasadas
CREATE OR REPLACE FUNCTION public.update_overdue_installments()
RETURNS INT AS $$
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
$$ LANGUAGE plpgsql;
