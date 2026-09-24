// Botões grandes (alvo de toque ≥ 48px) e links com cara de botão.
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'md' | 'lg' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-colors select-none ' +
  'disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 active:bg-emerald-600',
  secondary: 'bg-white/6 text-slate-100 border border-white/10 hover:bg-white/10 active:bg-white/14',
  subtle: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/15',
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
  danger: 'bg-rose-500/15 text-rose-200 border border-rose-500/30 hover:bg-rose-500/25',
};

const sizes: Record<Size, string> = {
  sm: 'min-h-10 px-3 text-sm',
  md: 'min-h-12 px-5 text-base',
  lg: 'min-h-14 px-6 text-lg',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'className'> & { variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} {...props} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span aria-hidden className={`${className} inline-block animate-spin rounded-full border-2 border-current border-r-transparent`} />
  );
}
