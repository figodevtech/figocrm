-- Histórico de tentativas de checkout. Somente o servidor grava; o usuário lê as próprias.
CREATE TABLE public.billing_checkout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_checkout_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'canceled', 'expired')),
    external_reference TEXT NOT NULL,
    checkout_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_checkout_id)
);
CREATE INDEX billing_checkout_sessions_user_idx ON public.billing_checkout_sessions(user_id, created_at DESC);
ALTER TABLE public.billing_checkout_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_checkout_sessions FROM anon, authenticated;
GRANT SELECT ON public.billing_checkout_sessions TO authenticated;
CREATE POLICY billing_checkout_sessions_read_own ON public.billing_checkout_sessions
    FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- Serviço de cobrança faz a correlação de eventos pelo checkout e pode consultar esta tabela.
