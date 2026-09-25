-- Os contratos vinculados ao Asaas mantêm preço e código atuais até escolha explícita.
ALTER TABLE public.plan_entitlements DROP CONSTRAINT plan_entitlements_plan_code_check;
ALTER TABLE public.plan_entitlements ADD CONSTRAINT plan_entitlements_plan_code_check
  CHECK (plan_code IN ('free', 'pro', 'pro_plus'));
UPDATE public.plan_entitlements
SET price_cents = 3990, voice_monthly_limit = 300, updated_at = now()
WHERE plan_code = 'pro';
INSERT INTO public.plan_entitlements
  (plan_code, display_name, price_cents, customer_limit, voice_monthly_limit, is_paid)
VALUES ('pro_plus', 'Pro Mais', 8990, NULL, 1000, true);

ALTER TABLE public.subscriptions ALTER COLUMN price_cents SET DEFAULT 3990;
UPDATE public.subscriptions SET price_cents = 3990
WHERE provider_subscription_id IS NULL AND status = 'trialing' AND plan_code = 'figo_pro_mensal';
ALTER TABLE public.subscriptions ADD COLUMN pending_plan_code TEXT
  CONSTRAINT subscriptions_pending_plan_code_check
  CHECK (pending_plan_code IS NULL OR pending_plan_code IN ('figo_pro_mensal', 'figo_pro_plus_mensal'));
ALTER TABLE public.subscriptions ADD COLUMN pending_price_cents INTEGER
  CONSTRAINT subscriptions_pending_price_check CHECK (pending_price_cents IS NULL OR pending_price_cents IN (3990, 8990));
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pending_plan_pair_check
  CHECK ((pending_plan_code IS NULL) = (pending_price_cents IS NULL));

ALTER TABLE public.billing_checkout_sessions ADD COLUMN plan_code TEXT
  CONSTRAINT billing_checkout_plan_check
  CHECK (plan_code IS NULL OR plan_code IN ('figo_pro_mensal', 'figo_pro_plus_mensal'));
ALTER TABLE public.billing_checkout_sessions ADD COLUMN price_cents INTEGER
  CONSTRAINT billing_checkout_price_check CHECK (price_cents IS NULL OR price_cents IN (3990, 8990));
ALTER TABLE public.billing_checkout_sessions ADD COLUMN provider_subscription_id TEXT;
CREATE INDEX billing_checkout_subscription_idx
  ON public.billing_checkout_sessions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX billing_checkout_one_open_per_user_idx
  ON public.billing_checkout_sessions(user_id, provider) WHERE status = 'created';

-- Mantém a assinatura da RPC usada pelo app e pelo limitador de voz.
CREATE OR REPLACE FUNCTION public.account_entitlements()
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
        CASE WHEN a.reason = 'trial' THEN 'pro'
             WHEN a.reason IN ('active', 'renewal_pending', 'past_due_grace', 'canceled_until_period_end')
               THEN CASE WHEN s.plan_code = 'figo_pro_plus_mensal' THEN 'pro_plus' ELSE 'pro' END
             WHEN a.can_write THEN 'free' ELSE NULL END AS plan
      FROM access a
      LEFT JOIN public.subscriptions s ON s.user_id = (select auth.uid())
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
