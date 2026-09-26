'use client';

import { useState } from 'react';

export function AccountPrivacyActions() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/account/closure', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, confirmation }) });
      const result = await response.json();
      setPassword('');
      setMessage(result.message || result.error || 'Não foi possível concluir agora.');
      if (response.ok) setDone(true);
    } catch { setMessage('Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }

  return <div className="space-y-4">
    <a href="/api/account/export" download className="inline-flex min-h-11 items-center rounded-xl bg-slate-700 px-4 font-medium text-white hover:bg-slate-600">Exportar meus dados (JSON)</a>
    <p className="text-sm text-slate-400">O arquivo contém seus registros de clientes, itens, negócios e movimentações financeiras. Guarde-o em local seguro.</p>
    {!open && !done ? <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-rose-200 underline">Encerrar minha conta</button> : null}
    {open && !done ? <form onSubmit={submit} className="space-y-3 rounded-xl border border-rose-400/30 p-4">
      <h3 className="font-semibold text-white">Solicitar encerramento</h3>
      <p className="text-sm text-slate-300">A renovação do plano pago será cancelada. O pedido ficará registrado para revisão de retenção legal e operacional. Seus dados não serão apagados imediatamente. Exporte-os antes de continuar.</p>
      <label className="block text-sm">Digite ENCERRAR<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-3" required /></label>
      <label className="block text-sm">Confirme sua senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-3" required /></label>
      <div className="flex gap-3"><button disabled={pending || confirmation !== 'ENCERRAR'} type="submit" className="rounded-xl bg-rose-700 px-4 py-3 font-medium text-white disabled:opacity-50">{pending ? 'Registrando…' : 'Confirmar pedido'}</button><button type="button" onClick={() => setOpen(false)} className="px-4 py-3">Voltar</button></div>
    </form> : null}
    {message ? <p role="status" className="text-sm text-slate-200">{message}</p> : null}
  </div>;
}

export function FeedbackForm() {
  const [category, setCategory] = useState('bug');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, description, route: window.location.pathname }) });
      const result = await response.json();
      setMessage(response.ok ? 'Relato enviado. Obrigado por avisar.' : result.error || 'Não foi possível enviar agora.');
      if (response.ok) setDescription('');
    } catch { setMessage('Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-3">
    <label className="block text-sm">Categoria<select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-3"><option value="bug">Problema no app</option><option value="billing">Cobrança</option><option value="suggestion">Sugestão</option><option value="other">Outro</option></select></label>
    <label className="block text-sm">Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} minLength={10} maxLength={2000} required rows={4} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-3" /></label>
    <p className="text-xs text-slate-400">Não inclua senha, token, dados de cartão ou chaves de API.</p>
    <button type="submit" disabled={pending} className="rounded-xl bg-slate-700 px-4 py-3 font-medium text-white disabled:opacity-50">{pending ? 'Enviando…' : 'Enviar relato'}</button>
    {message ? <p role="status" className="text-sm text-slate-200">{message}</p> : null}
  </form>;
}
