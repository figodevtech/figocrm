// Home = central operacional: indicadores, FALAR e atalhos grandes. Sem sidebar.
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Banknote, HandCoins, Landmark, Package, PackagePlus, Receipt, ShoppingBag, UserPlus, Users } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { getDashboard, getProfile, getReviewCounts } from '@/lib/domain/app-data';
import { firstName, formatBRL } from '@/lib/format';
import { HomeVoiceButton } from '@/components/app/home-voice';
import { OnboardingCard } from '@/components/app/onboarding-card';
import { Stat } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Início' };

export default async function HomePage() {
  const { supabase, user } = await requireSession();
  const [profile, indicators, review, customers, items, sales] = await Promise.all([
    getProfile(supabase, user.id, user.email ?? ''), getDashboard(supabase, user.id), getReviewCounts(supabase, user.id),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('deal_type', 'venda'),
  ]);
  const reviewTotal = review.provisionalCustomers + review.provisionalItems + review.costPending;
  const name = firstName(profile.fullName);
  const money = (v: number | undefined) => (indicators ? formatBRL(v ?? 0) : '—');

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">{name ? `Olá, ${name}` : 'Olá'}</h1>
      <OnboardingCard hasCustomer={(customers.count ?? 0) > 0} hasItem={(items.count ?? 0) > 0} hasSale={(sales.count ?? 0) > 0} />

      <section aria-label="Falar" className="mt-6 rounded-3xl border border-emerald-500/20 bg-emerald-500/4 p-5">
        <HomeVoiceButton />
      </section>

      <h2 className="mb-3 mt-7 text-lg font-semibold text-white">O que você quer fazer?</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Shortcut href="/app/vendas/nova" icon={<ShoppingBag className="h-7 w-7" aria-hidden />} label="Nova venda" hint="À vista ou parcelada" tone="emerald" />
        <Shortcut href="/app/receber" icon={<HandCoins className="h-7 w-7" aria-hidden />} label="Receber pagamento" hint="Parcela, parcial ou quitação" tone="amber" />
        <Shortcut href="/app/clientes/novo" icon={<UserPlus className="h-7 w-7" aria-hidden />} label="Novo cliente" hint="Nome e telefone" tone="sky" />
        <Shortcut href="/app/estoque/novo" icon={<PackagePlus className="h-7 w-7" aria-hidden />} label="Nova mercadoria" hint="Celular, moto, carro, peça…" tone="violet" />
        <Shortcut href="/app/emprestimos/novo" icon={<Banknote className="h-7 w-7" aria-hidden />} label="Emprestar dinheiro" hint="Com juros e parcelas" tone="rose" />
        <Shortcut href="/app/trocas/nova" icon={<ArrowLeftRight className="h-7 w-7" aria-hidden />} label="Nova troca" hint="Com ou sem volta" tone="cyan" />
      </div>

      <section aria-label="Resumo" className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/app/clientes" className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/20">
          <Stat label="A receber" value={money(indicators?.naRua)} tone="amber" />
        </Link>
        <Link href="/app/clientes?filtro=atrasados" className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/20">
          <Stat label="Atrasado" value={money(indicators?.atrasado)} tone="rose" />
        </Link>
        <Link href="/app/estoque" className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/20">
          <Stat label="Em mercadoria" value={money(indicators?.emMercadoria)} tone="sky" />
        </Link>
        <Link href="/app/negocios" className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-white/20">
          <Stat label="Ganhei este mês" value={money(indicators?.quantoGanhouMes)} tone="emerald" />
        </Link>
      </section>
      {!indicators ? <p className="mt-2 text-sm text-slate-500">Não consegui carregar o resumo agora.</p> : null}

      {reviewTotal > 0 ? (
        <section aria-label="Para completar" className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-semibold text-amber-100">Para completar depois · {reviewTotal}</p>
            <Link href="/app/pendencias" className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-200 underline underline-offset-4">Ver todas</Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {review.provisionalCustomers > 0 ? (
              <Link href="/app/clientes?filtro=avulsos" className="inline-flex min-h-11 items-center rounded-xl bg-white/6 px-3 text-base text-white hover:bg-white/10">
                {review.provisionalCustomers} {review.provisionalCustomers === 1 ? 'cliente avulso' : 'clientes avulsos'}
              </Link>
            ) : null}
            {review.costPending > 0 ? <Link href="/app/pendencias#custos" className="inline-flex min-h-11 items-center rounded-xl bg-white/6 px-3 text-base text-white hover:bg-white/10">{review.costPending} {review.costPending === 1 ? 'venda sem custo' : 'vendas sem custo'}</Link> : null}
            {review.provisionalItems > 0 ? <Link href="/app/pendencias#mercadorias" className="inline-flex min-h-11 items-center rounded-xl bg-white/6 px-3 text-base text-white hover:bg-white/10">{review.provisionalItems} {review.provisionalItems === 1 ? 'mercadoria avulsa' : 'mercadorias avulsas'}</Link> : null}
          </div>
          {review.costPending > 0 ? <p className="mt-2 text-sm text-amber-100/80">O lucro dessas vendas entra no “Ganhei este mês” quando você informar o custo.</p> : null}
        </section>
      ) : null}

      <h2 className="mb-3 mt-7 text-lg font-semibold text-white">Consultar</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SmallShortcut href="/app/clientes" icon={<Users className="h-6 w-6" aria-hidden />} label="Clientes" />
        <SmallShortcut href="/app/estoque" icon={<Package className="h-6 w-6" aria-hidden />} label="Estoque" />
        <SmallShortcut href="/app/negocios" icon={<Receipt className="h-6 w-6" aria-hidden />} label="Negócios" />
        <SmallShortcut href="/app/emprestimos" icon={<Landmark className="h-6 w-6" aria-hidden />} label="Empréstimos" />
      </div>
    </div>
  );
}

const toneClass = {
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-300',
  sky: 'bg-sky-500/15 text-sky-300',
  violet: 'bg-violet-500/15 text-violet-300',
  rose: 'bg-rose-500/15 text-rose-300',
  cyan: 'bg-cyan-500/15 text-cyan-300',
};

function Shortcut({ href, icon, label, hint, tone }: { href: string; icon: ReactNode; label: string; hint: string; tone: keyof typeof toneClass }) {
  return (
    <Link
      href={href}
      className="flex min-h-20 items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 transition-colors hover:border-white/25 hover:bg-slate-900 active:bg-slate-800"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${toneClass[tone]}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-white">{label}</span>
        <span className="block text-sm text-slate-400">{hint}</span>
      </span>
    </Link>
  );
}

function SmallShortcut({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-white/3 px-4 text-base font-semibold text-slate-100 hover:bg-white/7"
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </Link>
  );
}
