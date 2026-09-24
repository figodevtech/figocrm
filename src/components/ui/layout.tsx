// Blocos de layout das telas do app: cabeçalho com voltar, cards, estados vazios, alertas e skeletons.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({ title, back, subtitle, action }: { title: string; back?: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      {back ? (
        <Link
          href={back}
          aria-label="Voltar"
          className="-ml-2 mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold leading-tight text-white">{title}</h1>
        {subtitle ? <div className="mt-1 text-base text-slate-400">{subtitle}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-slate-900/70 p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, text, example, children }: { title: string; text?: string; example?: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/2 px-5 py-8 text-center">
      <p className="text-lg font-semibold text-white">{title}</p>
      {text ? <p className="mt-2 text-base text-slate-400">{text}</p> : null}
      {example ? <p className="mt-3 text-base italic text-emerald-300">“{example}”</p> : null}
      {children ? <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">{children}</div> : null}
    </div>
  );
}

const tones = {
  neutral: 'text-white',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
  emerald: 'text-emerald-300',
};

export function Stat({ label, value, tone = 'neutral', size = 'md' }: { label: string; value: ReactNode; tone?: keyof typeof tones; size?: 'md' | 'lg' }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`tabular mt-1 truncate font-bold ${size === 'lg' ? 'text-3xl' : 'text-xl'} ${tones[tone]}`}>{value}</div>
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-white/10 text-slate-200',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-200',
  rose: 'bg-rose-500/15 text-rose-200',
  sky: 'bg-sky-500/15 text-sky-200',
  violet: 'bg-violet-500/15 text-violet-200',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-medium ${badgeTones[tone]}`}>{children}</span>;
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' | 'warning' }) {
  const style = {
    error: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-base ${style}`}>
      {children}
    </div>
  );
}

export function Skeleton({ className = 'h-6 w-full' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-white/6 ${className}`} />;
}

/** Skeleton padrão de lista: cabeçalho + cards. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="space-y-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

/** Linha "rótulo ........ valor" de resumo. */
export function Row({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: keyof typeof tones }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? 'text-lg font-bold' : 'text-base'}`}>
      <span className={strong ? 'text-white' : 'text-slate-400'}>{label}</span>
      <span className={`tabular text-right ${tone ? tones[tone] : 'text-white'}`}>{value}</span>
    </div>
  );
}
