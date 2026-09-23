-- 20260923000012_append_only_ledger.sql
-- Histórico financeiro só-inclusão. Pagamentos, abatimentos, movimentos de caixa e liquidações nunca
-- são alterados nem apagados pelo usuário: correção é sempre um estorno (reverse_settlement).
-- Antes, as policies *_update_own / *_delete_own permitiam apagar um pagamento pela API REST sem
-- reverter o saldo da parcela.
--
-- As referências de estorno passam a NO ACTION (verificação no fim do comando) para que a exclusão
-- da conta (cascade a partir de profiles) remova original e estorno juntos sem depender da ordem.

DROP POLICY IF EXISTS "payments_update_own" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_own" ON public.payments;
DROP POLICY IF EXISTS "adjustments_update_own" ON public.adjustments;
DROP POLICY IF EXISTS "adjustments_delete_own" ON public.adjustments;
DROP POLICY IF EXISTS "cash_movements_update_own" ON public.cash_movements;
DROP POLICY IF EXISTS "cash_movements_delete_own" ON public.cash_movements;

REVOKE UPDATE, DELETE, TRUNCATE ON public.payments FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.adjustments FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.cash_movements FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.settlements FROM anon, authenticated;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_reversal_of_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_reversal_of_fkey
    FOREIGN KEY (reversal_of) REFERENCES public.payments(id);
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_settlement_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_settlement_id_fkey
    FOREIGN KEY (settlement_id) REFERENCES public.settlements(id);

ALTER TABLE public.adjustments DROP CONSTRAINT IF EXISTS adjustments_reversal_of_fkey;
ALTER TABLE public.adjustments ADD CONSTRAINT adjustments_reversal_of_fkey
    FOREIGN KEY (reversal_of) REFERENCES public.adjustments(id);
ALTER TABLE public.adjustments DROP CONSTRAINT IF EXISTS adjustments_settlement_id_fkey;
ALTER TABLE public.adjustments ADD CONSTRAINT adjustments_settlement_id_fkey
    FOREIGN KEY (settlement_id) REFERENCES public.settlements(id);

ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_reversal_of_fkey;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_reversal_of_fkey
    FOREIGN KEY (reversal_of) REFERENCES public.cash_movements(id);
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_settlement_id_fkey;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_settlement_id_fkey
    FOREIGN KEY (settlement_id) REFERENCES public.settlements(id);

ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_reversal_of_fkey;
ALTER TABLE public.settlements ADD CONSTRAINT settlements_reversal_of_fkey
    FOREIGN KEY (reversal_of) REFERENCES public.settlements(id);
