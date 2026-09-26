-- Pedidos auditáveis de encerramento; exclusão física depende de revisão de retenção.
CREATE TABLE public.account_closure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK: o histórico do pedido deve sobreviver à remoção posterior do auth.users.
  user_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending_cancellation'
    CHECK (status IN ('pending_cancellation', 'scheduled', 'in_review', 'completed', 'rejected')),
  scheduled_for timestamptz,
  completed_at timestamptz,
  UNIQUE (user_id)
);
ALTER TABLE public.account_closure_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_closure_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.account_closure_requests TO authenticated;
CREATE POLICY account_closure_select_own ON public.account_closure_requests
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY account_closure_insert_own ON public.account_closure_requests
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- Relatos de suporte: o usuário só pode criar o próprio relato; leitura operacional via service role.
CREATE TABLE public.feedback_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('bug', 'billing', 'suggestion', 'other')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  route text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_reports_created_idx ON public.feedback_reports(created_at DESC);
ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_reports FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.feedback_reports TO authenticated;
CREATE POLICY feedback_reports_insert_own ON public.feedback_reports
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
