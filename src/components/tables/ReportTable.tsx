'use client';
import { Download, Printer } from 'lucide-react';
import { Empty } from '@/components/ui/kit';
import { printPage } from '@/components/print/printPage';
import { downloadCsv } from '@/lib/services/finance';
import { money, qtyFmt } from '@/lib/helpers/format';
import s from '@/app/accounting/finance.module.css';

export interface Col<T> { key: keyof T & string | string; label: string; kind?: 'money' | 'qty' | 'text'; get?: (r: T) => string | number | null }

/** جدول تقارير عام + تصدير CSV + طباعة. الإجماليات (totals) تتحسب تلقائيًا للأعمدة المالية. */
export default function ReportTable<T extends Record<string, any>>({ name, cols, rows, totals = true }: { name: string; cols: Col<T>[]; rows: T[]; totals?: boolean }) {
  const val = (r: T, c: Col<T>) => (c.get ? c.get(r) : r[c.key]);
  const fmt = (v: any, c: Col<T>) => (v == null || v === '' ? '—' : c.kind === 'money' ? money(Number(v)) : c.kind === 'qty' ? qtyFmt(Number(v)) : String(v));
  if (!rows.length) return <Empty title="مفيش بيانات في الفترة دي" />;
  return (
    <>
      <div className={`${s.bar} ${s.noPrint}`}>
        <button className="btn-ghost btn-sm" onClick={() => downloadCsv(name, cols.map((c) => c.label), rows.map((r) => cols.map((c) => val(r, c) as any)))}><Download size={16} /> تصدير CSV</button>
        <button className="btn-ghost btn-sm" onClick={printPage}><Printer size={16} /> طباعة</button>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.kind === 'money' || c.kind === 'qty' ? 'num' : undefined}>{fmt(val(r, c), c)}</td>)}</tr>)}</tbody>
          {totals && cols.some((c) => c.kind === 'money') && (
            <tfoot><tr>{cols.map((c, i) => <td key={c.key} className="num" style={{ fontWeight: 800, borderTop: '2px solid var(--petal-200)' }}>
              {c.kind === 'money' ? money(rows.reduce((a, r) => a + Number(val(r, c) ?? 0), 0)) : i === 0 ? 'الإجمالي' : ''}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
    </>
  );
}
