'use client';
// Negócios em cards com filtro simples (Todos / Vendas / Trocas / Compras).
import Link from 'next/link';
import { useState } from 'react';
import type { DealCardView } from '@/lib/domain/app-data';
import { formatBRL, formatShortDate, matchesSearch } from '@/lib/format';
import { Badge } from '@/components/ui/layout';

type Filter = 'todos' | 'venda' | 'troca' | 'compra';
const LABEL: Record<Filter, string> = { todos: 'Todos', venda: 'Vendas', troca: 'Trocas', compra: 'Compras' };
const TONE = { venda: 'emerald', troca: 'sky', compra: 'violet', outro: 'neutral' } as const;

export function DealsList({ deals }: { deals: DealCardView[] }) {
  const [filter, setFilter] = useState<Filter>('todos');
  const [query, setQuery] = useState('');
  const hasPurchases = deals.some((d) => d.type === 'compra');
  const filters = (['todos', 'venda', 'troca', ...(hasPurchases ? ['compra'] : [])] as Filter[]);
  const visible = deals.filter((d) => (filter === 'todos' ? true : d.type === filter)).filter((d) => matchesSearch(query, d.title, d.customerName));

  return (
    <div className="space-y-4">
      <label htmlFor="buscar-negocio" className="sr-only">
        Buscar negócio
      </label>
      <input
        id="buscar-negocio"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por cliente ou mercadoria"
        className="min-h-12 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 text-base text-white placeholder-slate-500 focus:border-emerald-400"
      />
      <div role="tablist" aria-label="Tipo de negócio" className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${filter === f ? 'bg-white text-slate-900' : 'bg-white/6 text-slate-300 hover:bg-white/10'}`}
          >
            {LABEL[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-base text-slate-400">Nenhum negócio neste filtro.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((d) => (
            <li key={d.id}>
              <Link href={`/app/clientes/${d.customerId}`} className="block rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/25">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-lg font-semibold leading-snug text-white">{d.title}</p>
                  <Badge tone={TONE[d.type]}>{d.typeLabel}</Badge>
                </div>
                <p className="mt-1 text-base text-slate-400">
                  {d.customerName} · {formatShortDate(d.date)}
                </p>
                <p className="tabular mt-2 text-xl font-bold text-white">{formatBRL(d.totalValue)}</p>
                <div className="tabular mt-1 space-y-0.5 text-base">
                  {d.received > 0 ? <p className="text-emerald-300">{formatBRL(d.received)} recebido</p> : null}
                  {d.toReceive > 0 ? <p className="text-amber-300">{formatBRL(d.toReceive)} a receber</p> : null}
                  {d.paid > 0 ? <p className="text-rose-300">{formatBRL(d.paid)} pago por você</p> : null}
                  {d.toPay > 0 ? <p className="text-rose-300">{formatBRL(d.toPay)} a pagar</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
