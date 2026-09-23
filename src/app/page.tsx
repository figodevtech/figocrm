// src/app/page.tsx
// Landing Page Comercial Oficial do SaaS Voice-First (Fase 16)
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Mic,
  ArrowRight,
  ShieldCheck,
  Zap,
  TrendingUp,
  Wallet,
  CheckCircle2,
  HelpCircle,
  Smartphone,
  ChevronDown,
} from 'lucide-react';

export default function LandingPage() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-black">
      {/* 1. Header / Navbar */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Mic className="w-5 h-5 text-black" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Figo CRM
              </span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Voz Primeiro
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors px-3 py-1.5"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-md shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5"
            >
              Testar 7 Dias Grátis
            </Link>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative pt-20 pb-16 px-6 overflow-hidden">
        {/* Glow ambient background effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-emerald-500/15 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[350px] h-[350px] bg-teal-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium text-emerald-300 mb-8 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            O primeiro assistente de voz feito para revendedores independentes
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-6 leading-[1.1]">
            Você fala. <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Ele organiza.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed font-normal">
            Controle suas compras, vendas, trocas, parcelas e dinheiro a receber sem perder tempo preenchendo telas complicadas de ERP.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link
              href="/cadastro"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-base transition-all shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5"
            >
              <Mic className="w-5 h-5 text-black" />
              Começar 7 dias grátis
              <ArrowRight className="w-4 h-4 text-black" />
            </Link>
            <a
              href="#demonstracao"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl glass-panel text-slate-200 hover:text-white font-medium text-base hover:bg-white/5 transition-colors border border-white/10"
            >
              Ver como funciona
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              7 dias de teste sem compromisso
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              R$ 24,90/mês após o teste
            </div>
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              Direto no seu celular (PWA)
            </div>
          </div>
        </div>
      </section>

      {/* 3. Demonstração Interativa da Voz */}
      <section id="demonstracao" className="py-16 px-6 relative">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Como funciona na prática?
            </h2>
            <p className="text-slate-400 text-sm sm:text-base">
              Veja a diferença entre preencher dezenas de campos e apenas mandar um áudio:
            </p>
          </div>

          <div className="glass-panel rounded-3xl p-6 sm:p-10 border border-white/10 glass-glow relative overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              {/* Lado Esquerdo: O que o revendedor fala */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                  <Mic className="w-4 h-4" /> Você aperta o botão e fala:
                </div>
                <div className="bg-slate-900/90 rounded-2xl p-5 border border-emerald-500/30 relative shadow-inner">
                  <p className="text-base sm:text-lg font-medium text-emerald-200 italic leading-snug">
                    “Vendi a moto pro Carlos por quinze. Ele me deu cinco e vai pagar os outros dez em dez parcelas.”
                  </p>
                  <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Transcrito e interpretado em 0.8s
                  </div>
                </div>
              </div>

              {/* Lado Direito: O que o sistema organiza */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <Zap className="w-4 h-4 text-teal-400" /> O sistema organiza e salva sozinho:
                </div>
                <div className="bg-slate-950/80 rounded-2xl p-5 border border-white/10 space-y-3 font-mono text-sm">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-400 font-sans">Venda Registrada:</span>
                    <span className="font-semibold text-white">R$ 15.000,00</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-400 font-sans">Recebido no Ato (Pix):</span>
                    <span className="font-semibold text-emerald-400">+ R$ 5.000,00</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-400 font-sans">Ficou &quot;Na Rua&quot;:</span>
                    <span className="font-semibold text-amber-300">R$ 10.000,00</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-400 font-sans pt-1">
                    <span>Cronograma:</span>
                    <span>10 parcelas de R$ 1.000,00</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-xs text-slate-400 text-center sm:text-left">
                Tudo auditado e seguro. Você pode corrigir ou desfazer com um clique.
              </span>
              <Link
                href="/cadastro"
                className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5"
              >
                Experimentar com seus próprios negócios
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Os 4 Pilares da Clareza Financeira */}
      <section className="py-16 px-6 bg-slate-950/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Sem termos contábeis difíceis. Apenas o que importa:
            </h2>
            <p className="text-slate-400 text-sm sm:text-base">
              A resposta exata para as 4 perguntas que todo comerciante se faz todos os dias:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1 */}
            <div className="glass-panel rounded-2xl p-6 border border-white/10 hover:border-emerald-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="text-xs text-slate-400 font-medium mb-1">Quanto tenho</div>
              <div className="text-xl font-bold text-white mb-2">Na rua</div>
              <div className="text-2xl font-extrabold text-amber-400 mb-2">R$ 8.450</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Todas as parcelas futuras, promissórias e fiados a receber somados em tempo real.
              </p>
            </div>

            {/* Card 2 */}
            <div className="glass-panel rounded-2xl p-6 border border-white/10 hover:border-rose-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="text-xs text-slate-400 font-medium mb-1">Quem está</div>
              <div className="text-xl font-bold text-white mb-2">Atrasado</div>
              <div className="text-2xl font-extrabold text-rose-400 mb-2">R$ 1.350</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Saiba no mesmo segundo quais clientes passaram da data combinada para cobrar rápido.
              </p>
            </div>

            {/* Card 3 */}
            <div className="glass-panel rounded-2xl p-6 border border-white/10 hover:border-cyan-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-4">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="text-xs text-slate-400 font-medium mb-1">Quanto tenho</div>
              <div className="text-xl font-bold text-white mb-2">Em mercadoria</div>
              <div className="text-2xl font-extrabold text-cyan-400 mb-2">R$ 12.800</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Custo real do estoque disponível com todas as peças, reformas e despachante somados.
              </p>
            </div>

            {/* Card 4 */}
            <div className="glass-panel rounded-2xl p-6 border border-white/10 hover:border-emerald-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="text-xs text-slate-400 font-medium mb-1">Quanto você</div>
              <div className="text-xl font-bold text-white mb-2">Ganhou no mês</div>
              <div className="text-2xl font-extrabold text-emerald-400 mb-2">R$ 3.420</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Lucro limpo real apurado sobre todas as vendas e trocas concluídas no período.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Preço Claro e Transparente */}
      <section className="py-20 px-6 relative">
        <div className="max-w-md mx-auto text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            Plano Único e Sem Pegadinhas
          </div>
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Simples de entender. Sem múltiplos planos.
          </h2>
          <p className="text-slate-400 text-sm mb-8">
            Um valor fixo que cabe no bolso de qualquer vendedor autônomo.
          </p>

          <div className="glass-panel rounded-3xl p-8 border border-emerald-500/30 glass-glow relative">
            <div className="text-sm font-semibold text-emerald-400 mb-1">
              7 Dias Totalmente Grátis
            </div>
            <div className="text-5xl font-black text-white my-4">
              R$ 24<span className="text-2xl text-slate-300 font-normal">,90</span>
              <span className="text-xs text-slate-400 font-normal ml-1">/mês</span>
            </div>
            <p className="text-xs text-slate-400 mb-6">
              Comece agora sem pagar nada. Se gostar, continue por apenas 83 centavos por dia.
            </p>

            <ul className="text-left space-y-3 text-xs sm:text-sm text-slate-300 mb-8">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Comandos de voz ilimitados
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Vendas, compras, fiados e trocas com volta
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Controle de parcelas e alertas de atrasados
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Cálculo automático de lucro e CMV
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Acesso no celular e no computador
              </li>
            </ul>

            <Link
              href="/cadastro"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-base transition-all shadow-lg shadow-emerald-500/30"
            >
              Começar Teste de 7 Dias
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 6. Perguntas Frequentes (FAQ) */}
      <section className="py-16 px-6 bg-slate-950/50">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white mb-2">
              Perguntas Frequentes
            </h2>
            <p className="text-slate-400 text-sm">
              Tire suas dúvidas antes de começar.
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                q: 'Como funciona o teste grátis de 7 dias?',
                a: 'Você cria sua conta em menos de 1 minuto e usa todas as funções do aplicativo por 7 dias sem pagar nada. Se decidir não assinar, seus dados continuam seguros.',
              },
              {
                q: 'E se a IA entender errado o que eu falei?',
                a: 'O sistema sempre mostra na tela o que entendeu antes de confirmar operações de risco, e você tem um botão "Desfazer" para reverter qualquer ação na hora.',
              },
              {
                q: 'Funciona para quem trabalha com trocas e voltas?',
                a: 'Sim! Foi feito especificamente para isso: troca seca, troca com volta em dinheiro ou troca com volta parcelada são suportadas nativamente.',
              },
              {
                q: 'Preciso instalar pela Google Play ou App Store?',
                a: 'Não precisa. O aplicativo é um PWA moderno: basta abrir no navegador do seu celular e clicar em "Adicionar à tela inicial" para usá-lo como um app normal.',
              },
            ].map((faq, idx) => (
              <div
                key={idx}
                className="glass-panel rounded-xl border border-white/5 overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 text-sm font-semibold text-slate-200 hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeFaq === idx ? 'rotate-180 text-emerald-400' : ''
                    }`}
                  />
                </button>
                {activeFaq === idx && (
                  <div className="px-5 pb-4 text-xs sm:text-sm text-slate-400 leading-relaxed border-t border-white/5 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Footer */}
      <footer className="mt-auto border-t border-white/10 py-8 px-6 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">Figo CRM</span> — O CRM Voice-First para quem vive de negócios
          </div>
          <div>© {new Date().getFullYear()} Todos os direitos reservados. Assinatura R$ 24,90/mês.</div>
        </div>
      </footer>
    </div>
  );
}
