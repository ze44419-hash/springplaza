'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, X } from 'lucide-react';
import clsx from 'clsx';
import { startSyncEngine } from '@/lib/sync';
import { playChime, unlockAudio, type ChimeKind } from '@/lib/sound';

interface Toast { id: number; title: string; body?: string; tone: 'info' | 'success' | 'error' }
interface NotifyArgs { title: string; body?: string; tone?: Toast['tone']; sound?: ChimeKind }
const Ctx = createContext<(n: NotifyArgs) => void>(() => {});
export const useNotify = () => useContext(Ctx);

export default function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback(({ title, body, tone = 'info', sound }: NotifyArgs) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, title, body, tone }]);
    if (sound) playChime(sound);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 6000);
  }, []);

  useEffect(() => {
    const stop = startSyncEngine();
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    return () => { stop(); window.removeEventListener('pointerdown', unlock); };
  }, []);

  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 print:hidden" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={clsx('pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border-2 bg-surface p-4 shadow-xl animate-toast',
              t.tone === 'success' && 'border-fern', t.tone === 'info' && 'border-blossom', t.tone === 'error' && 'border-red-500')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 shrink-0 text-fern" /> : t.tone === 'error' ? <AlertTriangle className="mt-0.5 shrink-0 text-red-500" /> : <BellRing className="mt-0.5 shrink-0 text-blossom-ink" />}
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold leading-tight">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-bark-500">{t.body}</p>}
            </div>
            <button className="rounded-lg p-1 text-bark-400 hover:bg-petal-100" aria-label="إغلاق" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={18} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
