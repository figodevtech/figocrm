'use client';
// Botão principal da Home: um toque já começa a ouvir.
import { Mic } from 'lucide-react';
import { useVoice } from '@/components/voice/voice-provider';

export function HomeVoiceButton() {
  const { open } = useVoice();
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <button
        type="button"
        onClick={() => open({ autoStart: true })}
        className="flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full bg-emerald-500 text-emerald-950 shadow-xl shadow-emerald-500/25 transition-transform hover:bg-emerald-400 active:scale-95"
        aria-label="Falar: conte o que aconteceu"
      >
        <Mic className="h-12 w-12" aria-hidden />
        <span className="text-base font-black uppercase tracking-wider">Falar</span>
      </button>
      <p className="mt-3 text-base text-slate-300">“Conte o que aconteceu”</p>
    </div>
  );
}
