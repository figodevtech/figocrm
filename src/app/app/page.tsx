// src/app/app/page.tsx
// Home do Aplicativo Mobile-First e Voice-First (Fase 19)
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Mic,
  MicOff,
  Search,
  Plus,
  TrendingUp,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  Home,
  Users,
  Package,
  Layers,
  Settings,
  X,
} from 'lucide-react';
import { undoLastAction } from '@/app/actions/undo';

export default function AppHomePage() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    humanResponse: string;
    intent: string;
    requiresConfirmation: boolean;
    confirmationPrompt?: string;
  } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Indicadores dos 4 Pilares da Home
  const [indicators] = useState({
    naRua: 8450.00,
    atrasado: 1350.00,
    emMercadoria: 12800.00,
    quantoGanhouMes: 3420.00,
  });

  // Modal para digitar manualmente caso prefira
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualType, setManualType] = useState<'venda' | 'recebimento' | 'troca' | 'compra'>('venda');

  // Simulação / Web Speech Recognition
  const toggleListening = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    setIsListening(true);
    setTranscript('');
    setLastResult(null);
    setUndoMessage(null);

    interface BrowserSpeechRecognition {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    }

    const windowWithSpeech = window as unknown as {
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      SpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechClass = windowWithSpeech.webkitSpeechRecognition || windowWithSpeech.SpeechRecognition;

    if (SpeechClass) {
      const recognition = new SpeechClass();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: { results: Array<Array<{ transcript: string }>> }) => {
        const spoken = event.results[0][0].transcript;
        setTranscript(spoken);
        setIsListening(false);
        handleSendVoice(spoken);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      try {
        recognition.start();
      } catch {
        simulateVoiceDemo();
      }
    } else {
      // Fallback amigável de demonstração rápida
      simulateVoiceDemo();
    }
  };

  const simulateVoiceDemo = () => {
    const demoPhrases = [
      'João me pagou quinhentos daquela moto.',
      'Vendi o iPhone 13 pro Lucas por 3 mil. Deu mil no Pix e 4 de 500.',
      'Troquei pau a pau meu videogame pelo notebook do Felipe.',
      'Gastei 250 de bateria no celular do estoque.',
    ];
    const picked = demoPhrases[0];
    setTranscript(picked);
    setIsListening(false);
    handleSendVoice(picked);
  };

  const handleSendVoice = async (textToSend: string) => {
    if (!textToSend.trim()) return;
    setProcessing(true);
    setUndoMessage(null);

    try {
      const res = await fetch('/api/voice/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spokenText: textToSend }),
      });

      const data = await res.json();
      setLastResult(data);
    } catch {
      setLastResult({
        humanResponse: 'Não foi possível conectar ao assistente de voz.',
        intent: 'error',
        requiresConfirmation: false,
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleUndo = async () => {
    const res = await undoLastAction();
    if (res.success) {
      setUndoMessage(res.message);
      setLastResult(null);
    } else {
      setUndoMessage(res.error || res.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col pb-24 selection:bg-emerald-500 selection:text-black">
      {/* 1. Barra Superior com Status do Trial */}
      <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/5 glass-panel">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-bold text-black text-sm">
            F
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-none">Figo CRM</div>
            <div className="text-[10px] text-emerald-400 font-medium mt-0.5">7 dias de teste ativos</div>
          </div>
        </div>

        <Link
          href="/cadastro"
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
        >
          R$ 24,90/mês
        </Link>
      </header>

      {/* 2. Busca Universal Rápida */}
      <div className="px-5 pt-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="O que você procura? (cliente, placa, moto, celular...)"
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/90 border border-white/10 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner"
          />
        </div>
      </div>

      {/* 3. Os 4 Pilares da Home */}
      <main className="px-5 py-5 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {/* Quanto tenho na rua */}
          <div className="glass-panel rounded-2xl p-4 border border-white/10 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Na rua</div>
            <div className="text-xl sm:text-2xl font-black text-amber-400 mt-1">
              R$ {indicators.naRua.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">a receber no total</div>
          </div>

          {/* Quem está atrasado */}
          <div className="glass-panel rounded-2xl p-4 border border-white/10 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-rose-400" /> Atrasado
            </div>
            <div className="text-xl sm:text-2xl font-black text-rose-400 mt-1">
              R$ {indicators.atrasado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">parcelas vencidas</div>
          </div>

          {/* Quanto tenho em mercadoria */}
          <div className="glass-panel rounded-2xl p-4 border border-white/10 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Em mercadoria</div>
            <div className="text-xl sm:text-2xl font-black text-cyan-400 mt-1">
              R$ {indicators.emMercadoria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">capital em estoque</div>
          </div>

          {/* Quanto você ganhou no mês */}
          <div className="glass-panel rounded-2xl p-4 border border-white/10 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-400" /> Ganhou
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">
              R$ {indicators.quantoGanhouMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">lucro este mês</div>
          </div>
        </div>

        {/* 4. AÇÃO PRINCIPAL DA TELA: O BOTÃO GIGANTE DE VOZ */}
        <div className="glass-panel rounded-3xl p-6 border border-emerald-500/30 text-center glass-glow relative overflow-hidden">
          <div className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-4">
            O que aconteceu no seu dia?
          </div>

          <div className="flex flex-col items-center justify-center">
            <button
              type="button"
              onClick={toggleListening}
              disabled={processing}
              className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-2xl active:scale-95 ${
                isListening
                  ? 'bg-rose-500 text-white animate-pulse ring-8 ring-rose-500/20'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/30 hover:scale-105'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-10 h-10 mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Ouvindo...</span>
                </>
              ) : (
                <>
                  <Mic className="w-10 h-10 mb-1" />
                  <span className="text-[12px] font-black uppercase tracking-wider">FALAR</span>
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-slate-400 mt-4 max-w-xs mx-auto">
            {isListening
              ? 'Fale naturalmente... estamos escutando'
              : processing
              ? 'Interpretando e calculando valores...'
              : 'Toque e fale: “João me pagou 500” ou “Vendi a moto pro Carlos”'}
          </p>

          {/* Feedback de Transcrição e Resultado */}
          {transcript && (
            <div className="mt-4 p-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-slate-300 italic text-left">
              <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5 not-italic">
                Texto Capturado:
              </span>
              “{transcript}”
            </div>
          )}

          {lastResult && (
            <div className="mt-4 p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-left">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{lastResult.humanResponse}</span>
                </div>
                <button
                  type="button"
                  onClick={handleUndo}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-slate-200 transition-colors shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  Desfazer
                </button>
              </div>
            </div>
          )}

          {undoMessage && (
            <div className="mt-3 p-3 rounded-xl bg-slate-800 border border-white/10 text-xs text-slate-300 text-left flex items-center gap-2">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>{undoMessage}</span>
            </div>
          )}
        </div>

        {/* 5. Acesso Manual Rápido */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
              Prefere digitar?
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <button
              onClick={() => { setManualType('venda'); setShowManualModal(true); }}
              className="glass-panel p-3 rounded-xl border border-white/10 hover:border-emerald-500/30 flex flex-col items-center gap-1.5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold text-slate-200">Venda</span>
            </button>

            <button
              onClick={() => { setManualType('recebimento'); setShowManualModal(true); }}
              className="glass-panel p-3 rounded-xl border border-white/10 hover:border-emerald-500/30 flex flex-col items-center gap-1.5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                <CheckCircle className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold text-slate-200">Receber</span>
            </button>

            <button
              onClick={() => { setManualType('troca'); setShowManualModal(true); }}
              className="glass-panel p-3 rounded-xl border border-white/10 hover:border-emerald-500/30 flex flex-col items-center gap-1.5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold text-slate-200">Troca</span>
            </button>

            <button
              onClick={() => { setManualType('compra'); setShowManualModal(true); }}
              className="glass-panel p-3 rounded-xl border border-white/10 hover:border-emerald-500/30 flex flex-col items-center gap-1.5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                <Package className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold text-slate-200">Compra</span>
            </button>
          </div>
        </div>
      </main>

      {/* 6. Barra Inferior de Navegação (Máximo 5 Módulos) */}
      <nav className="fixed bottom-0 left-0 right-0 glass-panel border-t border-white/10 py-2.5 px-4 z-40">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <Link href="/app" className="flex flex-col items-center gap-1 text-emerald-400">
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-bold">Início</span>
          </Link>
          <Link href="/app" className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Layers className="w-5 h-5" />
            <span className="text-[10px] font-medium">Negócios</span>
          </Link>
          <Link href="/app" className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-medium">Clientes</span>
          </Link>
          <Link href="/app" className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Package className="w-5 h-5" />
            <span className="text-[10px] font-medium">Estoque</span>
          </Link>
          <Link href="/app" className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-medium">Conta</span>
          </Link>
        </div>
      </nav>

      {/* Modal Manual Simples */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl p-6 max-w-sm w-full border border-white/15 relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white capitalize">Registrar {manualType}</h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Para maior rapidez, você também pode simplesmente falar no microfone!
            </p>
            <button
              onClick={() => setShowManualModal(false)}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase"
            >
              Fechar e Usar Voz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
