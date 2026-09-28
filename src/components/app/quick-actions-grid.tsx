import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Banknote, HandCoins, PackagePlus, ShoppingBag, UserPlus } from 'lucide-react';

const toneClass = {
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-300',
  sky: 'bg-sky-500/15 text-sky-300',
  violet: 'bg-violet-500/15 text-violet-300',
  rose: 'bg-rose-500/15 text-rose-300',
  cyan: 'bg-cyan-500/15 text-cyan-300',
};

type QuickAction = { href: string; icon: ReactNode; label: string; hint: string; tone: keyof typeof toneClass };

const quickActions: QuickAction[] = [
  { href: '/app/vendas/nova', icon: <ShoppingBag className="h-5 w-5" aria-hidden />, label: 'Nova venda', hint: 'À vista ou parcelada', tone: 'emerald' },
  { href: '/app/receber', icon: <HandCoins className="h-5 w-5" aria-hidden />, label: 'Receber pagamento', hint: 'Parcela, parcial ou quitação', tone: 'amber' },
  { href: '/app/clientes/novo', icon: <UserPlus className="h-5 w-5" aria-hidden />, label: 'Novo cliente', hint: 'Nome e telefone', tone: 'sky' },
  { href: '/app/estoque/novo', icon: <PackagePlus className="h-5 w-5" aria-hidden />, label: 'Nova mercadoria', hint: 'Celular, moto, carro, peça…', tone: 'violet' },
  { href: '/app/emprestimos/novo', icon: <Banknote className="h-5 w-5" aria-hidden />, label: 'Emprestar dinheiro', hint: 'Com juros e parcelas', tone: 'rose' },
  { href: '/app/trocas/nova', icon: <ArrowLeftRight className="h-5 w-5" aria-hidden />, label: 'Nova troca', hint: 'Com ou sem volta', tone: 'cyan' },
];

export function QuickActionsGrid() {
  return (
    <div className="grid max-w-4xl grid-cols-3 gap-2 sm:gap-3">
      {quickActions.map((action) => <QuickActionCard key={action.href} {...action} />)}
    </div>
  );
}

function QuickActionCard({ href, icon, label, hint, tone }: QuickAction) {
  return (
    <Link
      href={href}
      className="flex min-h-[108px] min-w-0 touch-manipulation flex-col items-start rounded-2xl border border-white/10 bg-slate-900/70 p-2.5 transition-[background-color,border-color,transform] hover:border-emerald-400/35 hover:bg-slate-900 focus-visible:border-emerald-400/70 focus-visible:ring-2 focus-visible:ring-emerald-400/30 active:scale-[0.98] active:bg-slate-800 sm:min-h-[112px] sm:p-3"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass[tone]}`}>{icon}</span>
      <span className="mt-2 block min-w-0 text-xs font-semibold leading-4 text-white sm:text-sm sm:leading-5">{label}</span>
      <span className="mt-0.5 hidden text-xs leading-4 text-slate-400 sm:block">{hint}</span>
    </Link>
  );
}
