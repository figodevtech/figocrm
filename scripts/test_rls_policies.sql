-- scripts/test_rls_policies.sql
-- Bateria de testes de validação para isolamento multi-tenant (RLS e RPC) — Fase 24.5

BEGIN;

-- 1. Criação de dois usuários simulados no auth.users
INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'usuario_a@teste.com'),
    ('22222222-2222-2222-2222-222222222222', 'usuario_b@teste.com');

-- 2. Contexto do Usuário A
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Usuário A cadastra clientes, itens, negociações e parcelas
INSERT INTO public.customers (id, user_id, name, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Cliente do Usuário A', '11999990001');

INSERT INTO public.items (id, user_id, name, acquisition_cost, status)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'iPhone 13 do Usuário A', 2000.00, 'disponivel');

INSERT INTO public.deals (id, user_id, customer_id, deal_type, total_value, recognized_profit, status)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'venda', 3000.00, 1000.00, 'concluida');

INSERT INTO public.deal_items (id, deal_id, item_id, direction, evaluated_value)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'OUT', 3000.00);

-- Verificação: Usuário A enxerga seus dados
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM public.customers) = 1, 'Usuário A deveria ver 1 cliente';
    ASSERT (SELECT COUNT(*) FROM public.items) = 1, 'Usuário A deveria ver 1 item';
    ASSERT (SELECT COUNT(*) FROM public.deals) = 1, 'Usuário A deveria ver 1 deal';
    ASSERT (SELECT COUNT(*) FROM public.deal_items) = 1, 'Usuário A deveria ver 1 deal_item';
END $$;

-- 3. Troca de Contexto: Usuário B assume a sessão
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

-- Verificação 1: Usuário B NÃO PODE ENXERGAR os registros do Usuário A (SELECT = 0)
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM public.customers) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou clientes do Usuário A';
    ASSERT (SELECT COUNT(*) FROM public.items) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou itens do Usuário A';
    ASSERT (SELECT COUNT(*) FROM public.deals) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou negociações do Usuário A';
    ASSERT (SELECT COUNT(*) FROM public.deal_items) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou itens de negociação do Usuário A';
END $$;

-- Verificação 2: Usuário B NÃO PODE ALTERAR dados do Usuário A (UPDATE tem efeito 0)
UPDATE public.items 
SET name = 'Hackeado por B' 
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Verificação 3: Usuário B NÃO PODE EXCLUIR dados do Usuário A (DELETE tem efeito 0)
DELETE FROM public.customers 
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Verificação 4: Usuário B NÃO PODE EXECUTAR RPC dos indicadores do Usuário A
DO $$
DECLARE
    v_error_caught BOOLEAN := FALSE;
BEGIN
    BEGIN
        PERFORM public.get_dashboard_indicators('11111111-1111-1111-1111-111111111111');
    EXCEPTION WHEN OTHERS THEN
        v_error_caught := TRUE;
    END;

    ASSERT v_error_caught = TRUE, 'VIOLAÇÃO DE SEGURANÇA: Usuário B conseguiu invocar get_dashboard_indicators do Usuário A';
END $$;

-- 4. Retorna ao Contexto do Usuário A para certificar que nada foi alterado
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
    v_item_name TEXT;
    v_cust_count INT;
BEGIN
    SELECT name INTO v_item_name FROM public.items WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    SELECT COUNT(*) INTO v_cust_count FROM public.customers WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    ASSERT v_item_name = 'iPhone 13 do Usuário A', 'Item do Usuário A foi corrompido';
    ASSERT v_cust_count = 1, 'Cliente do Usuário A foi indevidamente deletado';
    
    RAISE NOTICE 'FASE 24: TODOS OS TESTES DE RLS E RPC MULTI-TENANT PASSARAM COM SUCESSO!';
END $$;

ROLLBACK; -- Desfaz os registros temporários de teste
