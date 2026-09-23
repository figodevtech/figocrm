-- 20260923000006_restrict_function_execution.sql
-- Fase F: Least privilege nas funções do schema public.
--
-- Contexto: o Supabase concede EXECUTE explicitamente a anon/authenticated/service_role
-- via default privileges. Um "REVOKE ... FROM PUBLIC" NÃO remove esses grants explícitos,
-- por isso as migrations anteriores deixaram `anon` com EXECUTE em todas as funções.
--
-- Além disso, get_dashboard_indicators era SECURITY DEFINER e aceitava qualquer p_user_id
-- quando auth.uid() era NULL (chamada anônima), permitindo leitura de indicadores de
-- qualquer usuário. Ela passa a ser SECURITY INVOKER (RLS se aplica) com validação estrita.

-- 1. execute_deal_transaction: somente authenticated e service_role
REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_deal_transaction(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_deal_transaction(JSONB) TO authenticated, service_role;

-- 2. get_dashboard_indicators: SECURITY INVOKER + auth.uid() obrigatório
CREATE OR REPLACE FUNCTION public.get_dashboard_indicators(p_user_id UUID)
RETURNS TABLE (
    na_rua NUMERIC(12, 2),
    atrasado NUMERIC(12, 2),
    em_mercadoria NUMERIC(12, 2),
    quanto_ganhou_mes NUMERIC(12, 2)
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_na_rua NUMERIC(12, 2) := 0.00;
    v_atrasado NUMERIC(12, 2) := 0.00;
    v_em_mercadoria NUMERIC(12, 2) := 0.00;
    v_quanto_ganhou_mes NUMERIC(12, 2) := 0.00;
BEGIN
    -- Usuário autenticado só consulta os próprios indicadores.
    -- service_role (backend) pode consultar qualquer perfil explicitamente.
    IF current_user <> 'service_role' THEN
        IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Acesso não autorizado aos indicadores deste perfil.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT COALESCE(SUM(i.balance), 0.00)
    INTO v_na_rua
    FROM public.installments i
    JOIN public.receivables r ON r.id = i.receivable_id
    WHERE i.user_id = p_user_id
      AND i.status IN ('pending', 'partially_paid', 'overdue');

    SELECT COALESCE(SUM(i.balance), 0.00)
    INTO v_atrasado
    FROM public.installments i
    JOIN public.receivables r ON r.id = i.receivable_id
    WHERE i.user_id = p_user_id
      AND i.due_date < CURRENT_DATE
      AND i.status IN ('pending', 'partially_paid', 'overdue');

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

    SELECT COALESCE(SUM(d.recognized_profit), 0.00)
    INTO v_quanto_ganhou_mes
    FROM public.deals d
    WHERE d.user_id = p_user_id
      AND d.status = 'concluida'
      AND d.deal_date >= DATE_TRUNC('month', CURRENT_DATE)::DATE;

    RETURN QUERY SELECT v_na_rua, v_atrasado, v_em_mercadoria, v_quanto_ganhou_mes;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_indicators(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_indicators(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_indicators(UUID) TO authenticated, service_role;

-- 3. handle_new_user: trigger interna de auth.users, nunca RPC pública.
--    Triggers não verificam EXECUTE do chamador no disparo; o owner (postgres) mantém o privilégio.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
    END IF;
END;
$$;

-- 4. Demais funções de trigger: sem exposição via API
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_installment_payment_received() FROM anon, authenticated;

-- 5. Job de manutenção: somente service_role
REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_overdue_installments() TO service_role;

-- 6. Funções futuras criadas pelo postgres no schema public não nascem executáveis por anon.
--    Cada migration nova ainda concede explicitamente o que precisa.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
