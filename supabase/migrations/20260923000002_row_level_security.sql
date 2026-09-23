-- 20260923000002_row_level_security.sql
-- Políticas de Segurança a Nível de Linha (RLS) para Isolamento Estrito Multi-tenant
-- Idempotente com DROP POLICY IF EXISTS

-- 1. Habilitar RLS em todas as tabelas públicas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 2. Políticas para 'profiles'
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 3. CUSTOMERS
DROP POLICY IF EXISTS "customers_select_own" ON public.customers;
CREATE POLICY "customers_select_own" ON public.customers FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "customers_insert_own" ON public.customers;
CREATE POLICY "customers_insert_own" ON public.customers FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "customers_update_own" ON public.customers;
CREATE POLICY "customers_update_own" ON public.customers FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "customers_delete_own" ON public.customers;
CREATE POLICY "customers_delete_own" ON public.customers FOR DELETE USING (auth.uid() = user_id);

-- 4. ITEMS
DROP POLICY IF EXISTS "items_select_own" ON public.items;
CREATE POLICY "items_select_own" ON public.items FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "items_insert_own" ON public.items;
CREATE POLICY "items_insert_own" ON public.items FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "items_update_own" ON public.items;
CREATE POLICY "items_update_own" ON public.items FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "items_delete_own" ON public.items;
CREATE POLICY "items_delete_own" ON public.items FOR DELETE USING (auth.uid() = user_id);

-- 5. ITEM_COSTS
DROP POLICY IF EXISTS "item_costs_select_own" ON public.item_costs;
CREATE POLICY "item_costs_select_own" ON public.item_costs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "item_costs_insert_own" ON public.item_costs;
CREATE POLICY "item_costs_insert_own" ON public.item_costs FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "item_costs_update_own" ON public.item_costs;
CREATE POLICY "item_costs_update_own" ON public.item_costs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "item_costs_delete_own" ON public.item_costs;
CREATE POLICY "item_costs_delete_own" ON public.item_costs FOR DELETE USING (auth.uid() = user_id);

-- 6. DEALS
DROP POLICY IF EXISTS "deals_select_own" ON public.deals;
CREATE POLICY "deals_select_own" ON public.deals FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "deals_insert_own" ON public.deals;
CREATE POLICY "deals_insert_own" ON public.deals FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "deals_update_own" ON public.deals;
CREATE POLICY "deals_update_own" ON public.deals FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "deals_delete_own" ON public.deals;
CREATE POLICY "deals_delete_own" ON public.deals FOR DELETE USING (auth.uid() = user_id);

-- 7. DEAL_ITEMS
DROP POLICY IF EXISTS "deal_items_select_own" ON public.deal_items;
CREATE POLICY "deal_items_select_own" ON public.deal_items FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.deals WHERE deals.id = deal_items.deal_id AND deals.user_id = auth.uid()));

DROP POLICY IF EXISTS "deal_items_insert_own" ON public.deal_items;
CREATE POLICY "deal_items_insert_own" ON public.deal_items FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.deals WHERE deals.id = deal_items.deal_id AND deals.user_id = auth.uid()));

DROP POLICY IF EXISTS "deal_items_update_own" ON public.deal_items;
CREATE POLICY "deal_items_update_own" ON public.deal_items FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.deals WHERE deals.id = deal_items.deal_id AND deals.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.deals WHERE deals.id = deal_items.deal_id AND deals.user_id = auth.uid()));

DROP POLICY IF EXISTS "deal_items_delete_own" ON public.deal_items;
CREATE POLICY "deal_items_delete_own" ON public.deal_items FOR DELETE
    USING (EXISTS (SELECT 1 FROM public.deals WHERE deals.id = deal_items.deal_id AND deals.user_id = auth.uid()));

-- 8. CASH_MOVEMENTS
DROP POLICY IF EXISTS "cash_movements_select_own" ON public.cash_movements;
CREATE POLICY "cash_movements_select_own" ON public.cash_movements FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cash_movements_insert_own" ON public.cash_movements;
CREATE POLICY "cash_movements_insert_own" ON public.cash_movements FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "cash_movements_update_own" ON public.cash_movements;
CREATE POLICY "cash_movements_update_own" ON public.cash_movements FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "cash_movements_delete_own" ON public.cash_movements;
CREATE POLICY "cash_movements_delete_own" ON public.cash_movements FOR DELETE USING (auth.uid() = user_id);

-- 9. RECEIVABLES
DROP POLICY IF EXISTS "receivables_select_own" ON public.receivables;
CREATE POLICY "receivables_select_own" ON public.receivables FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "receivables_insert_own" ON public.receivables;
CREATE POLICY "receivables_insert_own" ON public.receivables FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "receivables_update_own" ON public.receivables;
CREATE POLICY "receivables_update_own" ON public.receivables FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "receivables_delete_own" ON public.receivables;
CREATE POLICY "receivables_delete_own" ON public.receivables FOR DELETE USING (auth.uid() = user_id);

-- 10. PAYABLES
DROP POLICY IF EXISTS "payables_select_own" ON public.payables;
CREATE POLICY "payables_select_own" ON public.payables FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "payables_insert_own" ON public.payables;
CREATE POLICY "payables_insert_own" ON public.payables FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "payables_update_own" ON public.payables;
CREATE POLICY "payables_update_own" ON public.payables FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "payables_delete_own" ON public.payables;
CREATE POLICY "payables_delete_own" ON public.payables FOR DELETE USING (auth.uid() = user_id);

-- 11. INSTALLMENTS
DROP POLICY IF EXISTS "installments_select_own" ON public.installments;
CREATE POLICY "installments_select_own" ON public.installments FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "installments_insert_own" ON public.installments;
CREATE POLICY "installments_insert_own" ON public.installments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "installments_update_own" ON public.installments;
CREATE POLICY "installments_update_own" ON public.installments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "installments_delete_own" ON public.installments;
CREATE POLICY "installments_delete_own" ON public.installments FOR DELETE USING (auth.uid() = user_id);

-- 12. PAYMENTS
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "payments_insert_own" ON public.payments;
CREATE POLICY "payments_insert_own" ON public.payments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "payments_update_own" ON public.payments;
CREATE POLICY "payments_update_own" ON public.payments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "payments_delete_own" ON public.payments;
CREATE POLICY "payments_delete_own" ON public.payments FOR DELETE USING (auth.uid() = user_id);

-- 13. ADJUSTMENTS
DROP POLICY IF EXISTS "adjustments_select_own" ON public.adjustments;
CREATE POLICY "adjustments_select_own" ON public.adjustments FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "adjustments_insert_own" ON public.adjustments;
CREATE POLICY "adjustments_insert_own" ON public.adjustments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "adjustments_update_own" ON public.adjustments;
CREATE POLICY "adjustments_update_own" ON public.adjustments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "adjustments_delete_own" ON public.adjustments;
CREATE POLICY "adjustments_delete_own" ON public.adjustments FOR DELETE USING (auth.uid() = user_id);

-- 14. AI_INTERACTIONS
DROP POLICY IF EXISTS "ai_interactions_select_own" ON public.ai_interactions;
CREATE POLICY "ai_interactions_select_own" ON public.ai_interactions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_interactions_insert_own" ON public.ai_interactions;
CREATE POLICY "ai_interactions_insert_own" ON public.ai_interactions FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_interactions_update_own" ON public.ai_interactions;
CREATE POLICY "ai_interactions_update_own" ON public.ai_interactions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_interactions_delete_own" ON public.ai_interactions;
CREATE POLICY "ai_interactions_delete_own" ON public.ai_interactions FOR DELETE USING (auth.uid() = user_id);

-- 15. AUDIT_LOG
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "audit_log_insert_own" ON public.audit_log;
CREATE POLICY "audit_log_insert_own" ON public.audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);
