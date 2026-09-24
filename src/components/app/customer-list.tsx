'use client';
// Lista de clientes em cards (sem tabela), com busca no topo e filtro simples.
import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { CustomerListItem } from '@/lib/domain/app-data';
import { formatBRL, formatPhone, matchesSearch } from '@/lib/format';

type Filter = 'todos' | 'devendo' | 'atrasados';

export function CustomerList({ customers, initialFilter = 'todos' }: { customers: CustomerListItem[]; initialFilter?: Filter }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(initialFilter);

  const visible = customers
    .filter((c) => (filter === 'devendo' ? c.owes > 0 : filter === 'atrasados' ? c.overdue > 0 : true))
    .filter((c) => matchesSearch(query, c.name, c.phone, c.document));

  const counts = { todos: customers.length, devendo: customers.filter((c) => c.owes > 0).length, atrasados: customers.filter((c) => c.overdue > 0).length };

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor="buscar-cliente" className="sr-only">
          Buscar cliente
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          id="buscar-cliente"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente"
          className="min-h-12 w-full rounded-xl border border-white/10 bg-slate-900/80 pl-12 pr-4 text-base text-white placeholder-slate-500 focus:border-emerald-400"
        />
      </div>

      <div role="tablist" aria-label="Filtro" className="flex gap-2 overflow-x-auto pb-1">
        {(['todos', 'devendo', 'atrasados'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold capitalize ${filter === f ? 'bg-white text-slate-900' : 'bg-white/6 text-slate-300 hover:bg-white/10'}`}
          >
            {f === 'todos' ? 'Todos' : f === 'devendo' ? 'Devendo' : 'Atrasados'} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-base text-slate-400">{query ? `Nenhum cliente com “${query}”.` : 'Nenhum cliente neste filtro.'}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((c) => (
            <li key={c.id}>
              <Link href={`/app/clientes/${c.id}`} className="block rounded-2xl border border-white/10 bg-slate-900/70 p-4 transition-colors hover:border-white/25">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{c.name}</p>
                    {c.phone ? <p className="text-base text-slate-400">{formatPhone(c.phone)}</p> : null}
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                </div>
                {c.owes > 0 ? (
                  <div className="tabular mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base">
                    <span className="text-slate-300">
                      Deve: <strong className="text-amber-300">{formatBRL(c.owes)}</strong>
                    </span>
                    {c.overdue > 0 ? (
                      <span className="text-slate-300">
                        Atrasado: <strong className="text-rose-300">{formatBRL(c.overdue)}</strong>
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-base text-slate-500">Nada em aberto</p>
                )}
                <span className="mt-3 inline-block text-sm font-semibold text-emerald-300">Ver cliente</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
