// src/app/cadastro/page.tsx
// Tela de Cadastro com Início de Trial de 7 Dias Grátis (Fase 5 e 6)
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mic, ArrowRight, Lock, Mail, User, Phone, Briefcase, AlertCircle, ShieldCheck } from 'lucide-react';
import { signUpAction } from '@/app/auth/actions';

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await signUpAction(null, formData);

    if (res?.error) {
      setError(res.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center p-6 relative selection:bg-emerald-500 selection:text-black">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Mic className="w-5 h-5 text-black" />
            </div>
            <span className="text-2xl font-black text-white">Figo CRM</span>
          </Link>
          <h1 className="text-xl font-bold text-white">Crie sua conta em 1 minuto</h1>
          <p className="text-xs text-emerald-400 font-medium flex items-center justify-center gap-1.5 mt-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            7 dias de teste grátis liberado imediatamente
          </p>
        </div>

        <div className="glass-panel rounded-3xl p-8 border border-white/10 shadow-2xl">
          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Seu Nome Completo
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  name="fullName"
                  required
                  placeholder="Ex: Carlos Silva"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                  WhatsApp / Celular
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="tel"
                    name="phone"
                    placeholder="(11) 99999-9999"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                  O que você vende?
                </label>
                <div className="relative">
                  <Briefcase className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    name="businessSegment"
                    defaultValue="celulares"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white text-xs focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                  >
                    <option value="celulares">Celulares / Tech</option>
                    <option value="motos">Motos</option>
                    <option value="carros">Carros / Veículos</option>
                    <option value="ferramentas">Ferramentas / Peças</option>
                    <option value="roupas">Roupas / Calçados</option>
                    <option value="outros">Revenda em Geral</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Crie uma Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Mínimo 6 dígitos"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-3 py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Criando Conta...' : 'Começar 7 Dias Grátis'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-slate-400">
            Já tem conta?{' '}
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-semibold">
              Fazer login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
