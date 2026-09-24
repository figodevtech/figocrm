'use client';
// Avulsos criados pela voz: vincular a um cadastro existente ou transformar em cadastro.
// Vincular não muda valores: só passa negócios, dívidas e pagamentos para o cadastro escolhido.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, UserCheck } from 'lucide-react';
import { linkProvisionalCustomerAction } from '@/app/actions/customers';
import { confirmProvisionalItemAction, linkProvisionalItemAction, resolveItemCostAction } from '@/app/actions/items';
import type { CustomerOption, ItemOption } from '@/lib/domain/app-data';
import { formatBRL, parseMoneyInput } from '@/lib/format';
import { CustomerPicker, ItemPicker } from '@/components/app/pickers';
import { Alert } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { MoneyField, TextField } from '@/components/ui/form';

function Frame({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mb-5 space-y-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
      <div>
        <p className="text-lg font-semibold text-amber-100">{title}</p>
        <p className="text-base text-amber-100/80">{text}</p>
      </div>
      {children}
    </section>
  );
}

export function ProvisionalCustomerPanel({ customer, candidates, summary }: { customer: { id: string; name: string }; candidates: CustomerOption[]; summary: { deals: number; receivable: number; loans: number } }) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [target, setTarget] = useState<CustomerOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const others = candidates.filter((c) => c.id !== customer.id);

  const link = () =>
    target &&
    startTransition(async () => {
      setError(null);
      const res = await linkProvisionalCustomerAction(customer.id, target.id);
      if (!res.ok) return setError(res.error);
      router.push(`/app/clientes/${res.targetId}`);
      router.refresh();
    });

  return (
    <Frame title="Cliente avulso" text="Entrou pela voz sem cadastro. Vincule a um cliente que já existe ou transforme em cadastro.">
      {!linking ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setLinking(true)} disabled={others.length === 0}>
            <Link2 className="h-5 w-5" aria-hidden /> Vincular a um cliente
          </Button>
          <ButtonLink href={`/app/clientes/${customer.id}/editar?confirmar=1`} variant="secondary">
            <UserCheck className="h-5 w-5" aria-hidden /> Transformar em cliente
          </ButtonLink>
        </div>
      ) : target ? (
        <div className="space-y-3">
          <p className="text-base text-white">
            Passar tudo de <strong>{customer.name}</strong> para <strong>{target.name}</strong>? O avulso deixa de existir.
          </p>
          <p className="text-sm text-amber-100">Este cliente possui {summary.deals} {summary.deals === 1 ? 'negócio' : 'negócios'}, {formatBRL(summary.receivable)} a receber e {summary.loans} {summary.loans === 1 ? 'empréstimo' : 'empréstimos'}.</p>
          {error ? <Alert>{error}</Alert> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Voltar
            </Button>
            <Button onClick={link} loading={pending}>
              Vincular
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <CustomerPicker customers={others} selectedId={null} allowCreate={false} onSelect={setTarget} emptyText="Nenhum outro cliente cadastrado." />
          <Button variant="ghost" className="w-full" onClick={() => setLinking(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </Frame>
  );
}

export function ProvisionalItemPanel({ item, stock }: { item: { id: string; name: string }; stock: ItemOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<'menu' | 'link' | 'confirm'>('menu');
  const [target, setTarget] = useState<ItemOption | null>(null);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const link = () =>
    target &&
    startTransition(async () => {
      setError(null);
      const res = await linkProvisionalItemAction(item.id, target.id);
      if (!res.ok) return setError(res.error);
      router.push(`/app/estoque/${res.targetId}`);
      router.refresh();
    });

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const res = await confirmProvisionalItemAction(item.id, name);
      if (!res.ok) return setError(res.error);
      setMode('menu');
      router.refresh();
    });

  return (
    <Frame title="Mercadoria avulsa" text="Vendida sem estar no estoque. Se ela estava cadastrada com outro nome, vincule; senão, confirme o cadastro.">
      {mode === 'menu' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setMode('link')} disabled={stock.length === 0}>
            <Link2 className="h-5 w-5" aria-hidden /> É uma do estoque
          </Button>
          <Button variant="secondary" onClick={() => setMode('confirm')}>
            <UserCheck className="h-5 w-5" aria-hidden /> Confirmar mercadoria
          </Button>
        </div>
      ) : mode === 'link' ? (
        target ? (
          <div className="space-y-3">
            <p className="text-base text-white">
              A venda passa a ser de <strong>{target.name}</strong> (custo {formatBRL(target.totalCost)}) e o lucro é recalculado.
            </p>
            {error ? <Alert>{error}</Alert> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setTarget(null)}>
                Voltar
              </Button>
              <Button onClick={link} loading={pending}>
                Vincular
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ItemPicker items={stock} selectedId={null} allowCreate={false} onSelect={setTarget} />
            <Button variant="ghost" className="w-full" onClick={() => setMode('menu')}>
              Cancelar
            </Button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <TextField label="Nome da mercadoria" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          {error ? <Alert>{error}</Alert> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setMode('menu')}>
              Cancelar
            </Button>
            <Button onClick={confirm} loading={pending} disabled={!name.trim()}>
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </Frame>
  );
}

/** Custo que faltou numa venda: "quanto você pagou nela?" → o lucro passa a contar. */
export function CostPendingPanel({ itemId, name }: { itemId: string; name: string }) {
  const router = useRouter();
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const value = parseMoneyInput(cost);
      if (value === null) return setError('Informe quanto você pagou.');
      setError(null);
      const res = await resolveItemCostAction(itemId, value);
      if (!res.ok) return setError(res.error);
      setDone(res.profit !== undefined ? `Custo salvo. Lucro da venda: ${formatBRL(res.profit)}.` : 'Custo salvo.');
      router.refresh();
    });

  if (done) return <Alert tone="success">{done}</Alert>;
  return (
    <Frame title="Falta o custo" text={`Quanto você pagou nessa mercadoria (${name})? Sem isso o lucro da venda não entra no "Ganhei este mês".`}>
      <MoneyField label="Valor de compra" value={cost} onChange={setCost} />
      {error ? <Alert>{error}</Alert> : null}
      <Button className="w-full" onClick={save} loading={pending} disabled={!cost.trim()}>
        Salvar custo
      </Button>
    </Frame>
  );
}
