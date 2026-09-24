'use client';
// Nova troca manual → createTradeAction → mesmo DealCommand da voz (itemOut, itemIn, cashIn/cashOut,
// dívida da volta). A mercadoria recebida entra no estoque pelo valor negociado (regra do domínio).
import { useState } from 'react';
import { createTradeAction } from '@/app/actions/deals';
import type { CustomerOption, ItemOption } from '@/lib/domain/app-data';
import { PAYMENT_METHOD_OPTIONS } from '@/lib/domain/views';
import { checkInstallmentPlan, tradeDifference, TradeDirection } from '@/lib/domain/manual-plan';
import { formatBRL, moneyInputValue, parseMoneyInput } from '@/lib/format';
import { toCents } from '@/lib/finance/money';
import type { PaymentMethod } from '@/types/domain';
import { CustomerPicker, ItemPicker } from '@/components/app/pickers';
import { DoneScreen, InstallmentPlanner, newInstallmentDraft, WizardStep, describeSchedule } from '@/components/app/wizard';
import { Alert, Card, Row } from '@/components/ui/layout';
import { Choice, MoneyField, TextField } from '@/components/ui/form';

const TOTAL_STEPS = 5;
const CATEGORY_OPTIONS = [
  { value: 'celular', label: 'Celular' },
  { value: 'moto', label: 'Moto' },
  { value: 'carro', label: 'Carro' },
  { value: 'outro', label: 'Outro' },
];

export function TradeWizard({ customers, items, today, initialCustomerId }: { customers: CustomerOption[]; items: ItemOption[]; today: string; initialCustomerId?: string }) {
  const initialCustomer = customers.find((c) => c.id === initialCustomerId) ?? null;
  const [step, setStep] = useState(initialCustomer ? 2 : 1);
  const [customer, setCustomer] = useState<CustomerOption | null>(initialCustomer);
  const [itemOut, setItemOut] = useState<ItemOption | null>(null);
  const [outValue, setOutValue] = useState('');
  const [inName, setInName] = useState('');
  const [inCategory, setInCategory] = useState('outro');
  const [inValue, setInValue] = useState('');
  const [who, setWho] = useState<TradeDirection | null>(null);
  const [now, setNow] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [plan, setPlan] = useState(newInstallmentDraft(today));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const outCents = toCents(parseMoneyInput(outValue) ?? 0);
  const inCents = toCents(parseMoneyInput(inValue) ?? 0);
  const diff = tradeDifference(outCents, inCents);
  const direction = who ?? diff.direction;
  const directionMismatch = who !== null && who !== diff.direction;
  const nowCents = Math.min(toCents(parseMoneyInput(now) ?? 0), diff.balanceCents);
  const rest = diff.balanceCents - nowCents;
  const planCount = Number(plan.count) || null;
  const planValue = parseMoneyInput(plan.value);
  const planCheck = checkInstallmentPlan(rest, planCount, planValue === null ? null : toCents(planValue));
  const settleProblem = directionMismatch
    ? diff.direction === 'even'
      ? 'Pelos valores não há diferença.'
      : diff.direction === 'received'
        ? 'Pelos valores, quem recebe a diferença é você.'
        : 'Pelos valores, quem paga a diferença é você.'
    : rest > 0 && !planCheck.ok
      ? planCheck.message
      : null;

  const save = async () => {
    if (!customer || !itemOut || settleProblem) return;
    setSaving(true);
    setError(null);
    const res = await createTradeAction({
      customerId: customer.id,
      itemOutId: itemOut.isNew ? undefined : itemOut.id,
      itemOutNew: itemOut.isNew ? { name: itemOut.name, acquisitionCost: itemOut.knownCost } : undefined,
      itemIn: { name: inName.trim(), evaluatedValue: inCents / 100, category: inCategory },
      tradeBalance: diff.balanceCents / 100,
      direction,
      immediateCash: nowCents > 0 ? nowCents / 100 : undefined,
      immediatePaymentMethod: method,
      installments: rest > 0 ? { count: planCount!, value: planValue!, firstDueDate: plan.firstDueDate } : undefined,
      idempotencyKey,
    });
    setSaving(false);
    if (res.error || !res.dealId) {
      setError(res.error ?? 'Não consegui salvar a troca. Nada foi gravado.');
      return;
    }
    setDone(true);
  };

  if (done && customer && itemOut) {
    const lines = [`Saiu ${itemOut.name} (${formatBRL(outCents / 100)}), entrou ${inName} (${formatBRL(inCents / 100)}).`, `${inName} já está no seu estoque.`];
    if (diff.balanceCents > 0) {
      lines.push(`${direction === 'received' ? 'Você recebe' : 'Você paga'} ${formatBRL(diff.balanceCents / 100)} de diferença${nowCents > 0 ? ` (${formatBRL(nowCents / 100)} agora)` : ''}.`);
    }
    if (rest > 0) lines.push(`Restante: ${describeSchedule(planCount!, toCents(planValue!), plan.firstDueDate)}.`);
    return (
      <DoneScreen
        title="Troca registrada"
        lines={lines}
        actions={[
          { href: '/app', label: 'Início', primary: true },
          { href: `/app/clientes/${customer.id}`, label: 'Ver cliente' },
          { href: '/app/estoque', label: 'Ver estoque' },
        ]}
      />
    );
  }

  if (step === 1) {
    return (
      <WizardStep step={1} total={TOTAL_STEPS} title="Com quem foi a troca?" onNext={() => setStep(2)} nextDisabled={!customer}>
        <CustomerPicker customers={customers} selectedId={customer?.id ?? null} onSelect={(c) => { setCustomer(c); setStep(2); }} />
      </WizardStep>
    );
  }

  if (step === 2) {
    return (
      <WizardStep step={2} total={TOTAL_STEPS} title="O que você entregou?" onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!itemOut || outCents <= 0}>
        <ItemPicker
          items={items}
          allowUnstocked
          selectedId={itemOut?.id ?? null}
          onSelect={(i) => {
            setItemOut(i);
            if (!outValue && i.targetSalePrice) setOutValue(moneyInputValue(i.targetSalePrice));
          }}
        />
        {itemOut ? <MoneyField label={`Valor negociado de ${itemOut.name}`} required value={outValue} onChange={setOutValue} /> : null}
      </WizardStep>
    );
  }

  if (step === 3) {
    return (
      <WizardStep step={3} total={TOTAL_STEPS} title="O que você recebeu?" onBack={() => setStep(2)} onNext={() => setStep(4)} nextDisabled={!inName.trim() || inCents <= 0}>
        <TextField label="Mercadoria recebida" required value={inName} onChange={(e) => setInName(e.target.value)} placeholder="Honda XRE 300 2021" autoComplete="off" autoFocus />
        <Choice label="Tipo" value={inCategory} onChange={setInCategory} options={CATEGORY_OPTIONS} columns={4} />
        <MoneyField label="Valor negociado" required value={inValue} onChange={setInValue} hint="Entra no seu estoque por esse valor" />
      </WizardStep>
    );
  }

  if (step === 4) {
    return (
      <WizardStep step={4} total={TOTAL_STEPS} title="Diferença" onBack={() => setStep(3)} onNext={() => setStep(5)} nextDisabled={!!settleProblem}>
        <Card>
          <Row label={`Entregou: ${itemOut?.name}`} value={formatBRL(outCents / 100)} />
          <Row label={`Recebeu: ${inName}`} value={formatBRL(inCents / 100)} />
          <Row label="Diferença" value={formatBRL(diff.balanceCents / 100)} strong tone="amber" />
        </Card>
        <Choice
          label="Quem pagou a diferença?"
          value={direction}
          onChange={(v) => setWho(v)}
          columns={1}
          options={[
            { value: 'paid', label: 'Eu paguei', description: 'O que recebi vale mais' },
            { value: 'received', label: 'Eu recebi', description: 'O que entreguei vale mais' },
            { value: 'even', label: 'Sem diferença', description: 'Troca pau a pau' },
          ]}
        />
        {diff.balanceCents > 0 && !directionMismatch ? (
          <div className="space-y-3">
            <MoneyField label={direction === 'received' ? 'Quanto ele pagou agora?' : 'Quanto você pagou agora?'} value={now} onChange={setNow} hint="Deixe vazio se ficou tudo para depois" />
            {nowCents > 0 ? <Choice label="Forma" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} columns={4} /> : null}
            {rest > 0 ? <InstallmentPlanner remainingCents={rest} draft={plan} onChange={setPlan} today={today} /> : null}
          </div>
        ) : null}
        {settleProblem ? <p className="text-base text-rose-300">{settleProblem}</p> : null}
      </WizardStep>
    );
  }

  return (
    <WizardStep step={5} total={TOTAL_STEPS} title="Confere e salva" onBack={() => setStep(4)} onNext={save} nextLabel="Salvar troca" loading={saving} nextDisabled={!!settleProblem}>
      <Card>
        <Row label="Cliente" value={customer?.name} />
        <Row label="Entregou" value={`${itemOut?.name} · ${formatBRL(outCents / 100)}`} />
        <Row label="Recebeu" value={`${inName} · ${formatBRL(inCents / 100)}`} />
        {diff.balanceCents > 0 ? <Row label={direction === 'received' ? 'Você recebe' : 'Você paga'} value={formatBRL(diff.balanceCents / 100)} strong tone={direction === 'received' ? 'emerald' : 'rose'} /> : <Row label="Diferença" value="Sem volta" />}
        {nowCents > 0 ? <Row label="Agora" value={formatBRL(nowCents / 100)} /> : null}
        {rest > 0 ? <Row label="Depois" value={describeSchedule(planCount!, toCents(planValue!), plan.firstDueDate)} /> : null}
      </Card>
      {error ? <Alert>{error}</Alert> : null}
    </WizardStep>
  );
}
