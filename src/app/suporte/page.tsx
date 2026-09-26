import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Suporte' };

export default function SupportPage() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const whatsapp = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/\D/g, '');
  return <main className="mx-auto max-w-2xl px-5 py-12 text-slate-200">
    <Link href="/app/conta" className="text-emerald-300 hover:underline">← Conta</Link>
    <h1 className="mt-8 text-3xl font-bold text-white">Preciso de ajuda</h1>
    <p className="mt-4">Descreva o problema e, se possível, informe a tela em que aconteceu. Não envie senha, token ou dados de cartão.</p>
    <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
      {email ? <p>E-mail: <a className="text-emerald-300 underline" href={`mailto:${email}`}>{email}</a></p> : null}
      {whatsapp ? <p>WhatsApp: <a className="text-emerald-300 underline" href={`https://wa.me/${whatsapp}`}>Abrir conversa</a></p> : null}
      {!email && !whatsapp ? <p>Os canais de atendimento serão publicados antes da abertura do beta. Usuários autenticados podem enviar um relato pela área Conta.</p> : null}
    </div>
    <p className="mt-6">Encontrou um problema? <Link href="/app/conta#feedback" className="text-emerald-300 underline">Envie um relato pela sua conta</Link>.</p>
    <p className="mt-6 text-sm">Para questões sobre dados pessoais, consulte a <Link href="/privacidade" className="text-emerald-300 underline">Política de Privacidade</Link>.</p>
  </main>;
}
