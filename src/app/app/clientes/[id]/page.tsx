import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Banknote, HandCoins, Pencil, Phone, ShoppingBag } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { getCustomerDetail, listCustomerOptions } from '@/lib/domain/app-data';
import { ProvisionalCustomerPanel } from '@/components/app/provisional-panels';
import { formatBRL, formatPhone, formatShortDate } from '@/lib/format';
import { DebtCard, Timeline } from '@/components/app/debt-parts';
import { Badge, Card, PageHeader, SectionTitle, Stat } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton, VoiceScreen } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Cliente' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireSession();
  const detail = await getCustomerDetail(supabase, user.id, id);
  if (!detail) notFound();
  const { customer } = detail;
  const candidates = customer.is_provisional ? await listCustomerOptions(supabase, user.id) : [];
  const summary = customer.is_provisional ? await Promise.all([
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('customer_id', id),
    supabase.from('loan_contracts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('customer_id', id),
  ]) : null;

  return (
    <div>
      {/* Voz nesta tela já sabe de quem se trata ("ele pagou 500") */}
      <VoiceScreen customerId={customer.id} label={customer.name} />

      <PageHeader
        title={customer.name}
        back="/app/clientes"
        subtitle={
          customer.phone || customer.is_provisional ? (
            <span className="flex flex-wrap items-center gap-3">
              {customer.is_provisional ? <Badge tone="amber">Avulso</Badge> : null}
              {customer.phone ? (
                <a href={`tel:${customer.phone.replace(/\D/g, '')}`} className="inline-flex min-h-11 items-center gap-2 text-emerald-300">
                  <Phone className="h-4 w-4" aria-hidden /> {formatPhone(customer.phone)}
                </a>
              ) : null}
            </span>
          ) : null
        }
        action={
          <Link href={`/app/clientes/${customer.id}/editar`} aria-label="Editar cliente" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 hover:bg-white/5">
            <Pencil className="h-5 w-5" aria-hidden />
          </Link>
        }
      />

      {customer.is_provisional ? <ProvisionalCustomerPanel customer={{ id: customer.id, name: customer.name }} candidates={candidates} summary={{ deals: summary?.[0].count ?? 0, receivable: detail.owes, loans: summary?.[1].count ?? 0 }} /> : null}

      <Card className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Deve" value={formatBRL(detail.owes)} tone={detail.owes > 0 ? 'amber' : 'neutral'} size="lg" />
        <Stat label="Atrasado" value={formatBRL(detail.overdue)} tone={detail.overdue > 0 ? 'rose' : 'neutral'} size="lg" />
        <div className="col-span-2 sm:col-span-1">
          <Stat label="Próximo" value={detail.next ? `${formatShortDate(detail.next.dueDate)} — ${formatBRL(detail.next.amount)}` : '—'} />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ButtonLink href={`/app/vendas/nova?cliente=${customer.id}`} variant="secondary">
          <ShoppingBag className="h-5 w-5" aria-hidden /> Nova venda
        </ButtonLink>
        <ButtonLink href={`/app/receber?cliente=${customer.id}`} variant={detail.owes > 0 ? 'primary' : 'secondary'}>
          <HandCoins className="h-5 w-5" aria-hidden /> Receber
        </ButtonLink>
        <ButtonLink href={`/app/emprestimos/novo?cliente=${customer.id}`} variant="secondary">
          <Banknote className="h-5 w-5" aria-hidden /> Emprestar
        </ButtonLink>
        <VoiceButton variant="subtle" />
      </div>

      {detail.debts.length > 0 ? (
        <>
          <SectionTitle>Em aberto</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {detail.debts.map((d) => (
              <DebtCard key={d.receivableId} debt={d} customerId={customer.id} />
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle>Histórico</SectionTitle>
      <Timeline events={detail.timeline} />

      {customer.document || customer.address || customer.notes ? (
        <>
          <SectionTitle>Dados</SectionTitle>
          <Card className="space-y-2 text-base">
            {customer.document ? <p><span className="text-slate-400">CPF/CNPJ:</span> {customer.document}</p> : null}
            {customer.address ? <p><span className="text-slate-400">Endereço:</span> {customer.address}</p> : null}
            {customer.notes ? <p className="whitespace-pre-line"><span className="text-slate-400">Observações:</span> {customer.notes}</p> : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
