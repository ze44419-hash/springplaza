'use client';
import { useNotify } from '@/components/layout/Providers';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import clsx from 'clsx';
import PeriodPicker, { type Period } from '@/components/tables/PeriodPicker';
import { ErrorNote, Modal, Spinner } from '@/components/ui/kit';
import ReportTable from '@/components/tables/ReportTable';
import { getTreasury, listTxns, rpc, srcLabel, type Treasury, type TreasuryTxn } from '@/lib/services/finance';
import { fmtDateTime, money } from '@/lib/helpers/format';
import { friendly } from '@/lib/helpers/util';
import s from '../finance.module.css';

/** الخزنة: الرصيد الحالي + كل حركة (قبل / قيمة / بعد) مع النوع والمستخدم والملاحظات. */
export default function TreasuryPage() {
  const notify = useNotify();
  const [t, setT] = useState<Treasury | null>(null);
  const [rows, setRows] = useState<TreasuryTxn[] | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ dir: 'in' | 'out'; amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!period) return;
    try { const [a, b] = await Promise.all([getTreasury(), listTxns(period.from, period.to)]); setT(a); setRows(b); setErr(null); }
    catch (e: any) { setErr(friendly(e.message)); setRows([]); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form) return; setBusy(true); setErr(null);
    try { await rpc('treasury_manual', { p_dir: form.dir, p_amount: Number(form.amount), p_note: form.note }); const was = form; setForm(null); await load(); notify({ title: was.dir === 'in' ? 'تم إيداع المبلغ في الخزنة' : 'تم سحب المبلغ من الخزنة', body: money(Number(was.amount)), tone: 'success' }); }
    catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  const inn = (rows ?? []).filter((r) => r.direction === 'in').reduce((a, r) => a + Number(r.amount), 0);
  const out = (rows ?? []).filter((r) => r.direction === 'out').reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>الخزنة</h1>
        <div className={s.bar}>
          <button className="btn-primary" onClick={() => setForm({ dir: 'in', amount: '', note: '' })}><Plus size={18} /> إيداع / رصيد افتتاحي</button>
          <button className="btn-ghost" onClick={() => setForm({ dir: 'out', amount: '', note: '' })}>سحب</button>
        </div>
      </div>
      <PeriodPicker onChange={setPeriod} />
      <ErrorNote message={form ? null : err} />
      {!t || !rows ? <Spinner /> : (
        <>
          <div className={s.kpis}>
            <div className={s.kpi}><p className={s.k}>الرصيد الحالي</p><p className={clsx('num', s.v)}>{money(t.balance)}</p></div>
            <div className={s.kpi}><p className={s.k}>تحصيل الفترة</p><p className={clsx('num', s.v, s.in)}>{money(inn)}</p></div>
            <div className={s.kpi}><p className={s.k}>صرف الفترة</p><p className={clsx('num', s.v, s.out)}>{money(out)}</p></div>
          </div>
          <ReportTable name="treasury" totals={false} rows={rows} cols={[
            { key: 'txn_no', label: '#' },
            { key: 'at', label: 'التاريخ', get: (r) => fmtDateTime(r.created_at) },
            { key: 'type', label: 'النوع', get: (r) => `${r.direction === 'in' ? 'تحصيل' : 'صرف'} · ${srcLabel[r.source] ?? r.source}` },
            { key: 'balance_before', label: 'الرصيد قبل', kind: 'money' },
            { key: 'amount', label: 'قيمة العملية', get: (r) => `${r.direction === 'in' ? '+' : '-'}${r.amount}` },
            { key: 'balance_after', label: 'الرصيد بعد', kind: 'money' },
            { key: 'user', label: 'المستخدم', get: (r) => r.profiles?.full_name ?? '—' },
            { key: 'note', label: 'ملاحظات' },
          ]} />
        </>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.dir === 'in' ? 'إيداع في الخزنة' : 'سحب من الخزنة'}>
        {form && (
          <div className={s.form}>
            <div><label className="label" htmlFor="t-a">المبلغ</label><input id="t-a" dir="ltr" inputMode="decimal" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><label className="label" htmlFor="t-n">ملاحظات</label><input id="t-n" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <ErrorNote message={err} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
