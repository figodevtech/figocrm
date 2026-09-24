'use client';
// Estoque em cards: custo total, venda sugerida e status em português. Atalhos Vender / Editar.
import Link from 'next/link';
import { useState } from 'react';
import { Package, Search } from 'lucide-react';
import type { StockItemView } from '@/lib/domain/app-data';
import { formatBRL, matchesSearch } from '@/lib/format';
import { Badge } from '@/components/ui/layout';

type Filter = 'disponiveis' | 'reservados' | 'vendidos' | 'todos';

const statusTone = { available: 'emerald', trade_in: 'sky', reserved: 'amber', sold: 'neutral', preparing: 'violet', returned: 'neutral' } as const;

export function StockList({ items }: { items: StockItemView[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('disponiveis');

  const byFilter = (i: StockItemView) =>
    filter === 'disponiveis' ? i.status === 'disponivel' || i.status === 'em_preparacao' : filter === 'reservados' ? i.status === 'reservado' : filter === 'vendidos' ? i.status === 'vendido' : true;
  const visible = items.filter(byFilter).filter((i) => matchesSearch(query, i.name, i.brand, i.model, i.imei, i.plate, i.serialNumber, i.identifier));
  const label: Record<Filter, string> = { disponiveis: 'Disponíveis', reservados: 'Reservados', vendidos: 'Vendidos', todos: 'Todos' };

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor="buscar-estoque" className="sr-only">
          Buscar no estoque
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          id="buscar-estoque"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar (nome, IMEI, placa)"
          className="min-h-12 w-full rounded-xl border border-white/10 bg-slate-900/80 pl-12 pr-4 text-base text-white placeholder-slate-500 focus:border-emerald-400"
        />
      </div>

      <div role="tablist" aria-label="Filtro do estoque" className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(label) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${filter === f ? 'bg-white text-slate-900' : 'bg-white/6 text-slate-300 hover:bg-white/10'}`}
          >
            {label[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-base text-slate-400">{query ? `Nada com “${query}”.` : 'Nenhuma mercadoria neste filtro.'}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((i) => (
            <li key={i.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <Link href={`/app/estoque/${i.id}`} className="flex gap-3">
                {i.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária
                  <img src={i.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/6 text-slate-500">
                    <Package className="h-7 w-7" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-snug text-white">{i.name}</span>
                  <span className="mt-1 inline-block">
                    <Badge tone={statusTone[i.statusKey]}>{i.statusLabel}</Badge>
                  </span>
                </span>
              </Link>
              <div className="tabular mt-3 grid grid-cols-2 gap-2 text-base">
                <div>
                  <p className="text-sm text-slate-400">Custo</p>
                  <p className="font-semibold text-white">{formatBRL(i.totalCost)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Venda sugerida</p>
                  <p className="font-semibold text-emerald-300">{i.targetSalePrice !== null ? formatBRL(i.targetSalePrice) : '—'}</p>
                </div>
              </div>
              {i.status === 'disponivel' || i.status === 'reservado' ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link
                    href={i.status === 'disponivel' ? `/app/vendas/nova?item=${i.id}` : `/app/estoque/${i.id}`}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-emerald-500 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
                  >
                    {i.status === 'disponivel' ? 'Vender' : 'Liberar reserva'}
                  </Link>
                  <Link
                    href={`/app/estoque/${i.id}/editar`}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-base font-semibold text-slate-100 hover:bg-white/10"
                  >
                    Editar
                  </Link>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
