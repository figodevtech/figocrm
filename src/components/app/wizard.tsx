'use client';
// Passo a passo simples: uma pergunta por tela, botões grandes no fim (perto do polegar).
import { useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { addDaysISO, formatBRL, formatDate, parseMoneyInput } from '@/lib/format';
import { checkInstallmentPlan } from '@/lib/domain/manual-plan';
import { toCents } from '@/lib/finance/money';
import { Button, ButtonLink } from '@/components/ui/button';
import { MoneyField, TextField } from '@/components/ui/form';

export function WizardStep({
  step,
  total,
  title,
  children,
  onBack,
  onNext,
  nextLabel = 'Continuar',
  nextDisabled,
  loading,
}: {
  step: number;
  total: number;
  title: string;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Leitor de tela e teclado acompanham a troca de passo
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  return (
    <section aria-labelledby={`step-${step}`} className="space-y-5">
      <div>
        <div className="mb-2 flex gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-400' : 'bg-white/10'}`} />
          ))}
        </div>
        <p className="text-sm text-slate-400">
          Passo {step} de {total}
        </p>
        <h2 id={`step-${step}`} ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-bold text-white outline-none">
          {title}
        </h2>
      </div>
      {children}
      {onNext || onBack ? (
        <div className="grid grid-cols-[auto_1fr] gap-2 pt-2">
          {onBack ? (
            <Button variant="ghost" size="lg" onClick={onBack}>
              Voltar
            </Button>
          ) : (
            <span />
          )}
          {onNext ? (
            <Button size="lg" onClick={onNext} disabled={nextDisabled} loading={loading}>
              {nextLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export interface InstallmentDraft {
  count: string;
  value: string;
  firstDueDate: string;
}

export function newInstallmentDraft(today: string): InstallmentDraft {
  return { count: '', value: '', firstDueDate: addDaysISO(today, 30) };
}

/** Parcelamento do saldo: quantidade, valor e primeiro vencimento, com a conta sempre visível. */
export function InstallmentPlanner({
  remainingCents,
  draft,
  onChange,
  today,
}: {
  remainingCents: number;
  draft: InstallmentDraft;
  onChange: (next: InstallmentDraft) => void;
  today: string;
}) {
  const count = Number(draft.count) || null;
  const valueReais = parseMoneyInput(draft.value);
  const check = checkInstallmentPlan(remainingCents, count, valueReais === null ? null : toCents(valueReais));

  const setCount = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 3);
    const n = Number(digits);
    // Preenche o valor quando a divisão é exata; senão deixa o usuário ajustar
    const suggested = n > 0 && remainingCents % n === 0 ? formatBRL(remainingCents / n / 100).replace('R$ ', '') : draft.value;
    onChange({ ...draft, count: digits, value: n > 0 ? suggested : draft.value });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/3 p-4">
      <p className="text-base text-slate-300">
        Saldo para parcelar: <strong className="tabular text-amber-300">{formatBRL(remainingCents / 100)}</strong>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Quantidade" inputMode="numeric" value={draft.count} onChange={(e) => setCount(e.target.value)} autoComplete="off" />
        <MoneyField label="Valor de cada" value={draft.value} onChange={(v) => onChange({ ...draft, value: v })} />
      </div>
      <TextField
        label="Primeiro vencimento"
        type="date"
        min={today}
        value={draft.firstDueDate}
        onChange={(e) => onChange({ ...draft, firstDueDate: e.target.value })}
        hint={draft.firstDueDate ? `As próximas vencem todo dia ${Number(draft.firstDueDate.slice(8, 10))}` : undefined}
      />
      <p role="status" className={`tabular rounded-xl px-3 py-2 text-base ${check.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>
        {check.ok ? '✓ ' : ''}
        {check.message}
      </p>
    </div>
  );
}

/** Tela final: o que foi feito e para onde ir (Home, cliente, repetir). */
export function DoneScreen({ title, lines, actions }: { title: string; lines: string[]; actions: Array<{ href: string; label: string; primary?: boolean }> }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section className="space-y-5 text-center" aria-live="polite">
      <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" aria-hidden />
      <h2 ref={ref} tabIndex={-1} className="text-2xl font-bold text-white outline-none">
        {title}
      </h2>
      <div className="space-y-1 text-base text-slate-300">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {actions.map((a) => (
          <ButtonLink key={a.href + a.label} href={a.href} variant={a.primary ? 'primary' : 'secondary'} size="lg">
            {a.label}
          </ButtonLink>
        ))}
      </div>
    </section>
  );
}

export function describeSchedule(count: number, valueCents: number, firstDueDate: string): string {
  return `${count}× de ${formatBRL(valueCents / 100)}, a primeira em ${formatDate(firstDueDate)}`;
}
