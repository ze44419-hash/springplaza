'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import clsx from 'clsx';
import type { LocalOrder } from '@/lib/types';
import type { ShiftSummary } from '@/lib/shift';
import { fmtDateTime, orderLabel, orderTypeLabel } from '@/lib/format';

/** Roll width in mm — any number. Order tickets / bills take it from the admin's receipt design; this device value is used for shift & report prints. */
export type Paper = number;
export const MIN_PAPER = 30, MAX_PAPER = 210;
export const getPaper = (): Paper => {
  const n = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('paper')) : NaN;
  return Number.isFinite(n) && n >= MIN_PAPER && n <= MAX_PAPER ? n : 80;
};

/** Width (mm) selector for shift / report prints, remembered per device. Type any number or tap a preset. */
export function PaperToggle({ value, onChange }: { value: Paper; onChange: (p: Paper) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (n: number) => { const v = Math.min(MAX_PAPER, Math.max(MIN_PAPER, n)); localStorage.setItem('paper', String(v)); onChange(v); setText(String(v)); };
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-petal-100 p-1" role="group" aria-label="عرض ورق الطباعة (للتقارير وتسليم الشيفت)">
      <Printer size={16} className="ms-2 text-bark-400" />
      {[58, 80].map((p) => (
        <button key={p} onClick={() => commit(p)} className={clsx('rounded-lg px-2.5 py-1.5 text-sm font-bold', value === p ? 'bg-surface shadow' : 'text-bark-500')}>{p}</button>
      ))}
      <input dir="ltr" type="number" inputMode="decimal" min={MIN_PAPER} max={MAX_PAPER} value={text} aria-label="عرض الورق بالمليمتر"
        onChange={(e) => setText(e.target.value)} onBlur={() => { const n = parseFloat(text); commit(Number.isFinite(n) ? n : value); }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-16 rounded-lg border-0 bg-surface px-2 py-1.5 text-center text-sm font-bold text-bark outline-none focus:ring-2 focus:ring-fern" />
      <span className="pe-2 text-xs text-bark-400">مم</span>
    </div>
  );
}

/** Inline style for the printable column: the roll minus the side margins, plus the body font size. */
export const paperStyle = (paper: number, fontPx: number, margin = 4) =>
  ({ width: `${Math.max(20, paper - 2 * margin)}mm`, ['--paper-fs' as string]: `${fontPx}px` });

/**
 * Print pipeline: content is portalled into #print-root (hidden on screen, the only thing visible under
 * @media print), the @page size is set to the chosen roll width, then window.print() is called.
 * `print()` returns a promise that resolves when the job finished — the auto-printer uses it to run jobs one by one.
 * For SILENT printing (no dialog) start Chrome/Edge with --kiosk-printing and make the thermal printer the default.
 */
export function usePrint() {
  const [job, setJob] = useState<{ node: ReactNode; paper: Paper; fs: number; margin: number; done: () => void } | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot(document.getElementById('print-root')), []);

  useEffect(() => {
    if (!job) return;
    let style = document.getElementById('page-size') as HTMLStyleElement | null;
    if (!style) { style = document.createElement('style'); style.id = 'page-size'; document.head.appendChild(style); }
    style.textContent = `@page { size: ${job.paper}mm auto; margin: 0; }`;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; setJob(null); job.done(); };
    window.addEventListener('afterprint', finish, { once: true });
    const t = setTimeout(() => window.print(), 80);
    const guard = setTimeout(finish, 20_000); // some browsers never fire afterprint
    return () => { clearTimeout(t); clearTimeout(guard); window.removeEventListener('afterprint', finish); };
  }, [job]);

  // Jobs run strictly one after another (an auto-printed ticket must never overwrite a receipt being printed).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const print = (node: ReactNode, paper: Paper, fontPx = 13, margin = 4) => {
    const p = chain.current.then(() => new Promise<void>((resolve) => setJob({ node, paper, fs: fontPx, margin, done: resolve })));
    chain.current = p.catch(() => {});
    return p;
  };
  const portal = root && job
    ? createPortal(<div className="paper" style={paperStyle(job.paper, job.fs, job.margin)}>{job.node}</div>, root)
    : null;
  return { print, portal };
}

const n2 = (n: number) => Number(n).toFixed(2);
export const CAFE = process.env.NEXT_PUBLIC_CAFE_NAME || 'سبرينج بلازا كافيه';
const CUR = process.env.NEXT_PUBLIC_CURRENCY_LABEL || 'ج.م';

/** Re-exported so existing imports keep working; the receipt itself lives in ReceiptView. */
export { default as Receipt } from './ReceiptView';

/** Shift-handover receipt: everything the next cashier / the manager needs to check the drawer. */
export function ShiftReceipt({ s }: { s: ShiftSummary }) {
  const diffLabel = s.diff === 0 ? 'مظبوط' : s.diff > 0 ? 'زيادة' : 'عجز';
  return (
    <>
      <h1>{CAFE}</h1>
      <p className="center big">تسليم شيفت</p>
      <div className="rule" />
      <div className="row"><span>الكاشير</span><span>{s.cashier}</span></div>
      <div className="row"><span>بداية الشيفت</span><span>{fmtDateTime(s.openedAt)}</span></div>
      <div className="row"><span>نهاية الشيفت</span><span>{fmtDateTime(s.closedAt)}</span></div>
      <div className="rule" />
      <div className="row"><span>عدد الأوردرات</span><span>{s.orders}</span></div>
      <div className="row"><span>مبيعات كاش</span><span>{n2(s.cash)}</span></div>
      <div className="row"><span>مبيعات كارت</span><span>{n2(s.card)}</span></div>
      {s.discounts > 0 && <div className="row"><span>إجمالي الخصومات</span><span>{n2(s.discounts)}</span></div>}
      <div className="row big"><span>إجمالي المبيعات</span><span>{n2(s.total)}</span></div>
      <div className="rule" />
      <p className="center">حساب الدرج ({CUR})</p>
      <div className="row"><span>رصيد أول الشيفت</span><span>{n2(s.opening)}</span></div>
      <div className="row"><span>+ مبيعات الكاش</span><span>{n2(s.cash)}</span></div>
      <div className="row"><span>المتوقع في الدرج</span><span>{n2(s.expected)}</span></div>
      <div className="row"><span>الفعلي (اللي اتعد)</span><span>{n2(s.counted)}</span></div>
      <div className="row big"><span>{diffLabel}</span><span>{n2(Math.abs(s.diff))}</span></div>
      {s.items.length > 0 && (
        <>
          <div className="rule" />
          <p className="center">الأصناف المباعة</p>
          {s.items.map((it) => <div key={it.name} className="row"><span>{it.qty} × {it.name}</span><span>{n2(it.revenue)}</span></div>)}
        </>
      )}
      <div className="rule" />
      <p>توقيع المسلِّم: ____________</p>
      <p style={{ marginTop: 8 }}>توقيع المستلم: ____________</p>
      <div className="rule" />
      <p className="center">طُبع {fmtDateTime(new Date().toISOString())}</p>
    </>
  );
}
