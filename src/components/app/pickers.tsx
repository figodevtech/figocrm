'use client';
// Seletores com busca para os fluxos (venda, troca, empréstimo, recebimento).
// Lista em cards grandes, sem tabela; cadastro rápido sem sair do fluxo.
import { useId, useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { saveCustomerAction } from '@/app/actions/customers';
import { createItemFormAction } from '@/app/actions/items';
import { formatBRL, formatPhone, matchesSearch, parseMoneyInput } from '@/lib/format';
import type { CustomerOption, ItemOption } from '@/lib/domain/app-data';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { MoneyField, TextField } from '@/components/ui/form';

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  const id = useId();
  return (
    <div className="relative">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="min-h-12 w-full rounded-xl border border-white/10 bg-slate-900/80 pl-12 pr-4 text-base text-white placeholder-slate-500 focus:border-emerald-400"
      />
    </div>
  );
}

const MAX_RESULTS = 8;

export function CustomerPicker({
  customers,
  selectedId,
  onSelect,
  allowCreate = true,
  emptyText = 'Nenhum cliente cadastrado ainda.',
}: {
  customers: CustomerOption[];
  selectedId: string | null;
  onSelect: (customer: CustomerOption) => void;
  allowCreate?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [extra, setExtra] = useState<CustomerOption[]>([]);
  const all = useMemo(() => [...extra, ...customers], [extra, customers]);
  const results = all.filter((c) => matchesSearch(query, c.name, c.phone)).slice(0, MAX_RESULTS);

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} label="Buscar cliente" placeholder="Buscar cliente" />
      {results.length > 0 ? (
        <ul className="space-y-2">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                aria-pressed={selectedId === c.id}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-2 text-left transition-colors ${
                  selectedId === c.id ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-white/3 hover:bg-white/6'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-white">{c.name}</span>
                  {c.phone ? <span className="block text-sm text-slate-400">{formatPhone(c.phone)}</span> : null}
                </span>
                {c.owes > 0 ? <span className="tabular shrink-0 text-sm text-amber-300">deve {formatBRL(c.owes)}</span> : null}
                {selectedId === c.id ? <Check className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-slate-400">{query ? `Nenhum cliente com “${query}”.` : emptyText}</p>
      )}

      {allowCreate ? (
        creating ? (
          <QuickCustomerForm
            initialName={query}
            onCancel={() => setCreating(false)}
            onCreated={(c) => {
              setExtra((prev) => [c, ...prev]);
              setCreating(false);
              setQuery('');
              onSelect(c);
            }}
            onUseExisting={(id) => {
              const existing = all.find((c) => c.id === id);
              if (existing) {
                setCreating(false);
                onSelect(existing);
              }
            }}
          />
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" aria-hidden /> Novo cliente
          </Button>
        )
      ) : null}
    </div>
  );
}

function QuickCustomerForm({
  initialName,
  onCreated,
  onCancel,
  onUseExisting,
}: {
  initialName: string;
  onCreated: (c: CustomerOption) => void;
  onCancel: () => void;
  onUseExisting: (id: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (allowDuplicate = false) => {
    setSaving(true);
    setError(null);
    const res = await saveCustomerAction({ name, phone }, { allowDuplicate });
    setSaving(false);
    if (res.ok) {
      onCreated({ id: res.customer.id, name: res.customer.name, phone: res.customer.phone, owes: 0 });
      return;
    }
    setError(res.error);
    setDuplicate(res.duplicate ?? null);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/3 p-4">
      <p className="text-base font-semibold text-white">Novo cliente</p>
      <TextField label="Nome" required value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
      <TextField label="Telefone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" placeholder="(83) 99999-9999" />
      {error ? (
        <Alert>
          {error}
          {duplicate ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onUseExisting(duplicate.id)}>
                Usar {duplicate.name}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => save(true)}>
                Criar outro mesmo assim
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={() => save(false)} loading={saving} disabled={!name.trim()}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

export function ItemPicker({
  items,
  selectedId,
  onSelect,
  allowCreate = true,
  allowUnstocked = false,
}: {
  items: ItemOption[];
  selectedId: string | null;
  onSelect: (item: ItemOption) => void;
  allowCreate?: boolean;
  /** Venda/troca: permite descrever uma mercadoria que não está no estoque (não cadastra antes). */
  allowUnstocked?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [extra, setExtra] = useState<ItemOption[]>([]);
  const all = useMemo(() => [...extra, ...items], [extra, items]);
  const results = all.filter((i) => matchesSearch(query, i.name, i.detail)).slice(0, MAX_RESULTS);

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} label="Buscar no estoque" placeholder="Buscar no estoque (nome, IMEI, placa)" />
      {results.length > 0 ? (
        <ul className="space-y-2">
          {results.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={selectedId === i.id}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-2 text-left transition-colors ${
                  selectedId === i.id ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-white/3 hover:bg-white/6'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-white">{i.name}</span>
                  {i.detail ? <span className="block truncate text-sm text-slate-400">{i.detail}</span> : null}
                </span>
                <span className="tabular shrink-0 text-right text-sm text-slate-400">
                  {i.isNew && i.knownCost === undefined ? 'custo depois' : `custo ${formatBRL(i.totalCost)}`}
                  {i.targetSalePrice ? <span className="block text-emerald-300">venda {formatBRL(i.targetSalePrice)}</span> : null}
                </span>
                {selectedId === i.id ? <Check className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-slate-400">{query ? `Nada disponível com “${query}”.` : 'Nenhuma mercadoria disponível no estoque.'}</p>
      )}

      {allowCreate ? (
        creating ? (
          <QuickItemForm
            unstocked={allowUnstocked}
            initialName={query}
            onCancel={() => setCreating(false)}
            onCreated={(item) => {
              setExtra((prev) => [item, ...prev]);
              setCreating(false);
              setQuery('');
              onSelect(item);
            }}
          />
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" aria-hidden /> {allowUnstocked ? 'Não está no estoque' : 'Cadastrar mercadoria'}
          </Button>
        )
      ) : null}
    </div>
  );
}

function QuickItemForm({ initialName, onCreated, onCancel, unstocked }: { initialName: string; onCreated: (i: ItemOption) => void; onCancel: () => void; unstocked?: boolean }) {
  const [name, setName] = useState(initialName);
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    // Fora do estoque: nada é gravado agora; a mercadoria nasce junto com o negócio (custo opcional)
    if (unstocked) {
      const known = cost.trim() ? parseMoneyInput(cost) : undefined;
      if (known === null) {
        setError('Valor inválido.');
        return;
      }
      onCreated({ id: `novo-${Date.now()}`, name: name.trim(), detail: 'Fora do estoque', totalCost: known ?? 0, targetSalePrice: null, isNew: true, knownCost: known });
      return;
    }
    const acquisitionCost = parseMoneyInput(cost);
    if (acquisitionCost === null) {
      setError('Informe quanto você pagou na mercadoria.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await createItemFormAction({ name, acquisitionCost });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated({ id: res.itemId, name: name.trim(), detail: '', totalCost: acquisitionCost, targetSalePrice: null });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/3 p-4">
      <p className="text-base font-semibold text-white">{unstocked ? 'Mercadoria fora do estoque' : 'Cadastrar mercadoria'}</p>
      <TextField label="Nome / descrição" required value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" placeholder="iPhone 13 128GB Preto" />
      <MoneyField
        label={unstocked ? 'Quanto você pagou nela' : 'Valor de compra'}
        required={!unstocked}
        value={cost}
        onChange={setCost}
        hint={unstocked ? 'Se não souber agora, deixe vazio: o lucro entra quando você informar' : undefined}
      />
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={save} loading={saving} disabled={!name.trim()}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
