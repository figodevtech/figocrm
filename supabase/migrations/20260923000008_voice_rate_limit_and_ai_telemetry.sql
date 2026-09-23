-- 20260923000008_voice_rate_limit_and_ai_telemetry.sql
-- Fases K e L: rate limit distribuído e observabilidade estruturada da IA.
--
-- Rate limit: contadores por usuário em janelas fixas de minuto e hora no PostgreSQL, compartilhados
-- por todas as instâncias da Vercel (nada em memória). Consumo atômico via INSERT ... ON CONFLICT.
--
-- Ambas as tabelas têm RLS habilitado e NENHUMA policy: anon/authenticated não leem nem alteram
-- diretamente. A escrita acontece somente pelas funções abaixo, que usam auth.uid() (o usuário só
-- consome/registra em seu próprio nome) — por isso são SECURITY DEFINER, com search_path fixo.

-- 1. Rate limit ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_rate_limits (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bucket TEXT NOT NULL,
    window_kind TEXT NOT NULL CHECK (window_kind IN ('minute', 'hour')),
    window_start TIMESTAMPTZ NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, bucket, window_kind, window_start)
);

CREATE INDEX IF NOT EXISTS idx_voice_rate_limits_window ON public.voice_rate_limits(window_start);

ALTER TABLE public.voice_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_voice_rate_limit(
    p_bucket TEXT,
    p_limit_per_minute INT,
    p_limit_per_hour INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_minute TIMESTAMPTZ := date_trunc('minute', NOW());
    v_hour TIMESTAMPTZ := date_trunc('hour', NOW());
    v_minute_hits INT;
    v_hour_hits INT;
    v_allowed BOOLEAN;
    v_retry INT := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;
    IF p_bucket IS NULL OR p_bucket !~ '^[a-z0-9_:-]{1,40}$' THEN
        RAISE EXCEPTION 'Bucket de rate limit inválido.';
    END IF;
    IF p_limit_per_minute < 1 OR p_limit_per_hour < 1 THEN
        RAISE EXCEPTION 'Limites de rate limit inválidos.';
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
            WHEN v_hour_hits > p_limit_per_hour THEN CEIL(EXTRACT(EPOCH FROM (v_hour + INTERVAL '1 hour' - NOW())))
            ELSE CEIL(EXTRACT(EPOCH FROM (v_minute + INTERVAL '1 minute' - NOW())))
        END;
    END IF;

    -- Limpeza oportunista das janelas antigas deste usuário
    DELETE FROM public.voice_rate_limits
    WHERE user_id = v_user_id AND window_start < NOW() - INTERVAL '2 hours';

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'minute_hits', v_minute_hits,
        'hour_hits', v_hour_hits,
        'limit_per_minute', p_limit_per_minute,
        'limit_per_hour', p_limit_per_hour,
        'retry_after_seconds', GREATEST(v_retry, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_voice_rate_limit(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_voice_rate_limit(TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_voice_rate_limit(TEXT, INT, INT) TO authenticated, service_role;

-- 2. Telemetria de IA --------------------------------------------------------------------------------
-- Sem áudio, sem transcrição, sem chaves: apenas métricas operacionais.
CREATE TABLE IF NOT EXISTS public.ai_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    input_type TEXT NOT NULL CHECK (input_type IN ('audio', 'text')),
    stt_provider TEXT,
    llm_provider TEXT,
    llm_model TEXT,
    interpretation_source TEXT,
    intent TEXT,
    execution_status TEXT,
    stt_latency_ms INT,
    llm_latency_ms INT,
    execution_latency_ms INT,
    total_latency_ms INT,
    audio_size_bytes INT,
    audio_duration_seconds NUMERIC(8, 2),
    prompt_tokens INT,
    completion_tokens INT,
    estimated_cost_usd NUMERIC(12, 6),
    success BOOLEAN NOT NULL,
    error_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_user_created ON public.ai_telemetry(user_id, created_at DESC);

ALTER TABLE public.ai_telemetry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_telemetry FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.telemetry_clamp(p_value NUMERIC, p_max NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_value IS NULL THEN NULL ELSE LEAST(GREATEST(p_value, 0), p_max) END;
$$;

REVOKE ALL ON FUNCTION public.telemetry_clamp(NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telemetry_clamp(NUMERIC, NUMERIC) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_telemetry(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_input_type TEXT := COALESCE(p_payload->>'input_type', 'text');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;
    IF v_input_type NOT IN ('audio', 'text') THEN
        RAISE EXCEPTION 'input_type inválido.';
    END IF;

    INSERT INTO public.ai_telemetry (
        user_id, endpoint, input_type, stt_provider, llm_provider, llm_model, interpretation_source,
        intent, execution_status, stt_latency_ms, llm_latency_ms, execution_latency_ms, total_latency_ms,
        audio_size_bytes, audio_duration_seconds, prompt_tokens, completion_tokens, estimated_cost_usd,
        success, error_type
    ) VALUES (
        v_user_id,
        left(COALESCE(p_payload->>'endpoint', 'unknown'), 60),
        v_input_type,
        left(p_payload->>'stt_provider', 40),
        left(p_payload->>'llm_provider', 40),
        left(p_payload->>'llm_model', 80),
        left(p_payload->>'interpretation_source', 40),
        left(p_payload->>'intent', 60),
        left(p_payload->>'execution_status', 40),
        public.telemetry_clamp((p_payload->>'stt_latency_ms')::NUMERIC, 600000),
        public.telemetry_clamp((p_payload->>'llm_latency_ms')::NUMERIC, 600000),
        public.telemetry_clamp((p_payload->>'execution_latency_ms')::NUMERIC, 600000),
        public.telemetry_clamp((p_payload->>'total_latency_ms')::NUMERIC, 600000),
        public.telemetry_clamp((p_payload->>'audio_size_bytes')::NUMERIC, 50000000),
        public.telemetry_clamp((p_payload->>'audio_duration_seconds')::NUMERIC, 36000),
        public.telemetry_clamp((p_payload->>'prompt_tokens')::NUMERIC, 10000000),
        public.telemetry_clamp((p_payload->>'completion_tokens')::NUMERIC, 10000000),
        public.telemetry_clamp((p_payload->>'estimated_cost_usd')::NUMERIC, 1000),
        COALESCE((p_payload->>'success')::BOOLEAN, false),
        left(p_payload->>'error_type', 60)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_telemetry(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_ai_telemetry(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_ai_telemetry(JSONB) TO authenticated, service_role;
