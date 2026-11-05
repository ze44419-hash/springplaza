'use client';
import { useNotify } from '@/components/layout/Providers';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/ui/kit';
import { createClient } from '@/lib/supabase/client';
import { rpc } from '@/lib/services/finance';
import { money } from '@/lib/helpers/format';
import { friendly, must, toInputDate } from '@/lib/helpers/util';
import type { Ingredient } from '@/lib/types';
import s from '../finance.module.css';

type Sup = { id: string; name: string; phone: string | null; supplied: number; paid: number; due: number; invoices: number };
type Line = { ingredient_id: string; name: string; qty: string; unit_cost: string };
const blankLine = (): Line => ({ ingredient_id: '', name: '', qty: '', unit_cost: '' });

/** الموردين + فواتير المشتريات (بتدخّل الكميات المخزن) + سداد المورد (بيخصم من الخزنة). */
export default function SuppliersPage() {
  const notify = useNotify();
  const sb = createClient();
  const [rows, setRows] = useState<Sup[] | null>(null);
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sup, setSup] = useState<{ name: string; phone: string } | null>(null);
  const [pur, setPur] = useState<{ supplier_id: string; date: string; paid: string; notes: string; lines: Line[] } | null>(null);
  const [pay, setPay] = useState<{ s: Sup; amount: string } | null>(null);

  const load = useCallback(async () => {
    try { setRows(((await rpc('report_suppliers')) ?? []) as Sup[]); setErr(null); } catch (e: any) { setErr(friendly(e.message)); setRows([]); }
  }, []);
  useEffect(() => { void load(); void sb.from('ingredients').select('*').order('name').then(({ data }) => setIngs((data ?? []) as Ingredient[])); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, done: () => void) => { setBusy(true); setErr(null); try { await fn(); done(); await load(); notify({ title: 'تم الحفظ', tone: 'success' }); } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); } };
  const total = pur ? pur.lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0) : 0;
  const setLine = (i: number, v: Partial<Line>) => pur && setPur({ ...pur, lines: pur.lines.map((l, j) => (j === i ? { ...l, ...v } : l)) });

  return (
    <div className={s.page}>
      <div className={s.head}><h1 className={s.title}>الموردين والمشتريات</h1>
        <div className={s.bar}>
          <button className="btn-primary" onClick={() => setPur({ supplier_id: rows?.[0]?.id ?? '', date: toInputDate(new Date()), paid: '', notes: '', lines: [blankLine()] })}><Plus size={18} /> فاتورة مشتريات</button>
          <button className="btn-ghost" onClick={() => setSup({ name: '', phone: '' })}>مورد جديد</button>
        </div></div>
      <ErrorNote message={sup || pur || pay ? null : err} />
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="مفيش موردين" hint="ضيف مورد وبعدين سجّل فاتورة مشتريات." /> : (
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>المورد</th><th>الفواتير</th><th>التوريدات</th><th>المدفوع</th><th>المستحق</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}{r.phone && <div dir="ltr" className={s.k}>{r.phone}</div>}</td><td className="num">{r.invoices}</td>
              <td className="num">{money(r.supplied)}</td><td className="num">{money(r.paid)}</td><td className={clsx('num', r.due > 0 && s.out)}>{money(r.due)}</td>
              <td>{r.due > 0 && <button className="btn-ghost btn-sm" onClick={() => setPay({ s: r, amount: String(r.due) })}>سداد</button>}</td></tr>))}</tbody></table></div>
      )}

      <Modal open={!!sup} onClose={() => setSup(null)} title="مورد جديد">
        {sup && <div className={s.form}>
          <div><label className="label" htmlFor="sp-n">الاسم</label><input id="sp-n" className="input" value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="sp-p">الموبايل</label><input id="sp-p" dir="ltr" className="input" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></div>
          <ErrorNote message={err} />
          <button className="btn-primary w-full" disabled={busy || !sup.name.trim()} onClick={() => run(async () => must(await sb.from('suppliers').insert({ name: sup.name.trim(), phone: sup.phone.trim() || null }).select()), () => setSup(null))}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ</button>
        </div>}
      </Modal>

      <Modal open={!!pur} onClose={() => setPur(null)} wide title="فاتورة مشتريات">
        {pur && <div className={s.form}>
          <div className={s.row2}>
            <div><label className="label" htmlFor="pu-s">المورد</label><select id="pu-s" className="input" value={pur.supplier_id} onChange={(e) => setPur({ ...pur, supplier_id: e.target.value })}>
              <option value="">— بدون مورد —</option>{(rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label" htmlFor="pu-d">التاريخ</label><input id="pu-d" type="date" dir="ltr" className="input" value={pur.date} onChange={(e) => setPur({ ...pur, date: e.target.value })} /></div>
          </div>
          {pur.lines.map((l, i) => (
            <div key={i} className={s.bar}>
              <select aria-label="الخامة" className="input" style={{ flex: '2 1 160px' }} value={l.ingredient_id} onChange={(e) => setLine(i, { ingredient_id: e.target.value, name: ings.find((x) => x.id === e.target.value)?.name ?? l.name })}>
                <option value="">صنف حر (بدون مخزون)</option>{ings.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
              {!l.ingredient_id && <input aria-label="اسم الصنف" className="input" style={{ flex: '2 1 140px' }} placeholder="اسم الصنف" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />}
              <input aria-label="الكمية" dir="ltr" inputMode="decimal" className="input" style={{ flex: '1 1 80px' }} placeholder="الكمية" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <input aria-label="سعر الوحدة" dir="ltr" inputMode="decimal" className="input" style={{ flex: '1 1 90px' }} placeholder="سعر الوحدة" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
              {pur.lines.length > 1 && <button className="btn-ghost btn-sm" aria-label="حذف السطر" onClick={() => setPur({ ...pur, lines: pur.lines.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>}
            </div>
          ))}
          <button className="btn-ghost btn-sm" onClick={() => setPur({ ...pur, lines: [...pur.lines, blankLine()] })}><Plus size={16} /> سطر</button>
          <div className={s.row2}>
            <div><label className="label" htmlFor="pu-p">المدفوع الآن (من الخزنة)</label><input id="pu-p" dir="ltr" inputMode="decimal" className="input" value={pur.paid} onChange={(e) => setPur({ ...pur, paid: e.target.value })} /></div>
            <div><label className="label" htmlFor="pu-n">ملاحظات</label><input id="pu-n" className="input" value={pur.notes} onChange={(e) => setPur({ ...pur, notes: e.target.value })} /></div>
          </div>
          <p className={s.k}>الإجمالي: <b className="num">{money(total)}</b> · الآجل: <b className="num">{money(Math.max(0, total - (Number(pur.paid) || 0)))}</b></p>
          <ErrorNote message={err} />
          <button className="btn-primary w-full" disabled={busy || total <= 0} onClick={() => run(() => rpc('purchase_save', { p: {
            supplier_id: pur.supplier_id || null, purchase_date: pur.date, paid: Number(pur.paid) || 0, notes: pur.notes,
            items: pur.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ ingredient_id: l.ingredient_id || null, name: l.name, qty: Number(l.qty), unit_cost: Number(l.unit_cost) || 0 })) } }), () => setPur(null))}>
            {busy && <Loader2 className="animate-spin" size={18} />} حفظ الفاتورة</button>
        </div>}
      </Modal>

      <Modal open={!!pay} onClose={() => setPay(null)} title={pay ? `سداد ${pay.s.name}` : ''}>
        {pay && <div className={s.form}>
          <p className={s.k}>المستحق: <b className="num">{money(pay.s.due)}</b></p>
          <div><label className="label" htmlFor="sy-a">المبلغ</label><input id="sy-a" dir="ltr" inputMode="decimal" className="input" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <ErrorNote message={err} />
          <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => rpc('supplier_pay', { p_supplier: pay.s.id, p_amount: Number(pay.amount), p_note: null }), () => setPay(null))}>{busy && <Loader2 className="animate-spin" size={18} />} تأكيد السداد</button>
        </div>}
      </Modal>
    </div>
  );
}
