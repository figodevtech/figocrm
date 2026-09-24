'use client';
// Voz em qualquer tela: provider global + painel inferior (bottom sheet).
// A tela atual registra seu contexto (cliente, mercadoria, empréstimo) e ele vai junto em cada fala,
// então "ele pagou 500" na página do Carlos já chega com customerId = Carlos.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, HelpCircle, Info, Keyboard, Mic, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import type { AssistantResponse } from '@/lib/api/assistant-response';
import { assistantView, AssistantView, isBusyPhase, PHASE_LABEL, VoicePhase } from '@/lib/voice/assistant-view';
import { useRecorder } from './use-recorder';
import { Button, Spinner } from '@/components/ui/button';

export interface VoiceScreenContext {
  customerId?: string;
  itemId?: string;
  loanContractId?: string;
  receivableId?: string;
}

interface ScreenEntry {
  key: string;
  context: VoiceScreenContext;
  label: string;
}

interface VoiceApi {
  open: (options?: { autoStart?: boolean }) => void;
  setScreen: (entry: ScreenEntry | null) => void;
  clearScreen: (key: string) => void;
}

const VoiceContext = createContext<VoiceApi | null>(null);

export function useVoice(): VoiceApi {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice fora do VoiceProvider');
  return ctx;
}

/** Registra o contexto da tela enquanto ela estiver aberta. */
export function useVoiceScreen(context: VoiceScreenContext, label: string) {
  const { setScreen, clearScreen } = useVoice();
  const key = JSON.stringify(context);
  useEffect(() => {
    setScreen({ key, context: JSON.parse(key) as VoiceScreenContext, label });
    return () => clearScreen(key);
  }, [key, label, setScreen, clearScreen]);
}

const EXAMPLES = ['Carlos pagou 500', 'Vendi o iPhone 13 pro João por 3 mil', 'Emprestei 2 mil pro Pedro em 5 de 500', 'Quanto o Carlos me deve?'];

function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreenState] = useState<ScreenEntry | null>(null);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [view, setView] = useState<AssistantView | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [micMessage, setMicMessage] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ kind: 'text'; value: string } | null>(null);
  const micButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<ScreenEntry | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setScreen = useCallback((entry: ScreenEntry | null) => {
    screenRef.current = entry;
    setScreenState(entry);
  }, []);
  const clearScreen = useCallback((key: string) => {
    if (screenRef.current?.key === key) {
      screenRef.current = null;
      setScreenState(null);
    }
  }, []);

  const handleResponse = useCallback(
    (assistant: AssistantResponse | undefined, heard?: string) => {
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
      if (heard !== undefined) setTranscript(heard);
      const v = assistantView(assistant);
      setView(v);
      setPhase(v.tone === 'error' ? 'error' : 'done');
      if (v.refresh) router.refresh();
    },
    [router]
  );

  const sendText = useCallback(
    async (spoken: string, busyPhase: VoicePhase = 'understanding') => {
      const value = spoken.trim();
      if (!value) return;
      setTranscript(value);
      setView(null);
      setPhase(busyPhase);
      setLastSent({ kind: 'text', value });
      try {
        const res = await fetch('/api/voice/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spokenText: value, context: screenRef.current?.context }),
        });
        const data = await res.json().catch(() => null);
        handleResponse(data?.assistant);
      } catch {
        handleResponse(undefined);
      }
    },
    [handleResponse]
  );

  const sendAudio = useCallback(
    (blob: Blob) => {
      setView(null);
      setTranscript('');
      setPhase('uploading');
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `fala.${ext}`);
      if (screenRef.current) form.append('context', JSON.stringify(screenRef.current.context));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/voice/transcribe');
      xhr.upload.onload = () => {
        setPhase('transcribing');
        phaseTimer.current = setTimeout(() => setPhase('understanding'), 1500);
      };
      xhr.onload = () => {
        let data: { transcribedText?: string; processResult?: { assistant?: AssistantResponse }; assistant?: AssistantResponse } | null = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (data?.transcribedText) setLastSent({ kind: 'text', value: data.transcribedText });
        handleResponse(data?.processResult?.assistant ?? data?.assistant, data?.transcribedText ?? '');
      };
      xhr.onerror = () => handleResponse(undefined);
      xhr.send(form);
    },
    [handleResponse]
  );

  const recorder = useRecorder(sendAudio);

  const startRecording = useCallback(async () => {
    setMicMessage(null);
    setView(null);
    setTranscript('');
    const error = await recorder.start();
    if (error) {
      setTextMode(true);
      setPhase('idle');
      setMicMessage(
        error === 'denied'
          ? 'O microfone está bloqueado. Libere nas configurações do navegador ou digite abaixo.'
          : 'Não consegui usar o microfone aqui. Digite o que aconteceu.'
      );
      return;
    }
    setPhase('recording');
  }, [recorder]);

  const toggleRecording = useCallback(async () => {
    if (recorder.recording) {
      const blob = await recorder.stop();
      if (blob && blob.size > 0) sendAudio(blob);
      else setPhase('idle');
      return;
    }
    await startRecording();
  }, [recorder, sendAudio, startRecording]);

  const open = useCallback(
    (options?: { autoStart?: boolean }) => {
      returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      setIsOpen(true);
      setView(null);
      setTranscript('');
      setPhase('idle');
      setMicMessage(null);
      if (options?.autoStart && recorder.supported) void startRecording();
    },
    [recorder.supported, startRecording]
  );

  const close = useCallback(() => {
    recorder.cancel();
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    setIsOpen(false);
    setPhase('idle');
    setTextMode(false);
    setText('');
    returnFocusRef.current?.focus?.();
  }, [recorder]);

  const undo = useCallback(
    async (operationId: string) => {
      setPhase('executing');
      try {
        const res = await fetch('/api/operations/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationId }),
        });
        const data = await res.json().catch(() => null);
        handleResponse(data?.assistant);
      } catch {
        handleResponse(undefined);
      }
    },
    [handleResponse]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    micButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [isOpen, close]);

  const api = useMemo<VoiceApi>(() => ({ open, setScreen, clearScreen }), [open, setScreen, clearScreen]);
  const busy = isBusyPhase(phase);

  return (
    <VoiceContext.Provider value={api}>
      {children}
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} aria-hidden />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-title"
            className="safe-bottom relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0e1422] p-5 shadow-2xl sm:rounded-3xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="voice-title" className="text-xl font-bold text-white">
                  Falar
                </h2>
                {screen ? <p className="mt-0.5 truncate text-sm text-emerald-300">Sobre: {screen.label}</p> : <p className="mt-0.5 text-sm text-slate-400">Conte o que aconteceu</p>}
              </div>
              <button type="button" onClick={close} aria-label="Fechar" className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 hover:bg-white/10">
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>

            {transcript ? (
              <p className="mb-3 self-end rounded-2xl rounded-br-md bg-white/7 px-4 py-3 text-base text-slate-100">“{transcript}”</p>
            ) : null}

            <div aria-live="polite" className="space-y-3">
              {view ? <ResponseCard view={view} onChoice={(say) => sendText(say, 'executing')} onUndo={undo} onRetry={() => lastSent && sendText(lastSent.value)} onClose={close} /> : null}
            </div>

            {micMessage ? <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-base text-amber-100">{micMessage}</p> : null}

            {!textMode ? (
              <div className="mt-5 flex flex-col items-center gap-3">
                <button
                  ref={micButtonRef}
                  type="button"
                  onClick={toggleRecording}
                  disabled={busy}
                  aria-label={recorder.recording ? 'Parar e enviar' : 'Começar a falar'}
                  className={`flex h-24 w-24 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
                    recorder.recording ? 'mic-recording bg-rose-500 text-white' : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                  }`}
                >
                  {busy ? <Spinner className="h-8 w-8" /> : recorder.recording ? <Square className="h-9 w-9" aria-hidden /> : <Mic className="h-10 w-10" aria-hidden />}
                </button>
                <p className="text-base font-medium text-slate-200" role="status">
                  {recorder.recording ? `${PHASE_LABEL.recording} ${formatSeconds(recorder.seconds)} — toque para enviar` : busy ? PHASE_LABEL[phase] : view?.awaitingAnswer ? 'Toque e responda' : PHASE_LABEL.idle}
                </p>
              </div>
            ) : (
              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendText(text);
                  setText('');
                }}
              >
                <label htmlFor="voice-text" className="block text-sm font-medium text-slate-300">
                  {view?.awaitingAnswer ? 'Sua resposta' : 'O que aconteceu?'}
                </label>
                <textarea
                  id="voice-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Ex.: Carlos pagou 500 no Pix"
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-base text-white focus:border-emerald-400"
                />
                <Button type="submit" className="w-full" loading={busy} disabled={!text.trim()}>
                  Enviar
                </Button>
                {busy ? <p className="text-center text-base text-slate-300" role="status">{PHASE_LABEL[phase]}</p> : null}
              </form>
            )}

            <button
              type="button"
              onClick={() => {
                recorder.cancel();
                setPhase('idle');
                setTextMode((v) => !v);
              }}
              className="mx-auto mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-base text-slate-400 hover:text-white"
            >
              {textMode ? <Mic className="h-5 w-5" aria-hidden /> : <Keyboard className="h-5 w-5" aria-hidden />}
              {textMode ? 'Usar o microfone' : 'Prefere digitar?'}
            </button>

            {!view && !transcript && !recorder.recording && !busy ? (
              <div className="mt-4 border-t border-white/5 pt-4">
                <p className="mb-2 text-sm text-slate-500">Exemplos:</p>
                <ul className="space-y-1.5">
                  {EXAMPLES.map((ex) => (
                    <li key={ex} className="text-base italic text-slate-400">“{ex}”</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </VoiceContext.Provider>
  );
}

function ResponseCard({
  view,
  onChoice,
  onUndo,
  onRetry,
  onClose,
}: {
  view: AssistantView;
  onChoice: (say: string) => void;
  onUndo: (operationId: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const style = {
    success: { box: 'border-emerald-500/40 bg-emerald-500/10', icon: <CheckCircle2 className="h-6 w-6 text-emerald-300" aria-hidden />, title: 'text-emerald-200' },
    info: { box: 'border-sky-500/30 bg-sky-500/10', icon: <Info className="h-6 w-6 text-sky-300" aria-hidden />, title: 'text-sky-200' },
    question: { box: 'border-amber-500/40 bg-amber-500/10', icon: <HelpCircle className="h-6 w-6 text-amber-300" aria-hidden />, title: 'text-amber-200' },
    error: { box: 'border-rose-500/40 bg-rose-500/10', icon: <TriangleAlert className="h-6 w-6 text-rose-300" aria-hidden />, title: 'text-rose-200' },
  }[view.tone];

  return (
    <div className={`rounded-2xl border p-4 ${style.box}`}>
      <div className="flex items-center gap-2">
        {style.icon}
        <p className={`text-lg font-bold ${style.title}`}>{view.title}</p>
      </div>
      <p className="mt-2 text-base leading-relaxed text-slate-100">{view.message}</p>

      {view.choices.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {view.choices.map((c) => (
            <Button key={c.say} variant="secondary" className="w-full justify-start text-left" onClick={() => onChoice(c.say)}>
              <span>{c.label}</span>
              {c.detail ? <span className="ml-auto text-sm font-normal text-slate-400">{c.detail}</span> : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {view.undoOperationId ? (
          <Button variant="secondary" size="sm" onClick={() => onUndo(view.undoOperationId!)}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Desfazer
          </Button>
        ) : null}
        {view.retry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : null}
        {view.subscriptionCta ? (
          <Link href="/app/conta" onClick={onClose} className="inline-flex min-h-10 items-center rounded-2xl bg-emerald-500 px-3 text-sm font-semibold text-emerald-950">
            Ver meu plano
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Botão que abre a voz (já gravando). */
export function VoiceButton({ label = 'Falar', variant = 'secondary', className = '' }: { label?: string; variant?: 'primary' | 'secondary' | 'subtle'; className?: string }) {
  const { open } = useVoice();
  return (
    <Button variant={variant} className={className} onClick={() => open({ autoStart: true })}>
      <Mic className="h-5 w-5" aria-hidden /> {label}
    </Button>
  );
}

/** Para páginas Server Component: registra o contexto da tela para a voz. */
export function VoiceScreen({ label, ...context }: VoiceScreenContext & { label: string }) {
  useVoiceScreen(context, label);
  return null;
}
