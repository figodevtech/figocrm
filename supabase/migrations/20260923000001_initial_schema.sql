-- 20260923000001_initial_schema.sql
-- Migração Inicial de Esquema: SaaS Voice-First para Vendedores e Revendedores
-- Banco: PostgreSQL / Supabase

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Função utilitária para atualização automática de timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Tabela de Perfis de Usuário (vinculada ao auth.users do Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    business_segment TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'trial' 
        CHECK (subscription_status IN ('trial', 'active', 'past_due', 'canceled', 'expired', 'blocked')),
    trial_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Clientes e Contatos de Negociação
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    document TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_user_id ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_user_name ON public.customers(user_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_user_phone ON public.customers(user_id, phone);

DROP TRIGGER IF EXISTS set_customers_updated_at ON public.customers;
CREATE TRIGGER set_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Mercadorias em Estoque
CREATE TABLE IF NOT EXISTS public.items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    acquisition_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (acquisition_cost >= 0),
    target_sale_price NUMERIC(12, 2) CHECK (target_sale_price >= 0),
    status TEXT NOT NULL DEFAULT 'disponivel' 
        CHECK (status IN ('disponivel', 'em_preparacao', 'reservado', 'vendido', 'devolvido')),
    photo_url TEXT,
    acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_user_id ON public.items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_user_status ON public.items(user_id, status);

DROP TRIGGER IF EXISTS set_items_updated_at ON public.items;
CREATE TRIGGER set_items_updated_at
BEFORE UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Custos Agregados aos Itens (Peças, Funilaria, Guincho, Documentação)
CREATE TABLE IF NOT EXISTS public.item_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('pecas', 'reparo', 'estetica', 'transporte', 'documentacao', 'outros')),
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_costs_user_id ON public.item_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_item_costs_item_id ON public.item_costs(item_id);

-- 6. Negociações Principais (Deals)
CREATE TABLE IF NOT EXISTS public.deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    deal_type TEXT NOT NULL CHECK (deal_type IN ('venda', 'compra', 'troca', 'renegociacao', 'avulso')),
    total_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_value >= 0),
    recognized_profit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida', 'renegociada', 'cancelada')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'manual')),
    deal_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_user_id ON public.deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_customer ON public.deals(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_date ON public.deals(user_id, deal_date);

DROP TRIGGER IF EXISTS set_deals_updated_at ON public.deals;
CREATE TRIGGER set_deals_updated_at
BEFORE UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. Itens Vinculados à Negociação (Direção IN/OUT)
CREATE TABLE IF NOT EXISTS public.deal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    evaluated_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (evaluated_value >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON public.deal_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_items_item ON public.deal_items(item_id);

-- 8. Movimentações Imediatas de Caixa (Cash Movements)
CREATE TABLE IF NOT EXISTS public.cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'debit_card', 'credit_card', 'bank_transfer', 'other')),
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_user ON public.cash_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON public.cash_movements(user_id, movement_date);

-- 9. Contas a Receber (Receivables)
CREATE TABLE IF NOT EXISTS public.receivables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    balance NUMERIC(12, 2) NOT NULL CHECK (balance >= 0),
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'renegotiated', 'canceled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivables_user ON public.receivables(user_id);
CREATE INDEX IF NOT EXISTS idx_receivables_customer ON public.receivables(user_id, customer_id);

DROP TRIGGER IF EXISTS set_receivables_updated_at ON public.receivables;
CREATE TRIGGER set_receivables_updated_at
BEFORE UPDATE ON public.receivables
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 10. Contas a Pagar (Payables)
CREATE TABLE IF NOT EXISTS public.payables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    balance NUMERIC(12, 2) NOT NULL CHECK (balance >= 0),
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'renegotiated', 'canceled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payables_user ON public.payables(user_id);

DROP TRIGGER IF EXISTS set_payables_updated_at ON public.payables;
CREATE TRIGGER set_payables_updated_at
BEFORE UPDATE ON public.payables
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 11. Parcelas Individuais (Installments)
CREATE TABLE IF NOT EXISTS public.installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receivable_id UUID REFERENCES public.receivables(id) ON DELETE CASCADE,
    payable_id UUID REFERENCES public.payables(id) ON DELETE CASCADE,
    installment_number INT NOT NULL CHECK (installment_number > 0),
    total_installments INT NOT NULL CHECK (total_installments >= installment_number),
    original_value NUMERIC(12, 2) NOT NULL CHECK (original_value > 0),
    paid_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_value >= 0),
    balance NUMERIC(12, 2) NOT NULL CHECK (balance >= 0),
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'canceled')),
    is_promissory BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_installment_obligation CHECK (
        (receivable_id IS NOT NULL AND payable_id IS NULL) OR
        (receivable_id IS NULL AND payable_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_installments_user ON public.installments(user_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON public.installments(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_installments_status ON public.installments(user_id, status);

DROP TRIGGER IF EXISTS set_installments_updated_at ON public.installments;
CREATE TRIGGER set_installments_updated_at
BEFORE UPDATE ON public.installments
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 12. Pagamentos Efetivados de Parcelas
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    installment_id UUID NOT NULL REFERENCES public.installments(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'debit_card', 'credit_card', 'bank_transfer', 'other')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_installment ON public.payments(installment_id);

-- 13. Abatimentos e Ajustes Não-Monetários
CREATE TABLE IF NOT EXISTS public.adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    installment_id UUID REFERENCES public.installments(id) ON DELETE SET NULL,
    counter_item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('item_trade_in', 'service_labor', 'discount', 'write_off')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adjustments_user ON public.adjustments(user_id);

-- 14. Interações com IA e Histórico de Voz
CREATE TABLE IF NOT EXISTS public.ai_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    spoken_text TEXT NOT NULL,
    detected_intent TEXT NOT NULL,
    extracted_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
    required_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    confirmation_prompt TEXT,
    execution_status TEXT NOT NULL DEFAULT 'executed' 
        CHECK (execution_status IN ('executed', 'requires_confirmation', 'rejected', 'failed')),
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON public.ai_interactions(user_id);

-- 15. Trilha de Auditoria (Audit Log)
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    entity_name TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'VOICE_AI' CHECK (source IN ('VOICE_AI', 'MANUAL_WEB', 'SYSTEM_JOB')),
    payload_before JSONB,
    payload_after JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(user_id, entity_name, entity_id);

-- 16. Trigger para auto-criação de perfil ao registrar usuário no Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, trial_started_at, trial_ends_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuário'),
        NOW(),
        NOW() + INTERVAL '7 days'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
