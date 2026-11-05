'use client';
import { useNotify } from '@/components/layout/Providers';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import clsx from 'clsx';
import { ErrorNote, Modal, Spinner } from '@/components/ui/kit';
import ReportTable from '@/components/tables/ReportTable';
import { createClient } from '@/lib/supabase/client';
import { rpc } from '@/lib/services/finance';
import { money } from '@/lib/helpers/format';
import { friendly, must, toInputDate } from '@/lib/helpers/util';
import s from '../finance.module.css';

type Asset = { id: string; name: string; category: string; purchase_date: string; cost: number; salvage_value: number; life_months: number; status: string; monthly_dep: number; accumulated: number; book_value: number };
const CATS = ['أجهزة', 'أثاث', 'معدات', 'ديكور', 'أخرى'];
const blank = { name: '', category: 'أجهزة', purchase_date: toInputDate(new Date()), cost: '', salvage_value: '', life_months: '60', location: '', from_treasury: false };

/** وحدة الأصول: تسجيل + إهلاك قسط ثابت شهري + القيمة الدفترية. */
export default function AssetsPage() {
  const notify = useNotify();
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(((await rpc('report_assets')) ?? []) as Asset[]); setErr(null); } catch (e: any) { setErr(friendly(e.message)); setRows([]); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form) return; setBusy(true); setErr(null);
    try {
      await rpc('asset_add', { p: { name: form.name, category: form.category, purchase_date: form.purchase_date, cost: Number(form.cost), salvage_value: Number(form.salvage_value) || 0, life_months: Number(form.life_months) || 60, location: form.location }, p_from_treasury: form.from_treasury });
      setForm(null); await load(); notify({ title: 'تم تسجيل الأصل', tone: 'success' });
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  async function dispose(a: Asset) {
    if (!confirm(`إخراج «${a.name}» من الخدمة؟`)) return;
    try { must(await createClient().from('assets').update({ status: 'disposed' }).eq('id', a.id).select()); await load(); notify({ title: 'تم استبعاد الأصل', tone: 'success' }); } catch (e: any) { const m = friendly(e.message); setErr(m); notify({ title: 'تعذّر استبعاد الأصل', body: m, tone: 'error' }); }
  }
  const live = (rows ?? []).filter((a) => a.status === 'active');

  return (
    <div className={s.page}>
      <div className={s.head}><h1 className={s.title}>الأصول</h1><button className="btn-primary" onClick={() => setForm(blank)}><Plus size={18} /> أصل جديد</button></div>
      <ErrorNote message={form ? null : err} />
      {!rows ? <Spinner /> : (
        <>
          <div className={s.kpis}>
            <div className={s.kpi}><p className={s.k}>عدد الأصول</p><p className={clsx('num', s.v)}>{live.length}</p></div>
            <div className={s.kpi}><p className={s.k}>إجمالي التكلفة</p><p className={clsx('num', s.v)}>{money(live.reduce((a, r) => a + r.cost, 0))}</p></div>
            <div className={s.kpi}><p className={s.k}>مجمع الإهلاك</p><p className={clsx('num', s.v)}>{money(live.reduce((a, r) => a + r.accumulated, 0))}</p></div>
            <div className={s.kpi}><p className={s.k}>القيمة الدفترية</p><p className={clsx('num', s.v)}>{money(live.reduce((a, r) => a + r.book_value, 0))}</p></div>
          </div>
          <ReportTable name="assets" rows={rows} cols={[
            { key: 'name', label: 'الأصل' }, { key: 'category', label: 'التصنيف' }, { key: 'purchase_date', label: 'تاريخ الشراء' },
            { key: 'cost', label: 'التكلفة', kind: 'money' }, { key: 'monthly_dep', label: 'إهلاك شهري', kind: 'money' },
            { key: 'accumulated', label: 'مجمع الإهلاك', kind: 'money' }, { key: 'book_value', label: 'القيمة الدفترية', kind: 'money' },
            { key: 'status', label: 'الحالة', get: (r) => (r.status === 'active' ? 'في الخدمة' : 'خرج من الخدمة') }]} />
          {live.length > 0 && <div className={clsx(s.bar, s.noPrint)}>{live.map((a) => <button key={a.id} className="btn-ghost btn-sm" onClick={() => dispose(a)}>إخراج: {a.name}</button>)}</div>}
        </>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="أصل جديد">
        {form && <div className={s.form}>
          <div><label className="label" htmlFor="a-n">اسم الأصل</label><input id="a-n" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className={s.row2}>
            <div><label className="label" htmlFor="a-c">التصنيف</label><select id="a-c" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="a-d">تاريخ الشراء</label><input id="a-d" type="date" dir="ltr" className="input" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
          </div>
          <div className={s.row2}>
            <div><label className="label" htmlFor="a-p">التكلفة</label><input id="a-p" dir="ltr" inputMode="decimal" className="input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
            <div><label className="label" htmlFor="a-s">قيمة الخردة</label><input id="a-s" dir="ltr" inputMode="decimal" className="input" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: e.target.value })} /></div>
          </div>
          <div className={s.row2}>
            <div><label className="label" htmlFor="a-l">العمر الافتراضي (شهور)</label><input id="a-l" dir="ltr" inputMode="numeric" className="input" value={form.life_months} onChange={(e) => setForm({ ...form, life_months: e.target.value })} /></div>
            <div><label className="label" htmlFor="a-loc">المكان</label><input id="a-loc" className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.from_treasury} onChange={(e) => setForm({ ...form, from_treasury: e.target.checked })} /> الصرف من الخزنة</label>
          <ErrorNote message={err} />
          <button className="btn-primary w-full" disabled={busy || !form.name.trim() || !(Number(form.cost) >= 0) || form.cost === ''} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ</button>
        </div>}
      </Modal>
    </div>
  );
}
