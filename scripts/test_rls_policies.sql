-- test_rls_policies.sql
-- Bateria de testes de validação para isolamento multi-tenant (RLS)

BEGIN;

-- 1. Criação de dois usuários simulados no auth.users
INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'usuario_a@teste.com'),
    ('22222222-2222-2222-2222-222222222222', 'usuario_b@teste.com');

-- 2. Contexto do Usuário A
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Usuário A cadastra seus dados
INSERT INTO public.customers (id, user_id, name, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Cliente do Usuário A', '11999990001');

INSERT INTO public.items (id, user_id, name, acquisition_cost, status)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'iPhone 13 do Usuário A', 2000.00, 'disponivel');

-- Verificação: Usuário A enxerga 1 cliente e 1 item
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM public.customers) = 1, 'Usuário A deveria ver 1 cliente';
    ASSERT (SELECT COUNT(*) FROM public.items) = 1, 'Usuário A deveria ver 1 item';
END $$;

-- 3. Troca de Contexto: Usuário B assume a sessão
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

-- Verificação 1: Usuário B NÃO PODE ENXERGAR os registros do Usuário A
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM public.customers) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou clientes do Usuário A';
    ASSERT (SELECT COUNT(*) FROM public.items) = 0, 'VIOLAÇÃO DE RLS: Usuário B enxergou itens do Usuário A';
END $$;

-- Verificação 2: Usuário B NÃO PODE ALTERAR dados do Usuário A
UPDATE public.items 
SET name = 'Hackeado por B' 
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Verificação 3: Usuário B NÃO PODE EXCLUIR dados do Usuário A
DELETE FROM public.customers 
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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
    
    RAISE NOTICE 'TODOS OS TESTES DE RLS PASSARAM COM ISOLAMENTO PERFEITO!';
END $$;

ROLLBACK; -- Desfaz os registros temporários de teste
