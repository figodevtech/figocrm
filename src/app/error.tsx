'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
    <h1 className="text-3xl font-bold text-white">Algo deu errado</h1>
    <p className="mt-3 text-slate-300">Não foi possível carregar esta página. Tente novamente.</p>
    <div className="mt-6 flex gap-3"><button onClick={reset} className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-emerald-950">Tentar novamente</button><Link href="/" className="rounded-xl bg-slate-700 px-5 py-3 font-semibold text-white">Voltar ao início</Link></div>
  </main>;
}
