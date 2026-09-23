// src/lib/domain/queries.ts
// Consultas por Voz Read-Only — Fase J do FigoCRM
// Responde perguntas rápidas do vendedor sobre valores a receber, estoque, atrasos e recebimentos do dia.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatCurrencyFromCents, toCents } from '@/lib/finance/money';
import type { ConversationContext } from '@/lib/ai/context_manager';
import { EntityCandidate, resolveCustomerReference } from '@/lib/domain/entity-resolver';

export interface VoiceQueryResult {
  success: boolean;
  queryType: string;
  responseSummary: string;
  data?: Record<string, unknown>;
  error?: string;
  requiresConfirmation?: boolean;
  pendingChoice?: { field: 'customer'; candidates: EntityCandidate[] };
  resolvedCustomer?: { id: string; name: string };
}

/**
 * Executa uma consulta de voz baseada no tipo detectado e cliente/período.
 */
export async function executeVoiceQuery(
  supabase: SupabaseClient,
  userId: string,
  queryType: string,
  customerRef?: { id?: string; name?: string },
  context?: ConversationContext
): Promise<VoiceQueryResult> {
  const user = { id: userId };

  try {
    switch (queryType) {
      case 'quanto_fulano_deve': {
        if (!customerRef?.id && !customerRef?.name && !context?.lastCustomer) {
          return {
            success: false,
            queryType,
            responseSummary: 'De quem você quer saber a dívida? Me diga o nome do cliente.',
            requiresConfirmation: true,
          };
        }

        const custRes = await resolveCustomerReference(supabase, user.id, {
          id: customerRef?.id,
          name: customerRef?.name,
          context: context?.lastCustomer,
        });

        if (custRes.status === 'ambiguous') {
          return {
            success: false,
            queryType,
            responseSummary: custRes.promptQuestion!,
            requiresConfirmation: true,
            pendingChoice: { field: 'customer', candidates: custRes.candidates! },
          };
        }

        const cust = custRes.entity;
        if (!cust) {
          return {
            success: true,
            queryType,
            responseSummary: custRes.promptQuestion || 'Não encontrei esse cliente no seu cadastro.',
          };
        }

        const { data: recs } = await supabase
          .from('receivables')
          .select('balance')
          .eq('user_id', user.id)
          .eq('customer_id', cust.id)
          .in('status', ['pending', 'partially_paid'])
          .gt('balance', 0);

        const totalDebt = (recs || []).reduce((acc, r) => acc + Number(r.balance), 0);
        const debtStr = formatCurrencyFromCents(toCents(totalDebt));

        return {
          success: true,
          queryType,
          responseSummary: totalDebt > 0
            ? `${cust.name} deve ${debtStr} em aberto.`
            : `${cust.name} está em dia. Não tem dívidas em aberto.`,
          data: { totalDebt, customer: cust.name },
          resolvedCustomer: { id: cust.id, name: cust.name },
        };
      }

      case 'quem_esta_atrasado': {
        const today = new Date().toISOString().split('T')[0];
        const { data: overdue } = await supabase
          .from('installments')
          .select('id, balance, due_date, receivables(customers(name))')
          .eq('user_id', user.id)
          .lt('due_date', today)
          .in('status', ['pending', 'partially_paid', 'overdue'])
          .order('due_date', { ascending: true })
          .limit(5);

        if (!overdue || overdue.length === 0) {
          return {
            success: true,
            queryType,
            responseSummary: 'Boa notícia! Ninguém está com parcelas atrasadas no momento.',
          };
        }

        const names = Array.from(
          new Set(
            overdue
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((i: any) => i.receivables?.customers?.name)
              .filter(Boolean)
          )
        );

        return {
          success: true,
          queryType,
          responseSummary: `Clientes com parcelas atrasadas: ${names.join(', ')}.`,
          data: { count: overdue.length, clients: names },
        };
      }

      case 'quanto_tenho_na_rua': {
        const { data: recs } = await supabase
          .from('receivables')
          .select('balance')
          .eq('user_id', user.id)
          .gt('balance', 0);

        const totalStreet = (recs || []).reduce((acc, r) => acc + Number(r.balance), 0);
        const streetStr = formatCurrencyFromCents(toCents(totalStreet));

        return {
          success: true,
          queryType,
          responseSummary: `Você tem ${streetStr} a receber na rua no total.`,
          data: { totalStreet },
        };
      }

      case 'quanto_tenho_em_mercadoria': {
        const { data: items } = await supabase
          .from('items')
          .select('acquisition_cost')
          .eq('user_id', user.id)
          .eq('status', 'disponivel');

        const totalStock = (items || []).reduce((acc, i) => acc + Number(i.acquisition_cost), 0);
        const stockStr = formatCurrencyFromCents(toCents(totalStock));

        return {
          success: true,
          queryType,
          responseSummary: `Você tem ${items?.length || 0} mercadorias no estoque avaliadas em ${stockStr}.`,
          data: { totalStock, itemCount: items?.length || 0 },
        };
      }

      case 'qual_proxima_parcela': {
        const today = new Date().toISOString().split('T')[0];
        const { data: nextInst } = await supabase
          .from('installments')
          .select('id, original_value, balance, due_date, receivables(customers(name))')
          .eq('user_id', user.id)
          .gte('due_date', today)
          .in('status', ['pending', 'partially_paid'])
          .order('due_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!nextInst) {
          return {
            success: true,
            queryType,
            responseSummary: 'Não há próximas parcelas agendadas para vencer.',
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientName = (nextInst as any).receivables?.customers?.name || 'Cliente';
        const valStr = formatCurrencyFromCents(toCents(Number(nextInst.balance)));
        const dateStr = new Date(nextInst.due_date).toLocaleDateString('pt-BR');

        return {
          success: true,
          queryType,
          responseSummary: `A próxima parcela a vencer é de ${clientName}, no valor de ${valStr} para ${dateStr}.`,
          data: nextInst,
        };
      }

      default: {
        return {
          success: true,
          queryType,
          responseSummary: 'Consulta realizada com sucesso.',
        };
      }
    }
  } catch (err) {
    console.error('Erro na consulta por voz:', err);
    return {
      success: false,
      queryType,
      responseSummary: 'Não foi possível carregar as informações no momento.',
      error: (err as Error).message,
    };
  }
}
