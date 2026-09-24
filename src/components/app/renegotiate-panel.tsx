'use client';
// Renegociar: junta parcelas em aberto (todas ou só as atrasadas) numa nova grade.
// As antigas ficam no histórico como "renegociada"; a nova grade fecha com o saldo (conferido no banco).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renegotiateDebtAction } from '@/app/actions/payments';
import { addDaysISO, formatBRL } from '@/lib/format';
import { toCents } from '@/lib/finance/money';
import { Alert, Card, Row } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Choice, TextField } from '@/components/ui/form';

interface OpenInst {
  id: string;
  balance: number;
  dueDate: string;
}

export function RenegotiatePanel({ receivableId, open, today }: { receivableId: string; open: OpenInst[]; today: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const overdue = open.filter((i) => i.dueDate < today);
  const [scope, setScope] = useState<'all' | 'overdue'>(overdue.length > 0 ? 'overdue' : 'all');
  const [count, setCount] = useState('');
  const [firstDueDate, setFirstDueDate] = useState(addDaysISO(today, 30));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = scope === 'overdue' ? overdue : open;
  const totalCents = selected.reduce((acc, i) => acc + toCents(i.balance), 0);
  const n = Number(count) || 0;
  const base = n > 0 ? Math.floor(totalCents / n) : 0;
  const extra = n > 0 ? totalCents - base * n : 0;

  if (open.length === 0) return null;
  if (!expanded) {
    return (
      <Button variant="secondary" className="w-full" onClick={() => setExpanded(true)}>
        Renegociar
      </Button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await renegotiateDebtAction({ receivableId, installmentIds: selected.map((i) => i.id), newCount: n, firstDueDate });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(res.message);
      setExpanded(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/3 p-4">
      <p className="text-lg font-semibold text-white">Renegociar</p>
      {overdue.length > 0 && overdue.length < open.length ? (
        <Choice
          label="Quais parcelas juntar?"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'overdue', label: `Só as atrasadas (${overdue.length})` },
            { value: 'all', label: `Todas em aberto (${open.length})` },
          ]}
        />
      ) : null}
      <Card>
        <Row label="Saldo a renegociar" value={formatBRL(totalCents / 100)} strong tone="amber" />
        {n > 0 ? <Row label="Nova grade" value={extra === 0 ? `${n}x de ${formatBRL(base / 100)}` : `${n} parcelas (${formatBRL((base + 1) / 100)} a ${formatBRL(base / 100)})`} /> : null}
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Em quantas parcelas" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} autoComplete="off" />
        <TextField label="Primeiro vencimento" type="date" min={today} value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setExpanded(false)}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={pending} disabled={n < 1 || n > 120 || !firstDueDate}>
          Confirmar
        </Button>
      </div>
      {message ? <Alert tone="success">{message}</Alert> : null}
    </div>
  );
}
