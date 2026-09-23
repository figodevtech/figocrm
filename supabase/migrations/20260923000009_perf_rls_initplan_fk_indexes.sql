-- 20260923000009_perf_rls_initplan_fk_indexes.sql
-- Fase 3: performance do Supabase sem mudar a semântica de segurança.
--
-- 1. RLS initplan: auth.uid() em policy é reavaliado por linha. Envolto em (select auth.uid()) vira um
--    InitPlan avaliado uma vez por consulta (recomendação do Performance Advisor, lint 0003).
--    Mesmas expressões, mesmos papéis, mesmos comandos — só a forma de avaliação muda.
-- 2. Índices de cobertura para FKs que não tinham índice iniciado pela coluna (lint 0001).
--    As consultas do app filtram por user_id e já usam os compostos (user_id, ...); os índices abaixo
--    servem às verificações de FK (ON DELETE RESTRICT / SET NULL) e aos acessos por deal_id.
--    Nenhum índice existente é removido (tráfego ainda baixo: "unused" não é evidência).

-- 1. Policies ---------------------------------------------------------------------------------------
ALTER POLICY "adjustments_delete_own" ON public.adjustments USING ((select auth.uid()) = user_id);
ALTER POLICY "adjustments_insert_own" ON public.adjustments WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "adjustments_select_own" ON public.adjustments USING ((select auth.uid()) = user_id);
ALTER POLICY "adjustments_update_own" ON public.adjustments USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "ai_interactions_delete_own" ON public.ai_interactions USING ((select auth.uid()) = user_id);
ALTER POLICY "ai_interactions_insert_own" ON public.ai_interactions WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "ai_interactions_select_own" ON public.ai_interactions USING ((select auth.uid()) = user_id);
ALTER POLICY "ai_interactions_update_own" ON public.ai_interactions USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "audit_log_insert_own" ON public.audit_log WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "audit_log_select_own" ON public.audit_log USING ((select auth.uid()) = user_id);
ALTER POLICY "cash_movements_delete_own" ON public.cash_movements USING ((select auth.uid()) = user_id);
ALTER POLICY "cash_movements_insert_own" ON public.cash_movements WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "cash_movements_select_own" ON public.cash_movements USING ((select auth.uid()) = user_id);
ALTER POLICY "cash_movements_update_own" ON public.cash_movements USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "conversation_context_delete_own" ON public.conversation_context USING ((select auth.uid()) = user_id);
ALTER POLICY "conversation_context_insert_own" ON public.conversation_context WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "conversation_context_select_own" ON public.conversation_context USING ((select auth.uid()) = user_id);
ALTER POLICY "conversation_context_update_own" ON public.conversation_context USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "customers_delete_own" ON public.customers USING ((select auth.uid()) = user_id);
ALTER POLICY "customers_insert_own" ON public.customers WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "customers_select_own" ON public.customers USING ((select auth.uid()) = user_id);
ALTER POLICY "customers_update_own" ON public.customers USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "deal_items_delete_own" ON public.deal_items USING (EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_items.deal_id) AND (deals.user_id = (select auth.uid())))));
ALTER POLICY "deal_items_insert_own" ON public.deal_items WITH CHECK (EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_items.deal_id) AND (deals.user_id = (select auth.uid())))));
ALTER POLICY "deal_items_select_own" ON public.deal_items USING (EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_items.deal_id) AND (deals.user_id = (select auth.uid())))));
ALTER POLICY "deal_items_update_own" ON public.deal_items USING (EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_items.deal_id) AND (deals.user_id = (select auth.uid()))))) WITH CHECK (EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_items.deal_id) AND (deals.user_id = (select auth.uid())))));
ALTER POLICY "deals_delete_own" ON public.deals USING ((select auth.uid()) = user_id);
ALTER POLICY "deals_insert_own" ON public.deals WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "deals_select_own" ON public.deals USING ((select auth.uid()) = user_id);
ALTER POLICY "deals_update_own" ON public.deals USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "installments_delete_own" ON public.installments USING ((select auth.uid()) = user_id);
ALTER POLICY "installments_insert_own" ON public.installments WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "installments_select_own" ON public.installments USING ((select auth.uid()) = user_id);
ALTER POLICY "installments_update_own" ON public.installments USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "item_costs_delete_own" ON public.item_costs USING ((select auth.uid()) = user_id);
ALTER POLICY "item_costs_insert_own" ON public.item_costs WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "item_costs_select_own" ON public.item_costs USING ((select auth.uid()) = user_id);
ALTER POLICY "item_costs_update_own" ON public.item_costs USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "items_delete_own" ON public.items USING ((select auth.uid()) = user_id);
ALTER POLICY "items_insert_own" ON public.items WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "items_select_own" ON public.items USING ((select auth.uid()) = user_id);
ALTER POLICY "items_update_own" ON public.items USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "payables_delete_own" ON public.payables USING ((select auth.uid()) = user_id);
ALTER POLICY "payables_insert_own" ON public.payables WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "payables_select_own" ON public.payables USING ((select auth.uid()) = user_id);
ALTER POLICY "payables_update_own" ON public.payables USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "payments_delete_own" ON public.payments USING ((select auth.uid()) = user_id);
ALTER POLICY "payments_insert_own" ON public.payments WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "payments_select_own" ON public.payments USING ((select auth.uid()) = user_id);
ALTER POLICY "payments_update_own" ON public.payments USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "profiles_select_own" ON public.profiles USING ((select auth.uid()) = id);
ALTER POLICY "profiles_update_own" ON public.profiles USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);
ALTER POLICY "receivables_delete_own" ON public.receivables USING ((select auth.uid()) = user_id);
ALTER POLICY "receivables_insert_own" ON public.receivables WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "receivables_select_own" ON public.receivables USING ((select auth.uid()) = user_id);
ALTER POLICY "receivables_update_own" ON public.receivables USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- 2. Índices de FK ------------------------------------------------------------------------------------
-- Exclusão de cliente (RESTRICT) procura por customer_id sem user_id: precisa de índice iniciado pela coluna
CREATE INDEX IF NOT EXISTS idx_deals_customer ON public.deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_receivables_customer_fk ON public.receivables(customer_id);
CREATE INDEX IF NOT EXISTS idx_payables_customer ON public.payables(customer_id);

-- Movimentos e abatimentos de um negócio (estorno, auditoria, resumo do deal)
CREATE INDEX IF NOT EXISTS idx_cash_movements_deal ON public.cash_movements(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjustments_deal ON public.adjustments(deal_id) WHERE deal_id IS NOT NULL;

-- FKs ON DELETE SET NULL raramente preenchidas: índices parciais pequenos
CREATE INDEX IF NOT EXISTS idx_adjustments_counter_item ON public.adjustments(counter_item_id) WHERE counter_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_interactions_target_deal ON public.ai_interactions(target_deal_id) WHERE target_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_context_customer ON public.conversation_context(last_customer_id) WHERE last_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_context_item ON public.conversation_context(last_item_id) WHERE last_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_context_deal ON public.conversation_context(last_deal_id) WHERE last_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_context_receivable ON public.conversation_context(last_receivable_id) WHERE last_receivable_id IS NOT NULL;
