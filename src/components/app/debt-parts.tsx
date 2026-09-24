// Peças de leitura de dívidas e histórico (Server Components, sem estado).
import Link from 'next/link';
import type { DebtView, InstallmentView } from '@/lib/domain/app-data';
import { timelineDayLabel, toLocalDate, type TimelineEvent } from '@/lib/domain/views';
import { formatBRL, formatShortDate } from '@/lib/format';
import { Badge } from '@/components/ui/layout';
import { todayISO } from '@/lib/domain/loan-plan';

const stateTone = {
  paid: 'emerald',
  partial: 'amber',
  overdue: 'rose',
  pending: 'neutral',
  renegotiated: 'violet',
  canceled: 'neutral',
} as const;

export function InstallmentRow({ inst }: { inst: InstallmentView }) {
  const faded = inst.state === 'renegotiated' || inst.state === 'canceled';
  const detail =
    inst.state === 'paid'
      ? 'Pago'
      : inst.state === 'renegotiated'
        ? 'Renegociada'
        : inst.state === 'partial' || inst.paidValue + inst.adjustedValue > 0
          ? `Falta ${formatBRL(inst.balance)} · vence ${formatShortDate(inst.dueDate)}`
          : `Vence ${formatShortDate(inst.dueDate)}`;
  return (
    <li className={`flex items-center justify-between gap-3 py-2.5 ${faded ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="tabular text-base text-white">
          <span className="text-slate-400">{inst.number}.</span> {formatBRL(inst.originalValue)}
        </p>
        <p className="text-sm text-slate-400">{detail}</p>
      </div>
      <Badge tone={stateTone[inst.state]}>{inst.stateLabel}</Badge>
    </li>
  );
}

export function DebtCard({ debt, customerId }: { debt: DebtView; customerId: string }) {
  const next = debt.nextInstallment;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{debt.label}</p>
          <p className="tabular text-base text-slate-400">
            Falta <strong className="text-amber-300">{formatBRL(debt.balance)}</strong> de {formatBRL(debt.totalAmount)}
          </p>
        </div>
        {debt.overdue > 0 ? <Badge tone="rose">Atrasado {formatBRL(debt.overdue)}</Badge> : <Badge tone="emerald">Em dia</Badge>}
      </div>
      {next ? (
        <p className="tabular mt-2 text-base text-slate-300">
          Próxima: {formatShortDate(next.dueDate)} — {formatBRL(next.balance)}
        </p>
      ) : null}

      <details className="group mt-3">
        <summary className="min-h-11 cursor-pointer list-none rounded-xl py-2 text-base font-semibold text-emerald-300 [&::-webkit-details-marker]:hidden">
          Ver parcelas ({debt.installments.length})
        </summary>
        <ul className="divide-y divide-white/5">
          {debt.installments.map((i) => (
            <InstallmentRow key={i.id} inst={i} />
          ))}
        </ul>
      </details>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href={`/app/receber?cliente=${customerId}&divida=${debt.receivableId}`}
          className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-emerald-500 px-4 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          Receber
        </Link>
        {debt.loanContractId ? (
          <Link
            href={`/app/emprestimos/${debt.loanContractId}`}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/6 px-4 text-base font-semibold text-slate-100 hover:bg-white/10"
          >
            Ver empréstimo
          </Link>
        ) : (
          <Link
            href={`/app/negocios`}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/6 px-4 text-base font-semibold text-slate-100 hover:bg-white/10"
          >
            Ver negócios
          </Link>
        )}
      </div>
    </div>
  );
}

const kindTone: Record<TimelineEvent['kind'], string> = {
  sale: 'bg-emerald-400',
  trade: 'bg-cyan-400',
  purchase: 'bg-violet-400',
  loan: 'bg-rose-400',
  payment: 'bg-emerald-400',
  adjustment: 'bg-amber-400',
  reversal: 'bg-slate-400',
  renegotiation: 'bg-violet-400',
  deal: 'bg-slate-400',
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-base text-slate-400">Nada registrado ainda.</p>;
  const today = todayISO();
  const groups: Array<{ label: string; items: TimelineEvent[] }> = [];
  for (const e of events) {
    const label = timelineDayLabel(toLocalDate(e.at), today);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <ol className="space-y-5">
      {groups.map((g) => (
        <li key={g.label}>
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">{g.label}</p>
          <ul className="space-y-2">
            {g.items.map((e) => (
              <li key={e.id} className="flex items-start gap-3 rounded-xl bg-white/3 px-3 py-3">
                <span aria-hidden className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${kindTone[e.kind]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-base text-white">{e.title}</p>
                  {e.detail ? <p className="truncate text-sm text-slate-400">{e.detail}</p> : null}
                </div>
                <p className={`tabular shrink-0 text-base font-semibold ${e.direction === 'in' ? 'text-emerald-300' : e.direction === 'out' ? 'text-rose-300' : 'text-slate-200'}`}>
                  {e.direction === 'in' ? '+ ' : e.direction === 'out' ? '− ' : ''}
                  {formatBRL(e.amount)}
                </p>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
