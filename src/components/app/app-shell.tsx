'use client';
// Estrutura do app SEM sidebar e SEM menu hambúrguer:
//  - celular: barra inferior fixa (Início, Clientes, FALAR, Estoque, Conta)
//  - desktop (≥ 1024px): navegação horizontal compacta no topo + botão Falar; tablet usa a barra inferior
// A Home continua sendo a central de ações (atalhos grandes); a barra só leva de volta a ela.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Home, Mic, Package, UserRound, Users } from 'lucide-react';
import { useVoice, VoiceProvider } from '@/components/voice/voice-provider';

const DESKTOP_LINKS = [
  { href: '/app', label: 'Início' },
  { href: '/app/clientes', label: 'Clientes' },
  { href: '/app/estoque', label: 'Estoque' },
  { href: '/app/negocios', label: 'Negócios' },
  { href: '/app/emprestimos', label: 'Empréstimos' },
  { href: '/app/conta', label: 'Conta' },
];

function isActive(pathname: string, href: string) {
  return href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
}

export interface ShellAccess {
  canWrite: boolean;
  trialing: boolean;
  trialDaysRemaining: number;
}

export function AppShell({ children, access }: { children: ReactNode; access: ShellAccess }) {
  return (
    <VoiceProvider>
      <ShellFrame access={access}>{children}</ShellFrame>
    </VoiceProvider>
  );
}

function ShellFrame({ children, access }: { children: ReactNode; access: ShellAccess }) {
  const pathname = usePathname();
  const { open } = useVoice();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-emerald-500 focus:px-4 focus:py-2 focus:text-emerald-950">
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#090d16]/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
          <Link href="/app" className="flex items-center gap-2 font-black tracking-tight text-white" aria-label="FIGO — Início">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-sm text-emerald-950">F</span>
            <span className="text-lg">FIGO</span>
          </Link>

          <nav aria-label="Principal" className="hidden flex-1 items-center gap-1 lg:flex">
            {DESKTOP_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(pathname, l.href) ? 'page' : undefined}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(pathname, l.href) ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {access.trialing && access.canWrite ? (
              <Link href="/app/conta" className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
                Teste: {access.trialDaysRemaining} {access.trialDaysRemaining === 1 ? 'dia' : 'dias'}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => open({ autoStart: true })}
              className="hidden min-h-10 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 lg:inline-flex"
            >
              <Mic className="h-4 w-4" aria-hidden /> Falar
            </button>
          </div>
        </div>
      </header>

      {offline ? <div role="status" aria-live="polite" className="border-b border-amber-400/30 bg-amber-500/15 px-4 py-3 text-center text-sm text-amber-100">Você está sem conexão. Algumas ações precisam de internet para serem registradas. Confira a confirmação antes de sair da tela.</div> : null}

      {!access.canWrite ? (
        <div role="status" className="border-b border-rose-500/30 bg-rose-500/10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-base text-rose-100">
            <span>Seu período de teste acabou. Seus dados continuam aqui, mas novos registros estão bloqueados.</span>
            <Link href="/app/conta" className="font-semibold text-white underline underline-offset-4">
              Ver plano
            </Link>
          </div>
        </div>
      ) : null}

      <main id="conteudo" className="pb-safe-nav mx-auto w-full max-w-5xl flex-1 px-4 pt-5 lg:pb-12">
        {children}
      </main>

      <nav aria-label="Navegação inferior" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b111d]/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-5 items-center">
          <NavItem href="/app" label="Início" active={isActive(pathname, '/app')} icon={<Home className="h-6 w-6" aria-hidden />} />
          <NavItem href="/app/clientes" label="Clientes" active={isActive(pathname, '/app/clientes')} icon={<Users className="h-6 w-6" aria-hidden />} />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => open({ autoStart: true })}
              aria-label="Falar"
              className="-mt-7 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/30 ring-4 ring-[#0b111d] active:bg-emerald-600"
            >
              <Mic className="h-7 w-7" aria-hidden />
              <span className="text-[11px] font-bold leading-none">Falar</span>
            </button>
          </div>
          <NavItem href="/app/estoque" label="Estoque" active={isActive(pathname, '/app/estoque')} icon={<Package className="h-6 w-6" aria-hidden />} />
          <NavItem href="/app/conta" label="Conta" active={isActive(pathname, '/app/conta')} icon={<UserRound className="h-6 w-6" aria-hidden />} />
        </div>
      </nav>
    </div>
  );
}

function NavItem({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex h-full flex-col items-center justify-center gap-1 text-xs font-medium ${active ? 'text-emerald-300' : 'text-slate-400 hover:text-white'}`}
    >
      {icon}
      {label}
    </Link>
  );
}
