'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, ShoppingCart, Truck } from 'lucide-react';
import PeriodPicker, { type Period } from '@/components/PeriodPicker';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { nurseryItems, nurseryRecord, nurseryReport, nurseryStaff } from '@/lib/nursery';
import { money, qtyFmt } from '@/lib/format';
import { friendly, must, toInputDate } from '@/lib/util';
import type { NurseryItem, NurseryReportData } from '@/lib/types';
import s from '../expenses/expenses.module.css';

type Dlg = { kind: 'item'; v: Partial<NurseryItem> } | { kind: 'txn'; type: 'purchase' | 'sale'; item: string; qty: string; price: string; staff: string } | { kind: 'exp'; category: string; amount: string; description: string; staff: string } | null;

export default function NurseryPage() {
  const sb = createClient();
  const [period, setPeriod] = useState<Period | null>(null);
  const [rep, setRep] = useState<NurseryReportData | null>(null);
  const [items, setItems] = useState<NurseryItem[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p: Period) => {
    setPeriod(p);
    try {
      const [r, i, st] = await Promise.all([nurseryReport(p.from, p.to), nurseryItems(), nurseryStaff()]);
      setRep(r); setItems(i); setStaff(st); setErr(null);
    } catch (e: any) { setErr(friendly(e.message)); }
  }, []);
  const reload = () => (period ? load(period) : Promise.resolve());

  async function save() {
    if (!dlg) return; setBusy(true); setErr(null);
    try {
      if (dlg.kind === 'item') {
        const v = dlg.v; if (!v.name?.trim()) throw new Error('اكتب اسم الصنف.');
        const row = { name: v.name.trim(), kind: v.kind ?? 'plant', unit_label: v.unit_label || null, cost_price: Number(v.cost_price) || 0, selling_price: Number(v.selling_price) || 0, low_stock_at: Number(v.low_stock_at) || 0, is_active: v.is_active ?? true, ...(v.id ? {} : { quantity: Number(v.quantity) || 0 }) };
        must(v.id ? await sb.from('nursery_inventory').update(row).eq('id', v.id).select() : await sb.from('nursery_inventory').insert(row).select());
      } else if (dlg.kind === 'txn') {
        if (!dlg.item) throw new Error('اختار الصنف.');
        await nurseryRecord({ item: dlg.item, type: dlg.type, qty: Number(dlg.qty), price: dlg.price === '' ? null : Number(dlg.price), staff: dlg.staff || null, date: toInputDate(new Date()) });
      } else {
        const amount = Number(dlg.amount); if (!dlg.category.trim() || !(amount > 0)) throw new Error('اكتب البند والمبلغ.');
        must(await sb.from('nursery_expenses').insert({ category: dlg.category.trim(), amount, description: dlg.description || null, staff_id: dlg.staff || null }).select());
      }
      setDlg(null); await reload();
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  const kpi = (label: string, v: number, tone = '') => (
    <div className="rounded-2xl border-2 border-petal-200 bg-surface p-4"><p className="m-0 text-sm font-bold text-bark-500">{label}</p><p className={`num m-0 text-xl font-extrabold ${tone}`}>{money(v)}</p></div>
  );
  const upd = (patch: any) => dlg && setDlg({ ...dlg, ...patch } as Dlg);

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>المشتل</h1>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setDlg({ kind: 'item', v: { kind: 'plant' } })}><Plus size={18} /> صنف</button>
          <button className="btn-ghost" onClick={() => setDlg({ kind: 'txn', type: 'purchase', item: '', qty: '', price: '', staff: '' })}><Truck size={18} /> توريد</button>
          <button className="btn-ghost" onClick={() => setDlg({ kind: 'txn', type: 'sale', item: '', qty: '', price: '', staff: '' })}><ShoppingCart size={18} /> بيع</button>
          <button className="btn-ghost" onClick={() => setDlg({ kind: 'exp', category: '', amount: '', description: '', staff: '' })}>مصروف مشتل</button>
        </div>
      </div>
      <PeriodPicker onChange={load} />
      {!dlg && <ErrorNote message={err} />}

      {!rep ? <Spinner /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {kpi('المبيعات', rep.revenue)}{kpi('التكلفة (COGS)', rep.cogs)}{kpi('التوريد', rep.purchases)}{kpi('المصروفات', rep.expenses)}
          {kpi('صافي المشتل', rep.net, rep.net < 0 ? 'text-red-700' : 'text-fern-ink')}
        </div>
        {items.length === 0 ? <Empty title="مفيش أصناف" hint="ضيف أول نبات أو مستلزم." /> : (
          <div className={s.tableWrap}><table className={s.table}>
            <thead><tr>{['الصنف', 'النوع', 'المخزون', 'التكلفة', 'البيع', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td className="td font-bold">{i.name}{!i.is_active && ' (معطّل)'}</td>
                <td className="td">{i.kind === 'plant' ? 'نبات' : 'مستلزم'}</td>
                <td className={`td num ${i.quantity <= i.low_stock_at ? 'text-red-700 font-bold' : ''}`}>{qtyFmt(i.quantity)} {i.unit_label}</td>
                <td className="td num">{money(i.cost_price)}</td><td className="td num">{money(i.selling_price)}</td>
                <td className="td"><button className="btn-ghost btn-sm" onClick={() => setDlg({ kind: 'item', v: i })}>تعديل</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {rep.staff.length > 0 && <p className="m-0 font-bold text-bark-500">موظفو المشتل: {rep.staff.map((m) => `${m.name} (مبيعات ${money(m.sales)})`).join(' · ')}</p>}
      </>)}

      <Modal open={!!dlg} onClose={() => setDlg(null)} title={dlg?.kind === 'item' ? (dlg.v.id ? 'تعديل صنف' : 'صنف جديد') : dlg?.kind === 'txn' ? (dlg.type === 'sale' ? 'بيع' : 'توريد') : 'مصروف مشتل'}>
        {dlg && (<div className={s.form}>
          <ErrorNote message={err} />
          {dlg.kind === 'item' && (<>
            <input className="input" placeholder="الاسم" value={dlg.v.name ?? ''} onChange={(e) => upd({ v: { ...dlg.v, name: e.target.value } })} />
            <select className="input" value={dlg.v.kind ?? 'plant'} onChange={(e) => upd({ v: { ...dlg.v, kind: e.target.value } })}><option value="plant">نبات</option><option value="supply">مستلزم</option></select>
            <input className="input" type="number" placeholder="سعر التكلفة" value={dlg.v.cost_price ?? ''} onChange={(e) => upd({ v: { ...dlg.v, cost_price: e.target.value } })} />
            <input className="input" type="number" placeholder="سعر البيع" value={dlg.v.selling_price ?? ''} onChange={(e) => upd({ v: { ...dlg.v, selling_price: e.target.value } })} />
            {!dlg.v.id && <input className="input" type="number" placeholder="الكمية الافتتاحية" value={dlg.v.quantity ?? ''} onChange={(e) => upd({ v: { ...dlg.v, quantity: e.target.value } })} />}
            <input className="input" type="number" placeholder="حد التنبيه" value={dlg.v.low_stock_at ?? ''} onChange={(e) => upd({ v: { ...dlg.v, low_stock_at: e.target.value } })} />
          </>)}
          {dlg.kind === 'txn' && (<>
            <select className="input" value={dlg.item} onChange={(e) => upd({ item: e.target.value })}><option value="">— الصنف —</option>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.name} ({qtyFmt(i.quantity)})</option>)}</select>
            <input className="input" type="number" placeholder="الكمية" value={dlg.qty} onChange={(e) => upd({ qty: e.target.value })} />
            <input className="input" type="number" placeholder={dlg.type === 'sale' ? 'سعر البيع (اختياري)' : 'تكلفة الوحدة (اختياري)'} value={dlg.price} onChange={(e) => upd({ price: e.target.value })} />
            <select className="input" value={dlg.staff} onChange={(e) => upd({ staff: e.target.value })}><option value="">— موظف المشتل —</option>{staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          </>)}
          {dlg.kind === 'exp' && (<>
            <input className="input" placeholder="البند (مياه، سماد، إيجار…)" value={dlg.category} onChange={(e) => upd({ category: e.target.value })} />
            <input className="input" type="number" placeholder="المبلغ" value={dlg.amount} onChange={(e) => upd({ amount: e.target.value })} />
            <input className="input" placeholder="بيان" value={dlg.description} onChange={(e) => upd({ description: e.target.value })} />
          </>)}
          <button className="btn-primary" disabled={busy} onClick={save}>حفظ</button>
        </div>)}
      </Modal>
    </div>
  );
}
