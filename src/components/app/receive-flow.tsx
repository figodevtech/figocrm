'use client';
// Receber pagamento: Quem pagou? → Qual dívida? → Quanto? → Forma → Salvar.
// Uma dívida só é escolhida sozinha quando o cliente tem exatamente uma; com mais de uma, o usuário escolhe.
// Pagamento parcial é normal: a parcela fica "pago em parte" com o que falta.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { receivePaymentAction, undoSettlementAction } from '@/app/actions/payments';
import type { CustomerOption, DebtView } from '@/lib/domain/app-data';
import { PAYMENT_METHOD_OPTIONS } from '@/lib/domain/views';
import { formatBRL, formatShortDate, moneyInputValue, parseMoneyInput } from '@/lib/format';
import { toCents } from '@/lib/finance/money';
import type { PaymentMethod } from '@/types/domain';
import { CustomerPicker } from '@/components/app/pickers';
import { WizardStep } from '@/components/app/wizard';
import { Alert, Card, EmptyState, Row } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { Choice, MoneyField } from '@/components/ui/form';

const OLDEST = 'oldest';

export function ReceiveFlow({
  customers,
  customer,
  debts,
  initialDebtId,
  today,
}: {
  customers: CustomerOption[];
  customer: { id: string; name: string } | null;
  debts: DebtView[];
  initialDebtId?: string;
  today: string;
}) {
  const router = useRouter();
  const preselected = debts.find((d) => d.receivableId === initialDebtId) ?? (debts.length === 1 ? debts[0] : null);
  const [debt, setDebt] = useState<DebtView | null>(preselected);
  const [target, setTarget] = useState<string>(preselected?.nextInstallment?.id ?? OLDEST);
  const [amount, setAmount] = useState(moneyInputValue(preselected?.nextInstallment?.balance ?? undefined));
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ settlementId: string; message: string } | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!customer) {
    const owing = customers.filter((c) => c.owes > 0);
    if (owing.length === 0) {
      return (
        <EmptyState title="Ninguém está devendo." text="Quando você vender parcelado ou emprestar, as dívidas aparecem aqui.">
          <ButtonLink href="/app">Voltar ao início</ButtonLink>
        </EmptyState>
      );
    }
    return (
      <WizardStep step={1} total={3} title="Quem pagou?">
        <CustomerPicker customers={owing} selectedId={null} allowCreate={false} onSelect={(c) => router.push(`/app/receber?cliente=${c.id}`)} />
      </WizardStep>
    );
  }

  if (result) {
    return (
      <section className="space-y-5" aria-live="polite">
        <Alert tone={undone ? 'info' : 'success'}>{undone ?? result.message}</Alert>
        {!undone ? (
          <Button
            variant="secondary"
            className="w-full"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await undoSettlementAction(result.settlementId);
                setUndone(res.message);
                router.refresh();
              })
            }
          >
            <RotateCcw className="h-5 w-5" aria-hidden /> Desfazer
          </Button>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <ButtonLink href="/app" size="lg">
            Início
          </ButtonLink>
          <ButtonLink href={`/app/clientes/${customer.id}`} variant="secondary" size="lg">
            Ver cliente
          </ButtonLink>
          <ButtonLink href="/app/receber" variant="secondary" size="lg">
            Receber outro
          </ButtonLink>
        </div>
      </section>
    );
  }

  if (debts.length === 0) {
    return (
      <EmptyState title={`${customer.name} não tem dívida em aberto.`}>
        <ButtonLink href="/app/receber" variant="secondary">
          Escolher outro cliente
        </ButtonLink>
      </EmptyState>
    );
  }

  if (!debt) {
    return (
      <WizardStep step={2} total={3} title={`${customer.name} possui:`} onBack={() => router.push('/app/receber')}>
        <p className="text-base text-slate-400">Qual dívida ele está pagando?</p>
        <ul className="space-y-2">
          {debts.map((d) => (
            <li key={d.receivableId}>
              <button
                type="button"
                onClick={() => {
                  setDebt(d);
                  setTarget(d.nextInstallment?.id ?? OLDEST);
                  setAmount(moneyInputValue(d.nextInstallment?.balance ?? undefined));
                }}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/3 px-4 py-3 text-left hover:bg-white/6"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold text-white">{d.label}</span>
                  {d.overdue > 0 ? <span className="block text-sm text-rose-300">atrasado {formatBRL(d.overdue)}</span> : null}
                </span>
                <span className="tabular shrink-0 text-lg font-semibold text-amber-300">{formatBRL(d.balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      </WizardStep>
    );
  }

  const open = debt.installments.filter((i) => i.open);
  const chosen = open.find((i) => i.id === target) ?? null;
  const value = parseMoneyInput(amount);
  const cents = value === null ? 0 : toCents(value);
  const limitCents = toCents(chosen ? chosen.balance : debt.balance);
  const problem =
    cents <= 0
      ? 'Informe o valor recebido.'
      : cents > limitCents
        ? chosen
          ? `Passa do que falta na parcela ${chosen.number} (${formatBRL(chosen.balance)}). Para pagar mais de uma, escolha “abater das mais antigas”.`
          : `Passa do que ele deve nessa dívida (${formatBRL(debt.balance)}).`
        : null;
  const leftAfter = (limitCents - cents) / 100;

  const save = () => {
    if (problem) return;
    setError(null);
    startTransition(async () => {
      const res = await receivePaymentAction({ receivableId: debt.receivableId, installmentId: chosen?.id, amount: cents / 100, paymentMethod: method });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ settlementId: res.settlementId, message: res.message });
      router.refresh();
    });
  };

  return (
    <WizardStep
      step={3}
      total={3}
      title="Quanto ele pagou?"
      onBack={debts.length > 1 ? () => setDebt(null) : () => router.push('/app/receber')}
      onNext={save}
      nextLabel="Salvar pagamento"
      nextDisabled={!!problem}
      loading={pending}
    >
      <Card>
        <Row label="Cliente" value={customer.name} />
        <Row label="Dívida" value={debt.label} />
        <Row label="Falta no total" value={formatBRL(debt.balance)} tone="amber" />
      </Card>

      <Choice
        label="Qual parcela?"
        value={target}
        onChange={(v) => {
          setTarget(v);
          const inst = open.find((i) => i.id === v);
          if (inst) setAmount(moneyInputValue(inst.balance));
        }}
        columns={1}
        options={[
          ...open.slice(0, 6).map((i) => ({
            value: i.id,
            label: `Parcela ${i.number} — ${formatBRL(i.balance)}`,
            description: `${i.dueDate < today ? 'Atrasada desde' : 'Vence'} ${formatShortDate(i.dueDate)}${i.paidValue > 0 ? ` · já pagou ${formatBRL(i.paidValue)}` : ''}`,
          })),
          { value: OLDEST, label: 'Abater das mais antigas', description: 'Para pagamento que cobre mais de uma parcela' },
        ]}
      />

      <MoneyField label="Valor recebido" required value={amount} onChange={setAmount} />
      {!problem && cents > 0 ? (
        <p className="tabular text-base text-slate-300" role="status">
          {leftAfter > 0
            ? chosen
              ? `Parcela ${chosen.number}: recebido ${formatBRL(cents / 100)}, falta ${formatBRL(leftAfter)}.`
              : `Depois deste pagamento falta ${formatBRL(leftAfter)}.`
            : chosen
              ? `Quita a parcela ${chosen.number}.`
              : 'Quita a dívida.'}
        </p>
      ) : null}
      {problem && cents > 0 ? <p className="text-base text-rose-300">{problem}</p> : null}

      <Choice label="Forma" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} columns={4} />
      {error ? <Alert>{error}</Alert> : null}
    </WizardStep>
  );
}
