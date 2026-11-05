'use client';
import { useNotify } from '@/components/layout/Providers';
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/ui/kit';
import { listReceivables, rpc, type Receivable } from '@/lib/services/finance';
import { fmtDateTime, money } from '@/lib/helpers/format';
import { friendly } from '@/lib/helpers/util';
import s from '../finance.module.css';

/** فلوس بره: المتبقي على الحجوزات/السيشن بعد الإتمام. التحصيل بيحدّث الخزنة وحساب العميل فورًا. */
export default function ReceivablesPage() {
  const notify = useNotify();
  const [rows, setRows] = useState<Receivable[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState<{ r: Receivable; amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => { try { setRows(await listReceivables()); setErr(null); } catch (e: any) { setErr(friendly(e.message)); setRows([]); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!pay) return; setBusy(true); setErr(null);
    try { await rpc('receivable_pay', { p_id: pay.r.id, p_amount: Number(pay.amount), p_note: pay.note || null }); const was = pay; setPay(null); await load(); notify({ title: 'تم التحصيل وتسجيله في الخزنة', body: `${was.r.customer_name} · ${money(Number(was.amount))}`, tone: 'success' }); }
    catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  const shown = (rows ?? []).filter((r) => all || r.status === 'open');
  const due = (rows ?? []).filter((r) => r.status === 'open').reduce((a, r) => a + r.amount - r.paid, 0);

  return (
    <div className={s.page}>
      <div className={s.head}><h1 className={s.title}>فلوس بره</h1>
        <div className={s.bar}>
          <button className={clsx('btn-sm', !all ? 'btn-primary' : 'btn-ghost')} onClick={() => setAll(false)}>المعلّقة</button>
          <button className={clsx('btn-sm', all ? 'btn-primary' : 'btn-ghost')} onClick={() => setAll(true)}>الكل</button>
        </div></div>
      <div className={s.kpis}><div className={s.kpi}><p className={s.k}>إجمالي المعلّق</p><p className={clsx('num', s.v, s.out)}>{money(due)}</p></div></div>
      <ErrorNote message={pay ? null : err} />
      {!rows ? <Spinner /> : shown.length === 0 ? <Empty title="مفيش مبالغ معلّقة" hint="بتظهر هنا تلقائيًا أي مبالغ متبقية بعد إتمام حجز قاعة أو سيشن." /> : (
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>العميل</th><th>البيان</th><th>التاريخ</th><th>الأصلي</th><th>المسدّد</th><th>المتبقي</th><th /></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td>{r.customer_name}{r.customer_phone && <div dir="ltr" className={s.k}>{r.customer_phone}</div>}</td>
              <td>{r.title}</td><td>{fmtDateTime(r.created_at)}</td>
              <td className="num">{money(r.amount)}</td><td className="num">{money(r.paid)}</td><td className={clsx('num', s.out)}>{money(r.amount - r.paid)}</td>
              <td>{r.status === 'open' ? <button className="btn-primary btn-sm" onClick={() => setPay({ r, amount: String(r.amount - r.paid), note: '' })}>تحصيل</button> : <span className="chip bg-fern-light text-fern-ink">اتسدّد</span>}</td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={!!pay} onClose={() => setPay(null)} title={pay ? `تحصيل من ${pay.r.customer_name}` : ''}>
        {pay && (
          <div className={s.form}>
            <p className={s.k}>المتبقي: <b className="num">{money(pay.r.amount - pay.r.paid)}</b></p>
            <div><label className="label" htmlFor="r-a">المبلغ المحصّل</label><input id="r-a" dir="ltr" inputMode="decimal" className="input" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div><label className="label" htmlFor="r-n">ملاحظات</label><input id="r-n" className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
            <ErrorNote message={err} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} تأكيد التحصيل</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
