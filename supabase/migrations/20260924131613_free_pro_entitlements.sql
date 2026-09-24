-- Free permanente após o trial, Pro pago e limite de clientes protegido no banco.
CREATE TABLE public.plan_entitlements (
    plan_code TEXT PRIMARY KEY CHECK (plan_code IN ('free', 'pro')),
    display_name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    customer_limit INTEGER CHECK (customer_limit IS NULL OR customer_limit > 0),
    voice_monthly_limit INTEGER NOT NULL CHECK (voice_monthly_limit > 0),
    is_paid BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.plan_entitlements (plan_code, display_name, price_cents, customer_limit, voice_monthly_limit, is_paid)
VALUES ('free', 'Free', 0, 10, 20, false), ('pro', 'Pro', 2450, NULL, 1000, true);
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_entitlements FROM anon, authenticated;
GRANT SELECT ON public.plan_entitlements TO authenticated;
CREATE POLICY plan_entitlements_read ON public.plan_entitlements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.subscriptions ALTER COLUMN plan_code SET DEFAULT 'figo_pro_mensal';
ALTER TABLE public.subscriptions ALTER COLUMN price_cents SET DEFAULT 2450;
-- Não modificar contratos já associados a uma assinatura paga no gateway.
UPDATE public.subscriptions
SET plan_code = 'figo_pro_mensal', price_cents = 2450
WHERE plan_code = 'figo_mensal' AND price_cents = 2490 AND provider_subscription_id IS NULL;

-- Mantém a assinatura da RPC existente para compatibilidade com todas as operações financeiras.
CREATE OR REPLACE FUNCTION public.subscription_access()
RETURNS TABLE (
    status TEXT, effective_status TEXT, can_write BOOLEAN, reason TEXT,
    trial_ends_at TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
    grace_until TIMESTAMPTZ, cancel_at_period_end BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_grace CONSTANT INTERVAL := INTERVAL '3 days';
    s public.subscriptions%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT 'unknown'::TEXT, 'unknown'::TEXT, false, 'unauthenticated'::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, false;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
        RETURN QUERY SELECT 'unknown'::TEXT, 'unknown'::TEXT, false, 'billing_unavailable'::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, false;
        RETURN;
    END IF;
    SELECT * INTO s FROM public.subscriptions WHERE user_id = v_uid;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'missing'::TEXT, 'missing'::TEXT, false, 'subscription_missing'::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, false;
        RETURN;
    END IF;
    IF s.status = 'trialing' THEN
        IF s.trial_ends_at IS NULL THEN
            RETURN QUERY SELECT s.status, 'unknown'::TEXT, false, 'billing_unavailable'::TEXT,
                s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        ELSIF now() < s.trial_ends_at THEN
            RETURN QUERY SELECT s.status, 'trialing'::TEXT, true, 'trial'::TEXT,
                s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        ELSE
            RETURN QUERY SELECT s.status, 'expired'::TEXT, true, 'trial_expired'::TEXT,
                s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        END IF;
    ELSIF s.status = 'active' THEN
        IF s.current_period_end IS NULL THEN
            RETURN QUERY SELECT s.status, 'unknown'::TEXT, false, 'billing_unavailable'::TEXT,
                s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        ELSIF now() <= s.current_period_end + v_grace THEN
            RETURN QUERY SELECT s.status, 'active'::TEXT, true,
                CASE WHEN now() > s.current_period_end THEN 'renewal_pending' ELSE 'active' END,
                s.trial_ends_at, s.current_period_end, s.current_period_end + v_grace, s.cancel_at_period_end;
        ELSE
            RETURN QUERY SELECT s.status, 'past_due'::TEXT, true, 'renewal_overdue'::TEXT,
                s.trial_ends_at, s.current_period_end, s.current_period_end + v_grace, s.cancel_at_period_end;
        END IF;
    ELSIF s.status = 'past_due' THEN
        RETURN QUERY SELECT s.status, 'past_due'::TEXT, true,
            CASE WHEN now() <= COALESCE(s.past_due_at, s.updated_at) + v_grace THEN 'past_due_grace' ELSE 'past_due' END,
            s.trial_ends_at, s.current_period_end, COALESCE(s.past_due_at, s.updated_at) + v_grace, s.cancel_at_period_end;
    ELSIF s.status = 'canceled' THEN
        RETURN QUERY SELECT s.status,
            CASE WHEN s.current_period_end IS NOT NULL AND now() < s.current_period_end THEN 'canceled' ELSE 'expired' END,
            true,
            CASE WHEN s.current_period_end IS NOT NULL AND now() < s.current_period_end THEN 'canceled_until_period_end' ELSE 'canceled' END,
            s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
    ELSIF s.status = 'expired' THEN
        RETURN QUERY SELECT s.status, s.status, true, 'expired'::TEXT,
            s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
    ELSE
        RETURN QUERY SELECT s.status, s.status, false, s.status,
            s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
    END IF;
END;
$$;

-- Retorno único para app e banco. O contador mensal já existe; a migration seguinte passa a preenchê-lo.
CREATE FUNCTION public.account_entitlements()
RETURNS TABLE (
    status TEXT, effective_status TEXT, effective_plan TEXT, can_read BOOLEAN, can_write BOOLEAN,
    reason TEXT, trial_ends_at TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
    grace_until TIMESTAMPTZ, cancel_at_period_end BOOLEAN,
    customer_count BIGINT, customer_limit INTEGER, can_create_customer BOOLEAN,
    voice_monthly_limit INTEGER, voice_used_this_month INTEGER, voice_remaining_this_month INTEGER
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
    WITH access AS (SELECT * FROM public.subscription_access()),
    effective AS (
      SELECT a.*,
        CASE WHEN a.reason IN ('trial', 'active', 'renewal_pending', 'past_due_grace', 'canceled_until_period_end') THEN 'pro'
             WHEN a.can_write THEN 'free' ELSE NULL END AS plan
      FROM access a
    ), counts AS (
      SELECT count(*)::BIGINT AS n FROM public.customers WHERE user_id = (select auth.uid())
    ), usage AS (
      SELECT COALESCE(sum(hits), 0)::INTEGER AS n
      FROM public.voice_rate_limits
      WHERE user_id = (select auth.uid()) AND bucket = 'voice' AND window_kind = 'month'
        AND window_start = date_trunc('month', now())
    )
    SELECT e.status, e.effective_status, e.plan, (select auth.uid()) IS NOT NULL,
      e.can_write, e.reason, e.trial_ends_at, e.current_period_end, e.grace_until, e.cancel_at_period_end,
      c.n, p.customer_limit,
      e.can_write AND (p.customer_limit IS NULL OR c.n < p.customer_limit),
      p.voice_monthly_limit, u.n,
      CASE WHEN p.voice_monthly_limit IS NULL THEN NULL ELSE GREATEST(0, p.voice_monthly_limit - u.n) END
    FROM effective e
    CROSS JOIN counts c
    CROSS JOIN usage u
    LEFT JOIN public.plan_entitlements p ON p.plan_code = e.plan;
$$;
REVOKE ALL ON FUNCTION public.account_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_entitlements() TO authenticated, service_role;

-- Apenas contadores do próprio usuário são visíveis. A escrita permanece exclusiva da RPC.
GRANT SELECT ON public.voice_rate_limits TO authenticated;
CREATE POLICY voice_rate_limits_select_own ON public.voice_rate_limits
    FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- O lock da assinatura serializa inserts concorrentes para a mesma conta.
CREATE FUNCTION public.enforce_customer_plan_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_plan TEXT;
    v_limit INTEGER;
    v_can_write BOOLEAN;
    v_count BIGINT;
BEGIN
    IF v_uid IS NULL THEN RETURN NEW; END IF; -- service_role/migrations
    IF NEW.user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Cliente de outra conta.' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.subscriptions WHERE user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assinatura ausente.' USING ERRCODE = '42501', HINT = 'SUBSCRIPTION_INACTIVE';
    END IF;
    SELECT effective_plan, customer_limit, can_write
      INTO v_plan, v_limit, v_can_write FROM public.account_entitlements();
    IF NOT COALESCE(v_can_write, false) THEN
        RAISE EXCEPTION 'Conta indisponível para novos registros.' USING ERRCODE = '42501', HINT = 'SUBSCRIPTION_INACTIVE';
    END IF;
    IF v_plan = 'free' THEN
        SELECT count(*) INTO v_count FROM public.customers WHERE user_id = v_uid;
        IF v_count >= v_limit THEN
            RAISE EXCEPTION 'Limite de clientes do plano grátis atingido.'
                USING ERRCODE = '42501', HINT = 'FREE_CUSTOMER_LIMIT';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_customer_plan_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_customer_plan_limit ON public.customers;
CREATE TRIGGER enforce_customer_plan_limit BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_plan_limit();
