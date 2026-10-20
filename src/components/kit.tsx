'use client';
import { useEffect, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import clsx from 'clsx';
import type { OrderStatus } from '@/lib/types';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-[2px] p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={clsx('max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          <button className="rounded-xl p-2 hover:bg-petal-100" onClick={onClose} aria-label="إغلاق"><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Spinner = ({ label = 'جاري التحميل' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 p-10 text-bark-400"><Loader2 className="animate-spin" size={20} /> {label}…</div>
);

export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="rounded-xl2 border-2 border-dashed border-petal-200 p-8 text-center">
    <p className="font-display text-lg font-semibold">{title}</p>
    {hint && <p className="mt-1 text-sm text-bark-500">{hint}</p>}
  </div>
);

export const ErrorNote = ({ message }: { message: string | null }) =>
  message ? <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/50 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300">{message}</p> : null;

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: 'bg-blossom-light text-blossom-ink',
  preparing: 'bg-sun-light text-sun-ink',
  ready: 'bg-fern-light text-fern-ink',
  completed: 'bg-petal-100 text-bark-500',
  cancelled: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300',
};
const STATUS_LABEL: Record<OrderStatus, string> = { new: 'جديد', preparing: 'قيد التحضير', ready: 'جاهز', completed: 'مدفوع', cancelled: 'ملغي' };
export const StatusBadge = ({ status }: { status: OrderStatus }) => <span className={clsx('chip', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;

/** Run an async action with loading + error state. */
export function useAction() {
  return { run: async (fn: () => Promise<void>, setBusy: (b: boolean) => void, setErr: (e: string | null) => void) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message ?? 'حصل خطأ'); } finally { setBusy(false); }
  } };
}
