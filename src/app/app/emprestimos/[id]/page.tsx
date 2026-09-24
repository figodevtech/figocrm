import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HandCoins } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { getLoanDetail } from '@/lib/domain/app-data';
import { todayISO } from '@/lib/domain/loan-plan';
import { formatBRL, formatDate } from '@/lib/format';
import { InstallmentRow } from '@/components/app/debt-parts';
import { RenegotiatePanel } from '@/components/app/renegotiate-panel';
import { Alert, Badge, Card, PageHeader, SectionTitle, Stat } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton, VoiceScreen } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Empréstimo' };

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const [{ id }, { novo }] = await Promise.all([params, searchParams]);
  const { supabase, user } = await requireSession();
  const loan = await getLoanDetail(supabase, user.id, id);
  if (!loan) notFound();
  const today = todayISO();
  const open = loan.installments.filter((i) => i.open);
  const interestText =
    loan.interestType === 'fixed_amount'
      ? loan.interestAmount > 0
        ? `${formatBRL(loan.interestAmount)} fixo`
        : 'Sem juros'
      : `${String(loan.interestRate ?? 0).replace('.', ',')}% ${loan.interestType === 'percent_monthly' ? 'ao mês' : 'sobre o valor'} (${formatBRL(loan.interestAmount)})`;

  return (
    <div className="mx-auto max-w-2xl">
      <VoiceScreen loanContractId={loan.id} customerId={loan.customerId} label={`empréstimo de ${loan.customerName}`} />
      <PageHeader
        title={loan.customerName}
        back="/app/emprestimos"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={loan.statusLabel === 'Quitado' ? 'emerald' : loan.statusLabel === 'Atrasado' ? 'rose' : 'sky'}>{loan.statusLabel}</Badge>
            <span>Empréstimo de {formatDate(loan.startDate)}</span>
          </span>
        }
      />
      {novo ? <div className="mb-4"><Alert tone="success">Empréstimo registrado. As parcelas já estão em “a receber”.</Alert></div> : null}

      <Card className="grid grid-cols-2 gap-4">
        <Stat label="Empréstimo" value={formatBRL(loan.principal)} />
        <Stat label="Total com juros" value={formatBRL(loan.total)} />
        <Stat label="Pago" value={formatBRL(loan.paid)} tone="emerald" />
        <Stat label="Falta" value={formatBRL(loan.balance)} tone={loan.balance > 0 ? 'amber' : 'neutral'} />
      </Card>
      <p className="mt-2 text-base text-slate-400">
        Juros: {interestText} · <Link href={`/app/clientes/${loan.customerId}`} className="text-emerald-300 underline underline-offset-4">ver cliente</Link>
      </p>

      {loan.balance > 0 && loan.receivableId ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <ButtonLink href={`/app/receber?cliente=${loan.customerId}&divida=${loan.receivableId}`}>
            <HandCoins className="h-5 w-5" aria-hidden /> Receber
          </ButtonLink>
          <VoiceButton />
        </div>
      ) : null}

      <SectionTitle>Parcelas</SectionTitle>
      <Card>
        <ul className="divide-y divide-white/5">
          {loan.installments.map((i) => (
            <InstallmentRow key={i.id} inst={i} />
          ))}
        </ul>
      </Card>

      {loan.receivableId && open.length > 0 ? (
        <div className="mt-4">
          <RenegotiatePanel receivableId={loan.receivableId} open={open.map((i) => ({ id: i.id, balance: i.balance, dueDate: i.dueDate }))} today={today} />
        </div>
      ) : null}

      {loan.notes ? (
        <>
          <SectionTitle>Observação</SectionTitle>
          <p className="whitespace-pre-line text-base text-slate-300">{loan.notes}</p>
        </>
      ) : null}
    </div>
  );
}
