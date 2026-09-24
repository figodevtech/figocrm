'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';

const DISMISSED_KEY = 'figo-onboarding-dismissed-v1';
const CHANGE_EVENT = 'figo-onboarding-change';
const subscribe = (callback: () => void) => {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(CHANGE_EVENT, callback); };
};
const getSnapshot = () => { try { return localStorage.getItem(DISMISSED_KEY) !== '1'; } catch { return true; } };

export function OnboardingCard({ hasItem, hasCustomer, hasSale }: { hasItem: boolean; hasCustomer: boolean; hasSale: boolean }) {
  const show = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!show || (hasItem && hasCustomer && hasSale)) return null;

  const steps = [
    { done: hasItem, label: 'Cadastre sua primeira mercadoria', href: '/app/estoque/novo' },
    { done: hasCustomer, label: 'Cadastre um cliente', href: '/app/clientes/novo' },
    { done: hasSale, label: 'Faça sua primeira venda ou fale com o FIGO', href: '/app/vendas/nova' },
  ];
  return <section aria-label="Primeiros passos" className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-500/10 p-4">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Primeiros passos</h2><p className="text-sm text-slate-300">Três ações para começar. Você pode fazer na ordem que quiser.</p></div><button type="button" className="min-h-11 px-2 text-sm text-slate-300 underline" onClick={() => { try { localStorage.setItem(DISMISSED_KEY, '1'); window.dispatchEvent(new Event(CHANGE_EVENT)); } catch {} }}>Pular</button></div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-3">{steps.map((step, index) => <li key={step.href}><Link href={step.href} className="flex min-h-16 items-center gap-3 rounded-xl bg-white/5 p-3 text-sm text-white hover:bg-white/10"><span className={step.done ? 'text-emerald-300' : 'text-sky-300'}>{step.done ? '✓' : index + 1}</span>{step.label}</Link></li>)}</ol>
  </section>;
}
