import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listLoans } from '@/lib/domain/app-data';
import { formatBRL, formatShortDate } from '@/lib/format';
import { Badge, EmptyState, PageHeader } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Empréstimos' };

export default async function LoansPage() {
  const { supabase, user } = await requireSession();
  const loans = await listLoans(supabase, user.id);
  const open = loans.filter((l) => l.balance > 0);
  const totalOpen = open.reduce((acc, l) => acc + l.balance, 0);

  return (
    <div>
      <PageHeader
        title="Empréstimos"
        back="/app"
        subtitle={loans.length > 0 ? `${open.length} em aberto · falta receber ${formatBRL(totalOpen)}` : undefined}
        action={
          <ButtonLink href="/app/emprestimos/novo" size="sm">
            <Plus className="h-5 w-5" aria-hidden /> Novo
          </ButtonLink>
        }
      />
      {loans.length === 0 ? (
        <EmptyState title="Nenhum empréstimo ainda." text="Registre um empréstimo ou fale:" example="Emprestei dois mil pro Carlos em cinco de quinhentos.">
          <ButtonLink href="/app/emprestimos/novo">Emprestar</ButtonLink>
          <VoiceButton />
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {loans.map((l) => (
            <li key={l.id}>
              <Link href={`/app/emprestimos/${l.id}`} className="block rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/25">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{l.customerName}</p>
                    <p className="tabular text-base text-slate-400">
                      Emprestou {formatBRL(l.principal)} · volta {formatBRL(l.total)}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                </div>
                <div className="tabular mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
                  <Badge tone={l.statusLabel === 'Quitado' ? 'emerald' : l.statusLabel === 'Atrasado' ? 'rose' : 'sky'}>{l.statusLabel}</Badge>
                  {l.balance > 0 ? <span className="text-slate-300">Falta <strong className="text-amber-300">{formatBRL(l.balance)}</strong></span> : null}
                  {l.nextInstallment ? <span className="text-slate-400">Próx. {formatShortDate(l.nextInstallment.dueDate)}</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
