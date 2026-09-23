// src/app/login/page.tsx
// Tela de Login com Estética Premium e Glassmorphism (Fase 5)
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mic, ArrowRight, Lock, Mail, AlertCircle } from 'lucide-react';
import { signInAction } from '@/app/auth/actions';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await signInAction(null, formData);

    if (res?.error) {
      setError(res.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center p-6 relative selection:bg-emerald-500 selection:text-black">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Mic className="w-5 h-5 text-black" />
            </div>
            <span className="text-2xl font-black text-white">Figo CRM</span>
          </Link>
          <h1 className="text-xl font-bold text-white">Entrar na sua conta</h1>
          <p className="text-xs text-slate-400 mt-1">Acesse seus negócios, clientes e recebíveis</p>
        </div>

        <div className="glass-panel rounded-3xl p-8 border border-white/10 shadow-2xl">
          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Sua senha secreta"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Entrando...' : 'Entrar no Aplicativo'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5 text-center text-xs text-slate-400">
            Ainda não tem conta?{' '}
            <Link href="/cadastro" className="text-emerald-400 hover:text-emerald-300 font-semibold">
              Criar conta grátis (7 dias)
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
