'use client';
// Nova venda manual. Monta a entrada de createSaleAction, que vira o MESMO DealCommand da voz
// (DealCommand → executor → balanço → RPC atômica). Nada de regra financeira nova aqui.
import { useState } from 'react';
import { createSaleAction } from '@/app/actions/deals';
import type { CustomerOption, ItemOption } from '@/lib/domain/app-data';
import { PAYMENT_METHOD_OPTIONS } from '@/lib/domain/views';
import { checkInstallmentPlan, saleRemaining } from '@/lib/domain/manual-plan';
import { formatBRL, moneyInputValue, parseMoneyInput } from '@/lib/format';
import { toCents } from '@/lib/finance/money';
import type { PaymentMethod } from '@/types/domain';
import { CustomerPicker, ItemPicker } from '@/components/app/pickers';
import { DoneScreen, InstallmentPlanner, newInstallmentDraft, WizardStep, describeSchedule } from '@/components/app/wizard';
import { Alert, Card, Row } from '@/components/ui/layout';
import { Choice, MoneyField, TextField } from '@/components/ui/form';

const TOTAL_STEPS = 5;

export function SaleWizard({
  customers,
  items,
  today,
  initialCustomerId,
  initialItemId,
}: {
  customers: CustomerOption[];
  items: ItemOption[];
  today: string;
  initialCustomerId?: string;
  initialItemId?: string;
}) {
  const initialCustomer = customers.find((c) => c.id === initialCustomerId) ?? null;
  const initialItem = items.find((i) => i.id === initialItemId) ?? null;
  const [step, setStep] = useState(initialCustomer ? (initialItem ? 3 : 2) : 1);
  const [customer, setCustomer] = useState<CustomerOption | null>(initialCustomer);
  const [item, setItem] = useState<ItemOption | null>(initialItem);
  const [total, setTotal] = useState(moneyInputValue(initialItem?.targetSalePrice ?? undefined));

  const [useCash, setUseCash] = useState(false);
  const [cash, setCash] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [useDebt, setUseDebt] = useState(false);
  const [plan, setPlan] = useState(newInstallmentDraft(today));
  const [useItemIn, setUseItemIn] = useState(false);
  const [itemInName, setItemInName] = useState('');
  const [itemInValue, setItemInValue] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const totalCents = toCents(parseMoneyInput(total) ?? 0);
  const cashCents = useCash ? toCents(parseMoneyInput(cash) ?? 0) : 0;
  const itemInCents = useItemIn ? toCents(parseMoneyInput(itemInValue) ?? 0) : 0;
  const remaining = saleRemaining(totalCents, cashCents, itemInCents);
  const planCount = Number(plan.count) || null;
  const planValue = parseMoneyInput(plan.value);
  const planCheck = checkInstallmentPlan(remaining, planCount, planValue === null ? null : toCents(planValue));

  const paymentProblem = ((): string | null => {
    if (!useCash && !useDebt && !useItemIn) return 'Escolha como ele pagou.';
    if (useCash && cashCents <= 0) return 'Informe quanto ele pagou em dinheiro/Pix.';
    if (useItemIn && (!itemInName.trim() || itemInCents <= 0)) return 'Informe a mercadoria recebida e o valor dela.';
    if (remaining < 0) return `Os pagamentos passam do valor da venda em ${formatBRL(-remaining / 100)}.`;
    if (!useDebt && remaining > 0) return `Ainda faltam ${formatBRL(remaining / 100)}. Marque “Ficou devendo” ou ajuste os valores.`;
    if (useDebt && remaining === 0) return 'Não sobrou nada para ficar devendo. Desmarque “Ficou devendo”.';
    if (useDebt && !planCheck.ok) return planCheck.message;
    if (useDebt && !plan.firstDueDate) return 'Informe o primeiro vencimento.';
    return null;
  })();

  const save = async () => {
    if (!customer || !item || paymentProblem) return;
    setSaving(true);
    setError(null);
    const res = await createSaleAction({
      customerId: customer.id,
      itemId: item.isNew ? undefined : item.id,
      newItem: item.isNew ? { name: item.name, acquisitionCost: item.knownCost } : undefined,
      totalValue: totalCents / 100,
      paymentMethod: method,
      cashInflow: cashCents > 0 ? cashCents / 100 : undefined,
      itemIn: useItemIn ? { name: itemInName.trim(), evaluatedValue: itemInCents / 100 } : undefined,
      receivable: useDebt
        ? { totalAmount: remaining / 100, installmentsCount: planCount!, installmentValue: planValue!, firstDueDate: plan.firstDueDate, intervalDays: 30 }
        : undefined,
      idempotencyKey,
    });
    setSaving(false);
    if (res.error || !res.dealId) {
      setError(res.error ?? 'Não consegui salvar a venda. Nada foi gravado.');
      return;
    }
    setDone(true);
  };

  if (done && customer && item) {
    const lines = [`${item.name} para ${customer.name} por ${formatBRL(totalCents / 100)}.`];
    if (cashCents > 0) lines.push(`Recebido agora: ${formatBRL(cashCents / 100)}.`);
    if (itemInCents > 0) lines.push(`${itemInName} entrou no estoque por ${formatBRL(itemInCents / 100)}.`);
    if (useDebt) lines.push(`A receber: ${describeSchedule(planCount!, toCents(planValue!), plan.firstDueDate)}.`);
    if (item.isNew && item.knownCost === undefined) lines.push('Custo não informado: o lucro entra quando você informar na tela da mercadoria.');
    return (
      <DoneScreen
        title="Venda registrada"
        lines={lines}
        actions={[
          { href: '/app', label: 'Início', primary: true },
          { href: `/app/clientes/${customer.id}`, label: 'Ver cliente' },
          { href: '/app/vendas/nova', label: 'Nova venda' },
        ]}
      />
    );
  }

  if (step === 1) {
    return (
      <WizardStep step={1} total={TOTAL_STEPS} title="Para quem você vendeu?" onNext={() => setStep(2)} nextDisabled={!customer}>
        <CustomerPicker customers={customers} selectedId={customer?.id ?? null} onSelect={(c) => { setCustomer(c); setStep(2); }} />
      </WizardStep>
    );
  }

  if (step === 2) {
    return (
      <WizardStep step={2} total={TOTAL_STEPS} title="O que você vendeu?" onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!item}>
        <ItemPicker
          items={items}
          allowUnstocked
          selectedId={item?.id ?? null}
          onSelect={(i) => {
            setItem(i);
            if (!total && i.targetSalePrice) setTotal(moneyInputValue(i.targetSalePrice));
            setStep(3);
          }}
        />
      </WizardStep>
    );
  }

  if (step === 3) {
    return (
      <WizardStep step={3} total={TOTAL_STEPS} title="Valor da venda" onBack={() => setStep(2)} onNext={() => setStep(4)} nextDisabled={totalCents <= 0}>
        <MoneyField label={`Por quanto vendeu ${item?.name ?? ''}?`} required value={total} onChange={setTotal} autoFocus />
        {item ? (
          <p className="tabular text-base text-slate-400">
            {item.isNew && item.knownCost === undefined ? (
              'Custo não informado: o lucro fica pendente.'
            ) : (
              <>
                Custo da mercadoria: {formatBRL(item.totalCost)}
                {totalCents > 0 ? ` · lucro previsto ${formatBRL(totalCents / 100 - item.totalCost)}` : ''}
              </>
            )}
          </p>
        ) : null}
      </WizardStep>
    );
  }

  if (step === 4) {
    return (
      <WizardStep step={4} total={TOTAL_STEPS} title="Como ele pagou?" onBack={() => setStep(3)} onNext={() => setStep(5)} nextDisabled={!!paymentProblem}>
        <p className="text-base text-slate-400">Pode marcar mais de um.</p>
        <div className="grid gap-2">
          <Toggle checked={useCash} onChange={setUseCash} label="Dinheiro / Pix" />
          {useCash ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/3 p-4">
              <MoneyField label="Quanto ele pagou agora" value={cash} onChange={setCash} autoFocus />
              <Choice label="Forma" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} columns={4} />
            </div>
          ) : null}
          <Toggle checked={useItemIn} onChange={setUseItemIn} label="Deu uma mercadoria" />
          {useItemIn ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/3 p-4">
              <TextField label="O que ele deu" value={itemInName} onChange={(e) => setItemInName(e.target.value)} placeholder="Moto Bros 2019" autoComplete="off" />
              <MoneyField label="Valor negociado" value={itemInValue} onChange={setItemInValue} hint="Entra no seu estoque por esse valor" />
            </div>
          ) : null}
          <Toggle checked={useDebt} onChange={setUseDebt} label="Ficou devendo" />
          {useDebt && remaining > 0 ? <InstallmentPlanner remainingCents={remaining} draft={plan} onChange={setPlan} today={today} /> : null}
        </div>
        <Card>
          <Row label="Venda" value={formatBRL(totalCents / 100)} />
          {useCash ? <Row label="Recebido agora" value={`− ${formatBRL(cashCents / 100)}`} /> : null}
          {useItemIn ? <Row label="Mercadoria recebida" value={`− ${formatBRL(itemInCents / 100)}`} /> : null}
          <Row label={useDebt ? 'Fica devendo' : 'Falta definir'} value={formatBRL(Math.max(remaining, 0) / 100)} strong tone={remaining === 0 || useDebt ? 'amber' : 'rose'} />
        </Card>
        {paymentProblem ? <p className="text-base text-rose-300">{paymentProblem}</p> : null}
      </WizardStep>
    );
  }

  return (
    <WizardStep step={5} total={TOTAL_STEPS} title="Confere e salva" onBack={() => setStep(4)} onNext={save} nextLabel="Salvar venda" loading={saving} nextDisabled={!!paymentProblem}>
      <Card>
        <Row label="Cliente" value={customer?.name} />
        <Row label="Mercadoria" value={item?.name} />
        <Row label="Valor" value={formatBRL(totalCents / 100)} strong />
        {cashCents > 0 ? <Row label={`Recebido (${PAYMENT_METHOD_OPTIONS.find((m) => m.value === method)?.label})`} value={formatBRL(cashCents / 100)} tone="emerald" /> : null}
        {itemInCents > 0 ? <Row label={`Recebeu: ${itemInName}`} value={formatBRL(itemInCents / 100)} /> : null}
        {useDebt ? <Row label="A receber" value={describeSchedule(planCount!, toCents(planValue!), plan.firstDueDate)} tone="amber" /> : null}
      </Card>
      {error ? <Alert>{error}</Alert> : null}
    </WizardStep>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 text-left text-lg font-semibold transition-colors ${
        checked ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-white/10 bg-white/3 text-slate-200 hover:bg-white/6'
      }`}
    >
      <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md border-2 ${checked ? 'border-emerald-400 bg-emerald-400 text-emerald-950' : 'border-slate-500'}`}>
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}
