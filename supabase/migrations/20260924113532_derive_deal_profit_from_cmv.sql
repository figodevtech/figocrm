-- O lucro e o CMV são sempre derivados dos itens persistidos, inclusive em chamadas diretas à Data API.
-- A RPC antiga pode continuar recebendo recognized_profit por compatibilidade: o trigger o ignora.

CREATE OR REPLACE FUNCTION public.deal_profit_from_items(p_deal_id UUID, p_total NUMERIC, p_type TEXT)
RETURNS TABLE(recognized_profit NUMERIC, profit_pending BOOLEAN)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT
        CASE WHEN (p_type IN ('venda', 'troca') AND count(*) = 0)
                    OR COALESCE(bool_or(i.cost_pending), false)
             THEN 0::NUMERIC
             ELSE p_total - COALESCE(sum(i.acquisition_cost + costs.amount), 0)
        END::NUMERIC,
        ((p_type IN ('venda', 'troca') AND count(*) = 0)
                    OR COALESCE(bool_or(i.cost_pending), false))::BOOLEAN
    FROM public.deal_items di
    JOIN public.items i ON i.id = di.item_id
    CROSS JOIN LATERAL (
        SELECT COALESCE(sum(ic.amount), 0) AS amount
        FROM public.item_costs ic WHERE ic.item_id = i.id
    ) costs
    WHERE di.deal_id = p_deal_id AND di.direction = 'OUT';
$$;

REVOKE ALL ON FUNCTION public.deal_profit_from_items(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deal_profit_from_items(UUID, NUMERIC, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_derived_deal_profit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT p.recognized_profit, p.profit_pending
      INTO NEW.recognized_profit, NEW.profit_pending
      FROM public.deal_profit_from_items(NEW.id, NEW.total_value, NEW.deal_type) p;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_derived_deal_profit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS derive_deal_profit ON public.deals;
CREATE TRIGGER derive_deal_profit
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.set_derived_deal_profit();

-- A Data API não pode trocar preço, tipo ou cliente depois de gravar uma negociação.
-- As RPCs INVOKER só precisam atualizar estes dois campos derivados; o trigger os recalcula.
REVOKE UPDATE, DELETE ON public.deals FROM PUBLIC, anon, authenticated;
GRANT UPDATE (recognized_profit, profit_pending) ON public.deals TO authenticated;
REVOKE UPDATE, DELETE ON public.deal_items FROM PUBLIC, anon, authenticated;
GRANT UPDATE (item_id) ON public.deal_items TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_deal_profit(p_deal_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- O BEFORE trigger da tabela calcula o valor; nenhum chamador fornece lucro ou CMV.
    UPDATE public.deals SET recognized_profit = 0 WHERE id = p_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_deal_profit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_deal_profit(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_deal_item_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.deals d JOIN public.items i ON i.user_id = d.user_id
        WHERE d.id = NEW.deal_id AND i.id = NEW.item_id
    ) THEN
        RAISE EXCEPTION 'Mercadoria não pertence ao dono da negociação.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_deal_item_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS check_deal_item_owner ON public.deal_items;
CREATE TRIGGER check_deal_item_owner
BEFORE INSERT OR UPDATE OF deal_id, item_id ON public.deal_items
FOR EACH ROW EXECUTE FUNCTION public.check_deal_item_owner();

CREATE OR REPLACE FUNCTION public.check_item_cost_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = NEW.item_id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Custo não pertence ao dono da mercadoria.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_item_cost_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS check_item_cost_owner ON public.item_costs;
CREATE TRIGGER check_item_cost_owner
BEFORE INSERT OR UPDATE OF item_id, user_id ON public.item_costs
FOR EACH ROW EXECUTE FUNCTION public.check_item_cost_owner();

CREATE OR REPLACE FUNCTION public.refresh_profit_after_deal_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM public.refresh_deal_profit(OLD.deal_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM public.refresh_deal_profit(NEW.deal_id); END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_profit_after_deal_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refresh_profit_deal_item ON public.deal_items;
CREATE TRIGGER refresh_profit_deal_item
AFTER INSERT OR UPDATE OR DELETE ON public.deal_items
FOR EACH ROW EXECUTE FUNCTION public.refresh_profit_after_deal_item();

CREATE OR REPLACE FUNCTION public.refresh_profit_after_item_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM public.refresh_deal_profit(di.deal_id)
        FROM public.deal_items di WHERE di.item_id = OLD.item_id AND di.direction = 'OUT';
    END IF;
    IF TG_OP <> 'DELETE' THEN
        PERFORM public.refresh_deal_profit(di.deal_id)
        FROM public.deal_items di WHERE di.item_id = NEW.item_id AND di.direction = 'OUT';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_profit_after_item_cost() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refresh_profit_item_cost ON public.item_costs;
CREATE TRIGGER refresh_profit_item_cost
AFTER INSERT OR UPDATE OR DELETE ON public.item_costs
FOR EACH ROW EXECUTE FUNCTION public.refresh_profit_after_item_cost();

CREATE OR REPLACE FUNCTION public.refresh_profit_after_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.acquisition_cost IS DISTINCT FROM NEW.acquisition_cost
       OR OLD.cost_pending IS DISTINCT FROM NEW.cost_pending THEN
        PERFORM public.refresh_deal_profit(di.deal_id)
        FROM public.deal_items di WHERE di.item_id = NEW.id AND di.direction = 'OUT';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_profit_after_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refresh_profit_item ON public.items;
CREATE TRIGGER refresh_profit_item
AFTER UPDATE OF acquisition_cost, cost_pending ON public.items
FOR EACH ROW EXECUTE FUNCTION public.refresh_profit_after_item();

-- Corrige dados históricos que foram calculados pelo cliente ou pelo payload.
UPDATE public.deals SET recognized_profit = 0;
