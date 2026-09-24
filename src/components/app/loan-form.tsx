'use client';
// Novo empréstimo: a prévia usa a MESMA função de cálculo que grava (planLoan), e o banco confere de novo.
// Antes de salvar, confirmação manual com emprestado / juros / total / parcelas.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLoanAction } from '@/app/actions/loans';
import type { CustomerOption } from '@/lib/domain/app-data';
import { planLoan } from '@/lib/domain/loan-plan';
import { INTEREST_TYPE_LABELS, InterestType, uniformInstallment } from '@/lib/finance/loans';
import { PAYMENT_METHOD_OPTIONS } from '@/lib/domain/views';
import { addDaysISO, formatBRL, formatDate, parseMoneyInput, parsePercentInput } from '@/lib/format';
import type { PaymentMethod } from '@/types/domain';
import { CustomerPicker } from '@/components/app/pickers';
import { Alert, Card, Row, SectionTitle } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Choice, MoneyField, TextAreaField, TextField } from '@/components/ui/form';

export function LoanForm({ customers, today, initialCustomerId }: { customers: CustomerOption[]; today: string; initialCustomerId?: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(customers.find((c) => c.id === initialCustomerId) ?? null);
  const [pickCustomer, setPickCustomer] = useState(!customer);
  const [principal, setPrincipal] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [interestType, setInterestType] = useState<InterestType>('percent_total');
  const [rate, setRate] = useState('');
  const [fixed, setFixed] = useState('');
  const [count, setCount] = useState('');
  const [firstDueDate, setFirstDueDate] = useState(addDaysISO(today, 30));
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const principalValue = parseMoneyInput(principal);
  const countValue = Number(count) || 0;
  const rateValue = parsePercentInput(rate);
  const fixedValue = fixed.trim() ? parseMoneyInput(fixed) : 0;
  const ready = !!principalValue && countValue > 0 && (interestType === 'fixed_amount' ? fixedValue !== null : rateValue !== null);
  const plan = ready
    ? planLoan({
        principal: principalValue!,
        interestType,
        interestRate: interestType === 'fixed_amount' ? undefined : rateValue!,
        interestAmount: interestType === 'fixed_amount' ? fixedValue! : undefined,
        installmentsCount: countValue,
        startDate,
        firstDueDate,
      })
    : null;
  const each = plan?.ok ? uniformInstallment(plan.terms.installmentCents) : null;

  const save = async () => {
    if (!customer || !plan?.ok) return;
    setSaving(true);
    setError(null);
    const res = await createLoanAction({
      customerId: customer.id,
      principal: principalValue!,
      interestType,
      interestRate: interestType === 'fixed_amount' ? undefined : rateValue!,
      interestAmount: interestType === 'fixed_amount' ? fixedValue! : undefined,
      installmentsCount: countValue,
      startDate,
      firstDueDate,
      paymentMethod: method,
      notes,
      idempotencyKey,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      setConfirming(false);
      return;
    }
    router.push(`/app/emprestimos/${res.loanContractId}?novo=1`);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle>Cliente *</SectionTitle>
        {customer && !pickCustomer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/50 bg-emerald-500/10 px-4 py-3">
            <span className="text-lg font-semibold text-white">{customer.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setPickCustomer(true)}>
              Trocar
            </Button>
          </div>
        ) : (
          <CustomerPicker customers={customers} selectedId={customer?.id ?? null} onSelect={(c) => { setCustomer(c); setPickCustomer(false); }} />
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label="Valor emprestado" required value={principal} onChange={setPrincipal} />
        <TextField label="Data" type="date" required value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} />
      </div>

      <Choice
        label="Tipo de juros *"
        value={interestType}
        onChange={setInterestType}
        columns={3}
        options={(Object.keys(INTEREST_TYPE_LABELS) as InterestType[]).map((t) => ({ value: t, label: INTEREST_TYPE_LABELS[t] }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {interestType === 'fixed_amount' ? (
          <MoneyField label="Valor dos juros" required value={fixed} onChange={setFixed} hint="0 para sem juros" />
        ) : (
          <TextField
            label={interestType === 'percent_monthly' ? 'Taxa ao mês (%)' : 'Taxa sobre o valor (%)'}
            required
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="10"
            autoComplete="off"
            hint={interestType === 'percent_monthly' ? 'Juros simples: taxa × meses (parcelas)' : 'Aplicada uma vez sobre o valor emprestado'}
          />
        )}
        <TextField label="Quantidade de parcelas" required inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} autoComplete="off" />
      </div>
      <TextField
        label="Primeiro vencimento"
        type="date"
        required
        min={startDate}
        value={firstDueDate}
        onChange={(e) => setFirstDueDate(e.target.value)}
        hint={firstDueDate ? `Dia de vencimento: todo dia ${Number(firstDueDate.slice(8, 10))}` : undefined}
      />
      <Choice label="Como o dinheiro saiu" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} columns={4} />
      <TextAreaField label="Observação" value={notes} onChange={(e) => setNotes(e.target.value)} hint="Opcional" />

      <section aria-live="polite">
        <SectionTitle>Cálculo</SectionTitle>
        {plan?.ok ? (
          <Card>
            <Row label="Valor emprestado" value={formatBRL(plan.terms.principalCents / 100)} />
            <Row label="Juros" value={formatBRL(plan.terms.interestCents / 100)} tone="emerald" />
            <Row label="Total" value={formatBRL(plan.terms.totalCents / 100)} strong />
            <Row
              label={`${plan.terms.installmentsCount} ${plan.terms.installmentsCount === 1 ? 'parcela' : 'parcelas'} de`}
              value={each !== null ? formatBRL(each / 100) : `${formatBRL(plan.terms.installmentCents[0] / 100)} (1ª) …`}
              tone="amber"
            />
            <Row label="Vencimentos" value={`${formatDate(plan.schedule[0].dueDate)} a ${formatDate(plan.schedule[plan.schedule.length - 1].dueDate)}`} />
          </Card>
        ) : (
          <p className="text-base text-slate-400">{plan && !plan.ok ? plan.error : 'Preencha valor, juros e parcelas para ver o cálculo.'}</p>
        )}
      </section>

      {error ? <Alert>{error}</Alert> : null}

      {confirming && plan?.ok && customer ? (
        <div className="space-y-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4" role="alertdialog" aria-labelledby="confirm-loan">
          <p id="confirm-loan" className="text-lg font-semibold text-white">
            Confirmar empréstimo para {customer.name}?
          </p>
          <p className="text-base text-amber-100">
            Sai {formatBRL(plan.terms.principalCents / 100)} agora e volta {formatBRL(plan.terms.totalCents / 100)} em {plan.terms.installmentsCount}x.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Corrigir
            </Button>
            <Button onClick={save} loading={saving}>
              Confirmar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" className="w-full" disabled={!customer || !plan?.ok} onClick={() => setConfirming(true)}>
          Revisar e confirmar
        </Button>
      )}
    </div>
  );
}
