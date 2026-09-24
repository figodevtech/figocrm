-- 20260923000014_app_modules_loans.sql
-- Módulos visíveis do app (ciclo "atalhos"): empréstimos com juros, atributos de mercadoria,
-- endereço do cliente, nome do negócio no perfil e fotos de mercadoria.
--
-- Empréstimo NÃO cria motor financeiro paralelo:
--   loan_contract → receivable (loan_contract_id) → installments → payments/adjustments → settlements
-- Pagamento, abatimento, estorno e renegociação continuam nas RPCs existentes
-- (apply_obligation_settlement, reverse_settlement, renegotiate_installments), que operam por receivable.
-- Uma dívida (receivable) nasce de um negócio OU de um empréstimo — nunca dos dois.

-- 1. Perfil: nome do negócio; cadastro grava telefone/negócio vindos do formulário -----------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name TEXT;
GRANT UPDATE (full_name, phone, business_segment, business_name) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, phone, business_name, business_segment, trial_started_at, trial_ends_at)
    VALUES (
        NEW.id,
        NEW.email,
        LEFT(COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), 'Usuário'), 120),
        LEFT(NULLIF(trim(NEW.raw_user_meta_data->>'phone'), ''), 30),
        LEFT(NULLIF(trim(NEW.raw_user_meta_data->>'business_name'), ''), 120),
        LEFT(NULLIF(trim(NEW.raw_user_meta_data->>'business_segment'), ''), 60),
        NOW(),
        NOW() + INTERVAL '7 days'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.subscriptions (user_id, status, trial_started_at, trial_ends_at)
    VALUES (NEW.id, 'trialing', NOW(), NOW() + INTERVAL '7 days')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- 2. Cliente: endereço ------------------------------------------------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT;

-- 3. Mercadoria: atributos que servem a vários mercados (celular, moto, carro, máquina...) -----------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS imei TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS plate TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS model_year INT;
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_model_year_check;
ALTER TABLE public.items ADD CONSTRAINT items_model_year_check CHECK (model_year IS NULL OR model_year BETWEEN 1900 AND 2100);

-- "Serviço" como categoria de custo agregado
ALTER TABLE public.item_costs DROP CONSTRAINT IF EXISTS item_costs_category_check;
ALTER TABLE public.item_costs ADD CONSTRAINT item_costs_category_check
    CHECK (category IN ('pecas', 'reparo', 'estetica', 'transporte', 'documentacao', 'servico', 'outros'));

-- 4. Contratos de empréstimo ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loan_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    principal_amount NUMERIC(12, 2) NOT NULL CHECK (principal_amount > 0),
    interest_type TEXT NOT NULL CHECK (interest_type IN ('percent_total', 'percent_monthly', 'fixed_amount')),
    -- Percentual (ex.: 25 = 25%). Nulo quando o juro é um valor fixo.
    interest_rate NUMERIC(9, 4) CHECK (interest_rate IS NULL OR interest_rate >= 0),
    interest_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (interest_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL,
    installments_count INT NOT NULL CHECK (installments_count BETWEEN 1 AND 120),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    first_due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'canceled')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('voice', 'manual')),
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT loan_contracts_total_check CHECK (total_amount = principal_amount + interest_amount),
    CONSTRAINT loan_contracts_rate_check CHECK ((interest_type = 'fixed_amount') = (interest_rate IS NULL)),
    CONSTRAINT loan_contracts_first_due_check CHECK (first_due_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_loan_contracts_user ON public.loan_contracts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_contracts_customer ON public.loan_contracts(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_loan_contracts_customer_fk ON public.loan_contracts(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_contracts_idempotency
    ON public.loan_contracts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS set_loan_contracts_updated_at ON public.loan_contracts;
CREATE TRIGGER set_loan_contracts_updated_at
BEFORE UPDATE ON public.loan_contracts
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.loan_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loan_contracts FROM anon;
-- Criação só pela RPC (INVOKER, precisa de INSERT); status é mantido pelo banco, nunca pelo cliente.
REVOKE UPDATE, DELETE, TRUNCATE ON public.loan_contracts FROM authenticated;
GRANT SELECT, INSERT ON public.loan_contracts TO authenticated;

DROP POLICY IF EXISTS "loan_contracts_select_own" ON public.loan_contracts;
CREATE POLICY "loan_contracts_select_own" ON public.loan_contracts
    FOR SELECT USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "loan_contracts_insert_own" ON public.loan_contracts;
CREATE POLICY "loan_contracts_insert_own" ON public.loan_contracts
    FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS enforce_write_access ON public.loan_contracts;
CREATE TRIGGER enforce_write_access BEFORE INSERT OR UPDATE OR DELETE ON public.loan_contracts
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_write_access();

-- 5. Dívida nasce de um negócio OU de um empréstimo ------------------------------------------------
ALTER TABLE public.receivables ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS loan_contract_id UUID REFERENCES public.loan_contracts(id) ON DELETE CASCADE;
ALTER TABLE public.receivables DROP CONSTRAINT IF EXISTS receivables_origin_check;
ALTER TABLE public.receivables ADD CONSTRAINT receivables_origin_check
    CHECK ((deal_id IS NOT NULL) <> (loan_contract_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_loan_contract
    ON public.receivables(loan_contract_id) WHERE loan_contract_id IS NOT NULL;

-- Dinheiro que saiu no empréstimo fica ligado ao contrato
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS loan_contract_id UUID REFERENCES public.loan_contracts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cash_movements_loan_contract
    ON public.cash_movements(loan_contract_id) WHERE loan_contract_id IS NOT NULL;

-- 6. Status do contrato acompanha a dívida (quitada → paid; estorno → active) ------------------------
CREATE OR REPLACE FUNCTION public.sync_loan_contract_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.loan_contract_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE public.loan_contracts
        SET status = CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'canceled' THEN 'canceled' ELSE 'active' END,
            updated_at = NOW()
        WHERE id = NEW.loan_contract_id AND user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_loan_contract_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_loan_contract_status() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_receivable_status_sync_loan ON public.receivables;
CREATE TRIGGER on_receivable_status_sync_loan
AFTER UPDATE OF status ON public.receivables
FOR EACH ROW EXECUTE FUNCTION public.sync_loan_contract_status();

-- 7. RPC atômica: contrato + dívida + parcelas + saída de caixa + auditoria ------------------------
-- O cálculo (juros, total, grade de parcelas) vem do domínio TypeScript; aqui o banco CONFERE:
-- cliente do usuário, juros coerente com o tipo/taxa (tolerância de 1 centavo), total = principal + juros,
-- soma das parcelas = total, numeração 1..N e vencimentos a partir da data do empréstimo.
CREATE OR REPLACE FUNCTION public.create_loan_contract(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_customer_id UUID;
    v_idempotency_key TEXT;
    v_existing UUID;
    v_principal NUMERIC(12, 2);
    v_interest_type TEXT;
    v_rate NUMERIC(9, 4);
    v_interest NUMERIC(12, 2);
    v_total NUMERIC(12, 2);
    v_expected_interest NUMERIC(14, 4);
    v_count INT;
    v_start DATE;
    v_first_due DATE;
    v_source TEXT;
    v_method TEXT;
    v_inst_sum NUMERIC(14, 2);
    v_inst_count INT;
    v_bad INT;
    v_loan_id UUID;
    v_receivable_id UUID;
    v_inst RECORD;
    v_inst_id UUID;
    v_inst_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: operação requer autenticação.' USING ERRCODE = '42501';
    END IF;

    v_idempotency_key := NULLIF(p_payload->>'idempotency_key', '');
    IF v_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing FROM public.loan_contracts WHERE user_id = v_user_id AND idempotency_key = v_idempotency_key;
        IF v_existing IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'loan_contract_id', v_existing, 'already_executed', true,
                'receivable_id', (SELECT id FROM public.receivables WHERE loan_contract_id = v_existing));
        END IF;
    END IF;

    v_customer_id := NULLIF(p_payload->>'customer_id', '')::UUID;
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cliente obrigatório para registrar o empréstimo.';
    END IF;
    PERFORM 1 FROM public.customers WHERE id = v_customer_id AND user_id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente % não encontrado para este usuário.', v_customer_id USING ERRCODE = '42501';
    END IF;

    v_principal := NULLIF(p_payload->>'principal_amount', '')::NUMERIC;
    v_interest_type := p_payload->>'interest_type';
    v_rate := NULLIF(p_payload->>'interest_rate', '')::NUMERIC;
    v_interest := COALESCE(NULLIF(p_payload->>'interest_amount', '')::NUMERIC, 0);
    v_total := NULLIF(p_payload->>'total_amount', '')::NUMERIC;
    v_count := NULLIF(p_payload->>'installments_count', '')::INT;
    v_start := COALESCE(NULLIF(p_payload->>'start_date', '')::DATE, CURRENT_DATE);
    v_source := CASE WHEN lower(COALESCE(p_payload->>'source', 'manual')) IN ('voice', 'ia_voz', 'voice_assistant') THEN 'voice' ELSE 'manual' END;

    IF v_principal IS NULL OR v_principal <= 0 THEN
        RAISE EXCEPTION 'Valor emprestado deve ser maior que zero.';
    END IF;
    IF v_interest_type NOT IN ('percent_total', 'percent_monthly', 'fixed_amount') THEN
        RAISE EXCEPTION 'Tipo de juros inválido: %', v_interest_type;
    END IF;
    IF v_count IS NULL OR v_count < 1 OR v_count > 120 THEN
        RAISE EXCEPTION 'Quantidade de parcelas inválida.';
    END IF;
    IF v_interest < 0 THEN
        RAISE EXCEPTION 'Juros não pode ser negativo.';
    END IF;

    IF v_interest_type = 'fixed_amount' THEN
        v_rate := NULL;
    ELSE
        IF v_rate IS NULL OR v_rate < 0 THEN
            RAISE EXCEPTION 'Informe a taxa de juros.';
        END IF;
        v_expected_interest := v_principal * v_rate / 100 * CASE WHEN v_interest_type = 'percent_monthly' THEN v_count ELSE 1 END;
        IF abs(round(v_expected_interest, 2) - v_interest) > 0.01 THEN
            RAISE EXCEPTION 'Juros (%) não confere com a taxa informada (%).', v_interest, round(v_expected_interest, 2)
                USING HINT = 'INTEREST_MISMATCH';
        END IF;
    END IF;

    IF v_total IS NULL OR v_total <> v_principal + v_interest THEN
        RAISE EXCEPTION 'Total (%) precisa ser o valor emprestado mais os juros (%).', v_total, v_principal + v_interest
            USING HINT = 'TOTAL_MISMATCH';
    END IF;

    IF jsonb_typeof(p_payload->'installments') <> 'array' THEN
        RAISE EXCEPTION 'Parcelas do empréstimo não informadas.';
    END IF;

    SELECT COUNT(*), COALESCE(SUM((e->>'original_value')::NUMERIC), 0),
           COUNT(*) FILTER (WHERE (e->>'original_value')::NUMERIC <= 0
                               OR NULLIF(e->>'due_date', '') IS NULL
                               OR (e->>'due_date')::DATE < v_start
                               OR (e->>'installment_number')::INT NOT BETWEEN 1 AND v_count)
    INTO v_inst_count, v_inst_sum, v_bad
    FROM jsonb_array_elements(p_payload->'installments') e;

    IF v_inst_count <> v_count OR v_bad > 0
       OR (SELECT COUNT(DISTINCT (e->>'installment_number')::INT) FROM jsonb_array_elements(p_payload->'installments') e) <> v_count THEN
        RAISE EXCEPTION 'Grade de parcelas inválida.' USING HINT = 'SCHEDULE_INVALID';
    END IF;
    IF v_inst_sum <> v_total THEN
        RAISE EXCEPTION 'Parcelas (%) não fecham com o total do empréstimo (%).', v_inst_sum, v_total USING HINT = 'SCHEDULE_MISMATCH';
    END IF;

    SELECT MIN((e->>'due_date')::DATE) INTO v_first_due FROM jsonb_array_elements(p_payload->'installments') e;

    v_method := CASE COALESCE(NULLIF(p_payload->>'payment_method', ''), 'pix') WHEN 'card' THEN 'credit_card'
        ELSE COALESCE(NULLIF(p_payload->>'payment_method', ''), 'pix') END;
    IF v_method NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION 'Forma de pagamento inválida: %', v_method;
    END IF;

    INSERT INTO public.loan_contracts (
        user_id, customer_id, principal_amount, interest_type, interest_rate, interest_amount, total_amount,
        installments_count, start_date, first_due_date, status, notes, source, idempotency_key
    ) VALUES (
        v_user_id, v_customer_id, v_principal, v_interest_type, v_rate, v_interest, v_total,
        v_count, v_start, v_first_due, 'active', NULLIF(LEFT(p_payload->>'notes', 1000), ''), v_source, v_idempotency_key
    ) RETURNING id INTO v_loan_id;

    INSERT INTO public.receivables (user_id, deal_id, loan_contract_id, customer_id, total_amount, paid_amount, balance, status)
    VALUES (v_user_id, NULL, v_loan_id, v_customer_id, v_total, 0.00, v_total, 'pending')
    RETURNING id INTO v_receivable_id;

    FOR v_inst IN
        SELECT * FROM jsonb_to_recordset(p_payload->'installments')
            AS y(installment_number INT, original_value NUMERIC, due_date DATE)
        ORDER BY installment_number
    LOOP
        INSERT INTO public.installments (
            user_id, receivable_id, installment_number, total_installments,
            original_value, paid_value, balance, due_date, status, is_promissory
        ) VALUES (
            v_user_id, v_receivable_id, v_inst.installment_number, v_count,
            v_inst.original_value, 0.00, v_inst.original_value, v_inst.due_date, 'pending', false
        ) RETURNING id INTO v_inst_id;
        v_inst_ids := v_inst_ids || v_inst_id;
    END LOOP;

    -- O dinheiro emprestado sai do caixa
    INSERT INTO public.cash_movements (user_id, deal_id, loan_contract_id, direction, amount, payment_method, movement_date, description)
    VALUES (v_user_id, NULL, v_loan_id, 'OUT', v_principal, v_method, v_start, 'Empréstimo concedido');

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_after)
    VALUES (v_user_id, 'loan_contracts', v_loan_id, 'CREATE_LOAN_CONTRACT',
            CASE WHEN v_source = 'voice' THEN 'VOICE_AI' ELSE 'MANUAL_WEB' END,
            p_payload || jsonb_build_object('loan_contract_id', v_loan_id, 'receivable_id', v_receivable_id));

    RETURN jsonb_build_object(
        'success', true,
        'loan_contract_id', v_loan_id,
        'receivable_id', v_receivable_id,
        'installment_ids', to_jsonb(v_inst_ids)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_loan_contract(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_loan_contract(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_loan_contract(JSONB) TO authenticated, service_role;

-- 8. Fotos de mercadoria (bucket privado, pasta = id do usuário) ------------------------------------
-- Em projetos onde o papel da migration não pode alterar storage.objects, o bloco só avisa:
-- o cadastro de mercadoria continua funcionando sem foto.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('item-photos', 'item-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
        ON CONFLICT (id) DO NOTHING;

        DROP POLICY IF EXISTS "item_photos_select_own" ON storage.objects;
        CREATE POLICY "item_photos_select_own" ON storage.objects FOR SELECT TO authenticated
            USING (bucket_id = 'item-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
        DROP POLICY IF EXISTS "item_photos_insert_own" ON storage.objects;
        CREATE POLICY "item_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (bucket_id = 'item-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
        DROP POLICY IF EXISTS "item_photos_delete_own" ON storage.objects;
        CREATE POLICY "item_photos_delete_own" ON storage.objects FOR DELETE TO authenticated
            USING (bucket_id = 'item-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
    END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
    RAISE NOTICE 'Bucket/policies de fotos não configurados: %', SQLERRM;
END;
$$;
