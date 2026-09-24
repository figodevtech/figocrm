'use client';
// Gravação de áudio no navegador (MediaRecorder). Toque para começar, toque para parar; para sozinho em 60s.
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_SECONDS = 60;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export type RecorderError = 'unsupported' | 'denied' | 'failed';

export function useRecorder(onAutoStop: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  const autoStopRef = useRef(onAutoStop);
  useEffect(() => {
    autoStopRef.current = onAutoStop;
  }, [onAutoStop]);

  const supported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<RecorderError | null> => {
    if (!supported) return 'unsupported';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }) : null;
        const resolve = resolveRef.current;
        resolveRef.current = null;
        cleanup();
        if (resolve) resolve(blob);
        else if (blob) autoStopRef.current(blob);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS && recorderRef.current?.state === 'recording') recorderRef.current.stop();
      }, 250);
      return null;
    } catch (err) {
      cleanup();
      const name = err instanceof DOMException ? err.name : '';
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed';
    }
  }, [cleanup, supported]);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state !== 'recording') {
          cleanup();
          resolve(null);
          return;
        }
        resolveRef.current = resolve;
        recorder.stop();
      }),
    [cleanup]
  );

  const cancel = useCallback(() => {
    resolveRef.current = () => undefined;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else cleanup();
  }, [cleanup]);

  return { supported, recording, seconds, start, stop, cancel };
}
