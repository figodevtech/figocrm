// src/app/actions/dashboard.ts
// Ações do Sistema: Apuração dos 4 Indicadores da Home (Fase 7)
'use server';

import { createClient } from '@/lib/supabase/server';
import { calculateDashboardIndicators } from '@/lib/financial_engine';
import { DashboardIndicators, Installment, Item, Deal } from '@/types/domain';

export async function getDashboardSummaryAction(): Promise<{ indicators?: DashboardIndicators; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return {
        indicators: { naRua: 0, atrasado: 0, emMercadoria: 0, quantoGanhouMes: 0 },
        error: 'Não autenticado.',
      };
    }

    // 1. Tentar obter diretamente pela procedure otimizada no PostgreSQL
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_indicators', {
      p_user_id: user.id,
    });

    if (!rpcError && rpcData && rpcData.length > 0) {
      const row = rpcData[0];
      return {
        indicators: {
          naRua: Number(row.na_rua || 0),
          atrasado: Number(row.atrasado || 0),
          emMercadoria: Number(row.em_mercadoria || 0),
          quantoGanhouMes: Number(row.quanto_ganhou_mes || 0),
        },
      };
    }

    // 2. Fallback determinístico caso o RPC ainda não esteja carregado
    const [instRes, itemsRes, dealsRes] = await Promise.all([
      supabase.from('installments').select('*').eq('user_id', user.id),
      supabase.from('items').select('*, item_costs(*)').eq('user_id', user.id),
      supabase.from('deals').select('*').eq('user_id', user.id).eq('status', 'concluida'),
    ]);

    const installments = (instRes.data || []) as Installment[];
    const items = (itemsRes.data || []) as Item[];
    const deals = (dealsRes.data || []) as Deal[];

    const indicators = calculateDashboardIndicators(installments, items, deals, new Date());
    return { indicators };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao calcular indicadores.';
    return { error: message };
  }
}
