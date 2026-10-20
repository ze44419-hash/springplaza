'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';
import { ErrorNote, Spinner } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { createClient } from '@/lib/supabase/client';
import { money, timeAgo } from '@/lib/format';
import { friendly, toInputDate } from '@/lib/util';
import type { Branch, BranchReportData, ExpenseType, HospitalityRequest } from '@/lib/types';
import s from './BranchReport.module.css';

const TYPE_LABEL: Record<ExpenseType, string> = { operational: 'تشغيلي', establishment: 'تأسيس / تصميم', hospitality: 'ضيافة' };
const monthStart = () => { const d = new Date(); d.setDate(1); return toInputDate(d); };

/**
 * تقرير مفصول لكل فرع (كافيه/قاعة) + مصروفاته + اعتماد الضيافة.
 * allowAll: أدمن/محاسب يقدروا يشوفوا "كل الفروع" ومقارنة بينها. المدير بيشوف فروعه بس (السيرفر بيفرض ده بالـ RLS).
 */
export default function BranchReport({ allowAll, canEstablishment }: { allowAll: boolean; canEstablishment: boolean }) {
  const notify = useNotify();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branch, setBranch] = useState<string>('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(toInputDate(new Date()));
  const [rep, setRep] = useState<BranchReportData | null>(null);
  const [cmp, setCmp] = useState<{ b: Branch; r: BranchReportData }[]>([]);
  const [pend, setPend] = useState<HospitalityRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [x, setX] = useState({ type: 'operational' as ExpenseType, category: '', amount: '', description: '' });

  useEffect(() => {
    void createClient().from('my_branches').select('*').order('type').order('name').then(({ data }) => {
      const list = (data ?? []) as Branch[]; setBranches(list);
      if (!allowAll && list[0]) setBranch(list[0].id);
    });
  }, [allowAll]);

  const load = useCallback(async () => {
    if (!branches) return;
    const sb = createClient(); setErr(null);
    const call = (id: string | null) => sb.rpc('branch_report', { p_from: from, p_to: to, p_branch: id });
    const r = await call(branch || null);
    if (r.error) return setErr(friendly(r.error.message));
    setRep(r.data as BranchReportData);
    if (!branch && allowAll) {
      const all = await Promise.all(branches.map(async (b) => ({ b, r: (await call(b.id)).data as BranchReportData })));
      setCmp(all.filter((a) => a.r));
    } else setCmp([]);
    const h = await sb.from('hospitality_requests').select('*, orders(order_no, branch_id, order_items(name, qty))').is('approved_by_admin', null).order('created_at');
    setPend(((h.data ?? []) as any[]).filter((q) => !branch || q.orders?.branch_id === branch));
  }, [branches, branch, from, to, allowAll]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { // إشعارات الضيافة الجديدة (الـ RLS بيحصرها على نطاق المسؤول)
    const sb = createClient();
    const ch = sb.channel('branch-hosp').on('postgres_changes', { event: '*', schema: 'public', table: 'hospitality_requests' }, (e) => {
      if (e.eventType === 'INSERT') notify({ title: 'طلب ضيافة جديد', body: 'مستني اعتمادك', tone: 'info', sound: 'newOrder' });
      void load();
    }).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(q: HospitalityRequest, ok: boolean) {
    const { error } = await createClient().rpc('decide_hospitality_request', { p_id: q.id, p_approve: ok, p_notes: null });
    if (error) return setErr(friendly(error.message));
    notify({ title: ok ? 'اتسجّل مصروف ضيافة وخصمنا المكونات' : 'تم رفض الضيافة', tone: ok ? 'success' : 'info' }); void load();
  }
  async function addExpense() {
    const { error } = await createClient().rpc('add_branch_expense', { p_branch: branch || null, p_type: x.type, p_category: x.category, p_description: x.description, p_amount: Number(x.amount) });
    if (error) return setErr(friendly(error.message));
    setX({ ...x, category: '', amount: '', description: '' }); notify({ title: 'اتسجّل المصروف', tone: 'success' }); void load();
  }

  if (!branches) return <Spinner />;
  const K = ({ k, v, key2, neg }: { k: string; v: number; key2?: boolean; neg?: boolean }) =>
    <div className={clsx(s.kpi, key2 && s.kpiKey)}><p className={s.k}>{k}</p><p className={clsx(s.v, neg && v < 0 && s.neg)}><span className="num">{money(v)}</span></p></div>;
  const items = (q: HospitalityRequest) => (q.orders?.order_items ?? []).map((i) => `${i.name} ×${i.qty}`).join('، ');

  return (
    <div className={s.page}>
      <div className={s.bar}>
        <div><label className="label" htmlFor="br">الفرع</label>
          <select id="br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {allowAll && <option value="">كل الفروع</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.type === 'cafe' ? 'كافيه' : 'قاعة'} · {b.name}</option>)}
          </select></div>
        <div><label className="label" htmlFor="f">من</label><input id="f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label" htmlFor="t">إلى</label><input id="t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <ErrorNote message={err} />

      {rep && <>
        <div className={s.grid}>
          <K k="الإيرادات" v={rep.revenue} /><K k="تكلفة الخامات" v={rep.cogs} /><K k="مصاريف تشغيلية" v={rep.operational} /><K k="مصاريف ضيافة" v={rep.hospitality} />
          <K k="صافي قبل التأسيس" v={rep.net_before_establishment} key2 neg /><K k="مصاريف تأسيس / تصميم" v={rep.establishment} /><K k="الصافي النهائي" v={rep.net} key2 neg />
        </div>
        {rep.by_category.length > 0 && <div className={s.box}>{rep.by_category.map((c, i) => (
          <div key={i} className={s.row}><span>{c.category} <span className={s.meta}>· {TYPE_LABEL[c.expense_type]}</span></span><b className="num">{money(c.total)}</b></div>))}</div>}
      </>}

      {cmp.length > 0 && <section><h2 className={s.h2}>مقارنة الفروع (منفصلة تمامًا)</h2><div className={s.box}>{cmp.map(({ b, r }) => (
        <div key={b.id} className={s.row}><b>{b.type === 'cafe' ? 'كافيه' : 'قاعة'} · {b.name}</b>
          <span className="num">إيراد {money(r.revenue)} · مصاريف {money(r.operational + r.hospitality + r.establishment)} · صافي {money(r.net)}</span></div>))}</div></section>}

      {pend.length > 0 && <section><h2 className={s.h2}>ضيافة مستنية اعتمادك</h2>
        {pend.map((q) => (
          <div key={q.id} className={clsx(s.kpi, s.wait)}>
            <div className={s.row}><b>أوردر <bdi>#{q.orders?.order_no}</bdi></b><b className="num">{money(q.amount)}</b></div>
            <p className={s.meta}>{items(q)} · {timeAgo(q.created_at)}</p>
            <div className={s.actions}>
              <button className="btn btn-primary btn-sm" onClick={() => decide(q, true)}><Check size={16} /> اعتماد كمصروف ضيافة</button>
              <button className="btn btn-ghost btn-sm" onClick={() => decide(q, false)}><X size={16} /> رفض</button>
            </div>
          </div>))}</section>}

      <section><h2 className={s.h2}>مصروف جديد {branch ? 'على الفرع المحدد' : '(عام / مشترك)'}</h2>
        <div className={s.form}>
          <select className="input" value={x.type} onChange={(e) => setX({ ...x, type: e.target.value as ExpenseType })}>
            <option value="operational">تشغيلي</option><option value="hospitality">ضيافة</option>{canEstablishment && <option value="establishment">تأسيس / تصميم</option>}
          </select>
          <input className="input" placeholder="البند" value={x.category} onChange={(e) => setX({ ...x, category: e.target.value })} />
          <input className="input" dir="ltr" inputMode="decimal" placeholder="المبلغ" value={x.amount} onChange={(e) => setX({ ...x, amount: e.target.value })} />
          <input className="input" placeholder="بيان (اختياري)" value={x.description} onChange={(e) => setX({ ...x, description: e.target.value })} />
          <button className="btn btn-primary" disabled={!x.category.trim() || !(Number(x.amount) > 0) || (!branch && !allowAll)} onClick={addExpense}>حفظ</button>
        </div></section>
    </div>
  );
}
