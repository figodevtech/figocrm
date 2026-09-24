ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS document TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_document_format CHECK (
    document IS NULL OR (document ~ '^[0-9./-]+$' AND length(regexp_replace(document, '[^0-9]', '', 'g')) IN (11, 14))
);
GRANT UPDATE (document, address) ON public.profiles TO authenticated;

CREATE TABLE public.loan_contract_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_contract_id UUID NOT NULL REFERENCES public.loan_contracts(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creditor_snapshot JSONB NOT NULL,
    debtor_snapshot JSONB NOT NULL,
    financial_snapshot JSONB NOT NULL,
    terms_snapshot JSONB NOT NULL,
    signature_status TEXT NOT NULL DEFAULT 'unsigned' CHECK (signature_status IN ('unsigned', 'pending', 'signed')),
    signed_at TIMESTAMPTZ,
    signature_provider TEXT,
    external_document_id TEXT,
    UNIQUE (loan_contract_id, version)
);

CREATE INDEX idx_loan_contract_documents_user ON public.loan_contract_documents(user_id, loan_contract_id, version DESC);
ALTER TABLE public.loan_contract_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loan_contract_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.loan_contract_documents TO authenticated;
CREATE POLICY loan_documents_select_own ON public.loan_contract_documents
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TRIGGER enforce_write_access BEFORE INSERT ON public.loan_contract_documents
FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_write_access();

CREATE OR REPLACE FUNCTION public.issue_loan_document(p_loan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_loan public.loan_contracts%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_customer public.customers%ROWTYPE;
    v_creditor JSONB;
    v_debtor JSONB;
    v_financial JSONB;
    v_terms JSONB;
    v_latest public.loan_contract_documents%ROWTYPE;
    v_document_id UUID;
    v_version INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_loan FROM public.loan_contracts
    WHERE id = p_loan_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Empréstimo não encontrado.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    SELECT * INTO v_customer FROM public.customers WHERE id = v_loan.customer_id AND user_id = v_user_id;

    IF NULLIF(trim(v_profile.full_name), '') IS NULL
       OR NULLIF(trim(v_profile.document), '') IS NULL
       OR NULLIF(trim(v_profile.address), '') IS NULL
       OR NULLIF(trim(v_customer.name), '') IS NULL
       OR NULLIF(trim(v_customer.document), '') IS NULL
       OR NULLIF(trim(v_customer.address), '') IS NULL THEN
        RAISE EXCEPTION 'Faltam nome, CPF/CNPJ ou endereço do credor ou devedor para emitir o contrato.' USING HINT = 'DOCUMENT_DATA_MISSING';
    END IF;

    v_creditor := jsonb_build_object('name', v_profile.full_name, 'business_name', v_profile.business_name,
        'document', v_profile.document, 'address', v_profile.address, 'phone', v_profile.phone);
    v_debtor := jsonb_build_object('name', v_customer.name, 'document', v_customer.document,
        'address', v_customer.address, 'phone', v_customer.phone);
    v_financial := jsonb_build_object(
        'contract_number', v_loan.id::TEXT,
        'start_date', v_loan.start_date,
        'principal_amount', v_loan.principal_amount,
        'interest_type', v_loan.interest_type,
        'interest_rate', v_loan.interest_rate,
        'interest_amount', v_loan.interest_amount,
        'total_amount', v_loan.total_amount,
        'installments_count', v_loan.installments_count,
        'installments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('number', i.installment_number,
                'amount', i.original_value, 'due_date', i.due_date) ORDER BY i.installment_number)
            FROM public.receivables r JOIN public.installments i ON i.receivable_id = r.id
            WHERE r.loan_contract_id = v_loan.id AND r.user_id = v_user_id
        ), '[]'::jsonb)
    );
    v_terms := jsonb_build_object('notes', v_loan.notes);

    SELECT * INTO v_latest FROM public.loan_contract_documents
    WHERE loan_contract_id = v_loan.id AND user_id = v_user_id
    ORDER BY version DESC LIMIT 1;
    IF FOUND AND v_latest.creditor_snapshot = v_creditor
       AND v_latest.debtor_snapshot = v_debtor
       AND v_latest.financial_snapshot = v_financial
       AND v_latest.terms_snapshot = v_terms THEN
        RETURN jsonb_build_object('id', v_latest.id, 'version', v_latest.version, 'already_issued', true);
    END IF;

    v_version := COALESCE(v_latest.version, 0) + 1;
    INSERT INTO public.loan_contract_documents
        (loan_contract_id, user_id, version, creditor_snapshot, debtor_snapshot, financial_snapshot, terms_snapshot)
    VALUES (v_loan.id, v_user_id, v_version, v_creditor, v_debtor, v_financial, v_terms)
    RETURNING id INTO v_document_id;

    INSERT INTO public.audit_log (user_id, entity_name, entity_id, action_type, source, payload_after)
    VALUES (v_user_id, 'loan_contract_documents', v_document_id, 'ISSUE_LOAN_DOCUMENT', 'MANUAL_WEB',
        jsonb_build_object('loan_contract_id', v_loan.id, 'version', v_version));

    RETURN jsonb_build_object('id', v_document_id, 'version', v_version, 'already_issued', false);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_loan_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_loan_document(UUID) TO authenticated;
