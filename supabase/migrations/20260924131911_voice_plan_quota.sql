-- A mesma RPC aplica a cota mensal do plano e os limites curtos antes de STT/LLM.
ALTER TABLE public.voice_rate_limits DROP CONSTRAINT IF EXISTS voice_rate_limits_window_kind_check;
ALTER TABLE public.voice_rate_limits ADD CONSTRAINT voice_rate_limits_window_kind_check
    CHECK (window_kind IN ('minute', 'hour', 'month'));

CREATE OR REPLACE FUNCTION public.consume_voice_rate_limit(
    p_bucket TEXT, p_limit_per_minute INT, p_limit_per_hour INT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_minute TIMESTAMPTZ := date_trunc('minute', now());
    v_hour TIMESTAMPTZ := date_trunc('hour', now());
    v_month TIMESTAMPTZ := date_trunc('month', now());
    v_monthly_limit INT;
    v_plan TEXT;
    v_month_hits INT := 0;
    v_minute_hits INT := 0;
    v_hour_hits INT := 0;
    v_can_write BOOLEAN;
    v_allowed BOOLEAN;
    v_retry INT := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    IF p_bucket IS NULL OR p_bucket !~ '^[a-z0-9_:-]{1,40}$'
       OR p_limit_per_minute IS NULL OR p_limit_per_hour IS NULL
       OR p_limit_per_minute < 1 OR p_limit_per_hour < 1 THEN
        RAISE EXCEPTION 'Limites de voz inválidos.';
    END IF;
    SELECT voice_monthly_limit, can_write, effective_plan INTO v_monthly_limit, v_can_write, v_plan
    FROM public.account_entitlements();
    IF NOT COALESCE(v_can_write, false) OR v_monthly_limit IS NULL THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'account_unavailable',
            'retry_after_seconds', 30, 'minute_hits', 0, 'hour_hits', 0,
            'monthly_hits', 0, 'monthly_limit', 0, 'plan', NULL);
    END IF;

    IF p_bucket = 'voice' THEN
        INSERT INTO public.voice_rate_limits (user_id, bucket, window_kind, window_start, hits)
        VALUES (v_user_id, p_bucket, 'month', v_month, 1)
        ON CONFLICT (user_id, bucket, window_kind, window_start)
        DO UPDATE SET hits = public.voice_rate_limits.hits + 1
          WHERE public.voice_rate_limits.hits < v_monthly_limit
        RETURNING hits INTO v_month_hits;
        IF NOT FOUND THEN
            SELECT hits INTO v_month_hits FROM public.voice_rate_limits
            WHERE user_id = v_user_id AND bucket = p_bucket AND window_kind = 'month' AND window_start = v_month;
            v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_month + INTERVAL '1 month' - now())))::INT);
            RETURN jsonb_build_object('allowed', false, 'reason', 'monthly_limit',
                'retry_after_seconds', v_retry, 'minute_hits', 0, 'hour_hits', 0,
                'monthly_hits', v_month_hits, 'monthly_limit', v_monthly_limit, 'plan', v_plan);
        END IF;
    END IF;

    INSERT INTO public.voice_rate_limits (user_id, bucket, window_kind, window_start, hits)
    VALUES (v_user_id, p_bucket, 'minute', v_minute, 1)
    ON CONFLICT (user_id, bucket, window_kind, window_start)
    DO UPDATE SET hits = public.voice_rate_limits.hits + 1
    RETURNING hits INTO v_minute_hits;

    INSERT INTO public.voice_rate_limits (user_id, bucket, window_kind, window_start, hits)
    VALUES (v_user_id, p_bucket, 'hour', v_hour, 1)
    ON CONFLICT (user_id, bucket, window_kind, window_start)
    DO UPDATE SET hits = public.voice_rate_limits.hits + 1
    RETURNING hits INTO v_hour_hits;

    v_allowed := v_minute_hits <= p_limit_per_minute AND v_hour_hits <= p_limit_per_hour;
    IF NOT v_allowed THEN
        v_retry := CASE
            WHEN v_hour_hits > p_limit_per_hour THEN CEIL(EXTRACT(EPOCH FROM (v_hour + INTERVAL '1 hour' - now())))::INT
            ELSE CEIL(EXTRACT(EPOCH FROM (v_minute + INTERVAL '1 minute' - now())))::INT
        END;
        IF p_bucket = 'voice' THEN
            UPDATE public.voice_rate_limits SET hits = GREATEST(0, hits - 1)
            WHERE user_id = v_user_id AND bucket = p_bucket AND window_kind = 'month' AND window_start = v_month
            RETURNING hits INTO v_month_hits;
        END IF;
    END IF;

    DELETE FROM public.voice_rate_limits
    WHERE user_id = v_user_id AND (
      (window_kind IN ('minute', 'hour') AND window_start < now() - INTERVAL '2 hours') OR
      (window_kind = 'month' AND window_start < now() - INTERVAL '2 months')
    );

    RETURN jsonb_build_object('allowed', v_allowed,
        'reason', CASE WHEN v_allowed THEN 'ok' ELSE 'rate_limited' END,
        'minute_hits', v_minute_hits, 'hour_hits', v_hour_hits,
        'monthly_hits', v_month_hits, 'monthly_limit', v_monthly_limit, 'plan', v_plan,
        'limit_per_minute', p_limit_per_minute, 'limit_per_hour', p_limit_per_hour,
        'retry_after_seconds', GREATEST(v_retry, 0));
END;
$$;
