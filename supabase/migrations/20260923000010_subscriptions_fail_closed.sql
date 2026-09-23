-- 20260923000010_subscriptions_fail_closed.sql
-- Fases 4 e 8: assinatura como fonte única de verdade, fail-closed no banco, billing neutro de provedor.
--
-- Brecha corrigida: a policy profiles_update_own permitia ao próprio usuário alterar
-- profiles.subscription_status e trial_ends_at pela API REST (ex.: 'active' até 2099).
-- A partir daqui o estado de cobrança vive em public.subscriptions, que o usuário só LÊ;
-- somente service_role (webhook/billing) escreve.
--
-- Regras de acesso (subscription_access) — única implementação, usada também pelo TypeScript:
--   trialing  → escreve até trial_ends_at; depois vale como expired
--   active    → escreve até current_period_end + carência (renovação atrasada no webhook)
--   past_due  → escreve durante a carência a partir de past_due_at; depois não
--   canceled  → escreve até current_period_end (período já pago); depois não
--   expired / blocked / sem assinatura / erro → NÃO escreve
-- Leitura nunca é bloqueada por cobrança (RLS continua isolando por usuário). Dados nunca são apagados.

-- 1. Tabela de assinaturas ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'blocked')),
    plan_code TEXT NOT NULL DEFAULT 'figo_mensal',
    price_cents INT NOT NULL DEFAULT 2490 CHECK (price_cents > 0),
    currency TEXT NOT NULL DEFAULT 'BRL',
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    provider TEXT,
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    canceled_at TIMESTAMPTZ,
    past_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub
    ON public.subscriptions(provider, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer
    ON public.subscriptions(provider, provider_customer_id) WHERE provider_customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscriptions FROM authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
    FOR SELECT USING ((select auth.uid()) = user_id);

-- 2. Eventos de billing (idempotência de webhook) --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_events(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM anon, authenticated;

-- 3. Backfill a partir de profiles (estado legado) ---------------------------------------------------
INSERT INTO public.subscriptions (user_id, status, trial_started_at, trial_ends_at)
SELECT p.id,
       CASE
           WHEN p.subscription_status = 'trial' AND p.trial_ends_at > NOW() THEN 'trialing'
           WHEN p.subscription_status = 'trial' THEN 'expired'
           ELSE p.subscription_status
       END,
       p.trial_started_at,
       p.trial_ends_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ON CONFLICT (user_id) DO NOTHING;

-- 4. Cadastro cria perfil + trial de 7 dias no servidor (nunca depende do client) ------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, trial_started_at, trial_ends_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuário'), NOW(), NOW() + INTERVAL '7 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.subscriptions (user_id, status, trial_started_at, trial_ends_at)
    VALUES (NEW.id, 'trialing', NOW(), NOW() + INTERVAL '7 days')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- 5. Usuário só altera dados cadastrais do próprio perfil ------------------------------------------
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone, business_segment) ON public.profiles TO authenticated;

-- 6. Regra de acesso -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_access()
RETURNS TABLE (
    status TEXT,
    effective_status TEXT,
    can_write BOOLEAN,
    reason TEXT,
    trial_ends_at TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    grace_until TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
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

    SELECT * INTO s FROM public.subscriptions WHERE user_id = v_uid;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'missing'::TEXT, 'missing'::TEXT, false, 'subscription_missing'::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, false;
        RETURN;
    END IF;

    IF s.status = 'trialing' THEN
        IF s.trial_ends_at IS NOT NULL AND NOW() < s.trial_ends_at THEN
            RETURN QUERY SELECT s.status, 'trialing'::TEXT, true, 'trial'::TEXT, s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        ELSE
            RETURN QUERY SELECT s.status, 'expired'::TEXT, false, 'trial_expired'::TEXT, s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
        END IF;
    ELSIF s.status = 'active' THEN
        IF s.current_period_end IS NULL OR NOW() <= s.current_period_end + v_grace THEN
            RETURN QUERY SELECT s.status, 'active'::TEXT, true,
                CASE WHEN s.current_period_end IS NOT NULL AND NOW() > s.current_period_end THEN 'renewal_pending' ELSE 'active' END,
                s.trial_ends_at, s.current_period_end, s.current_period_end + v_grace, s.cancel_at_period_end;
        ELSE
            RETURN QUERY SELECT s.status, 'past_due'::TEXT, false, 'renewal_overdue'::TEXT, s.trial_ends_at, s.current_period_end, s.current_period_end + v_grace, s.cancel_at_period_end;
        END IF;
    ELSIF s.status = 'past_due' THEN
        RETURN QUERY SELECT s.status, 'past_due'::TEXT,
            NOW() <= COALESCE(s.past_due_at, s.updated_at) + v_grace,
            CASE WHEN NOW() <= COALESCE(s.past_due_at, s.updated_at) + v_grace THEN 'past_due_grace' ELSE 'past_due' END,
            s.trial_ends_at, s.current_period_end, COALESCE(s.past_due_at, s.updated_at) + v_grace, s.cancel_at_period_end;
    ELSIF s.status = 'canceled' THEN
        RETURN QUERY SELECT s.status,
            CASE WHEN s.current_period_end IS NOT NULL AND NOW() < s.current_period_end THEN 'canceled' ELSE 'expired' END,
            s.current_period_end IS NOT NULL AND NOW() < s.current_period_end,
            CASE WHEN s.current_period_end IS NOT NULL AND NOW() < s.current_period_end THEN 'canceled_until_period_end' ELSE 'canceled' END,
            s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
    ELSE
        RETURN QUERY SELECT s.status, s.status, false, s.status, s.trial_ends_at, s.current_period_end, NULL::TIMESTAMPTZ, s.cancel_at_period_end;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_access() TO authenticated, service_role;

-- 7. Fail-closed no banco: toda escrita em tabela de negócio exige assinatura válida ------------------
-- Vale para RPCs, server actions e chamadas REST diretas. service_role/jobs (auth.uid() nulo) não passam aqui.
CREATE OR REPLACE FUNCTION public.enforce_write_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (select auth.uid()) IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT COALESCE((SELECT a.can_write FROM public.subscription_access() a), false) THEN
        RAISE EXCEPTION 'Assinatura inativa: novos registros estão bloqueados.'
            USING ERRCODE = '42501', HINT = 'SUBSCRIPTION_INACTIVE';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_write_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_write_access() FROM anon, authenticated;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customers', 'items', 'item_costs', 'deals', 'deal_items', 'cash_movements',
        'receivables', 'payables', 'installments', 'payments', 'adjustments'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS enforce_write_access ON public.%I', t);
        EXECUTE format(
            'CREATE TRIGGER enforce_write_access BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
            'FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_write_access()', t);
    END LOOP;
END;
$$;
