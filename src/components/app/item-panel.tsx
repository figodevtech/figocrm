'use client';
// Custos agregados e status da mercadoria (tela de detalhe). Custo total = compra + custos (motor de CMV).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { addItemCostFormAction, removeItemCostAction, setItemStatusAction } from '@/app/actions/items';
import { COST_CATEGORIES, costCategoryLabel } from '@/lib/domain/views';
import { formatBRL, parseMoneyInput } from '@/lib/format';
import { Alert, Card, Row } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Choice, MoneyField, SelectField, TextField } from '@/components/ui/form';

interface Cost {
  id: string;
  category: string;
  description: string;
  amount: number;
}

export function ItemCostsPanel({ itemId, acquisitionCost, costs, editable }: { itemId: string; acquisitionCost: number; costs: Cost[]; editable: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState('reparo');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = acquisitionCost + costs.reduce((acc, c) => acc + c.amount, 0);

  const add = () => {
    const value = parseMoneyInput(amount);
    if (value === null || value <= 0) {
      setError('Informe o valor do custo.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addItemCostFormAction(itemId, { category, description, amount: value });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdding(false);
      setAmount('');
      setDescription('');
      router.refresh();
    });
  };

  const remove = (costId: string) =>
    startTransition(async () => {
      const res = await removeItemCostAction(costId);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <Card>
      <Row label="Compra" value={formatBRL(acquisitionCost)} />
      {costs.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <div className="flex-1">
            <Row label={c.description && c.description !== costCategoryLabel(c.category) ? `${costCategoryLabel(c.category)} · ${c.description}` : costCategoryLabel(c.category)} value={formatBRL(c.amount)} />
          </div>
          {editable ? (
            <button
              type="button"
              onClick={() => remove(c.id)}
              disabled={pending}
              aria-label={`Remover custo ${costCategoryLabel(c.category)} de ${formatBRL(c.amount)}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-white/5 hover:text-rose-300"
            >
              <Trash2 className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
      <div className="mt-1 border-t border-white/10 pt-1">
        <Row label="Custo total" value={formatBRL(total)} strong tone="sky" />
      </div>

      {editable ? (
        adding ? (
          <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
            <SelectField label="Tipo de custo" value={category} onChange={(e) => setCategory(e.target.value)} options={COST_CATEGORIES} />
            <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} hint="Opcional (ex.: troca de tela)" autoComplete="off" />
            <MoneyField label="Valor" required value={amount} onChange={setAmount} autoFocus />
            {error ? <Alert>{error}</Alert> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancelar
              </Button>
              <Button onClick={add} loading={pending}>
                Adicionar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error ? <div className="mt-3"><Alert>{error}</Alert></div> : null}
            <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>
              <Plus className="h-5 w-5" aria-hidden /> Adicionar custo
            </Button>
          </>
        )
      ) : null}
    </Card>
  );
}

export function ItemStatusToggle({ itemId, status }: { itemId: string; status: 'disponivel' | 'reservado' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Choice
        label="Situação"
        value={status}
        onChange={(next) => {
          if (next === status) return;
          startTransition(async () => {
            const res = await setItemStatusAction(itemId, next);
            if (!res.ok) setError(res.error);
            else router.refresh();
          });
        }}
        options={[
          { value: 'disponivel', label: 'Disponível' },
          { value: 'reservado', label: 'Reservado' },
        ]}
      />
      {pending ? <p className="text-sm text-slate-400" role="status">Salvando…</p> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
