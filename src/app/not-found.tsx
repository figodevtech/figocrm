import Link from 'next/link';

export default function NotFound() {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
    <h1 className="text-3xl font-bold text-white">Página não encontrada</h1>
    <p className="mt-3 text-slate-300">Confira o endereço ou volte ao início.</p>
    <Link href="/" className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-emerald-950">Voltar ao início</Link>
  </main>;
}
