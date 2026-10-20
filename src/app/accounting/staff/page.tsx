'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { ErrorNote, Spinner } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { useProfile } from '@/hooks/useProfile';
import { createClient } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import { friendly, toInputDate } from '@/lib/util';
import type { Branch, SalaryType, StaffPayroll } from '@/lib/types';
import s from './staff.module.css';

const KIND = { employee: 'موظف', partner: 'شريك', admin: 'أدمن' } as const;
const JOB = { nursery_worker: 'عامل مشتل' } as const;
const blank = { name: '', salary_type: 'monthly' as SalaryType, base_salary: '', branch_id: '', nursery: false, job: '' as '' | 'nursery_worker' };
const monthStart = () => { const d = new Date(); d.setDate(1); return toInputDate(d); };

/** الموظفون والرواتب (مدير + محاسب): الأساسي − السلف − الطلبات الشخصية (بعد الخصم) = صافي المستحق. */
export default function StaffPage() {
  const { profile } = useProfile();
  const notify = useNotify();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<StaffPayroll[] | null>(null);
  const [days, setDays] = useState<Record<string, string>>({});
  const [pct, setPct] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [nur, setNur] = useState<Set<string>>(new Set());
  const [adminDue, setAdminDue] = useState<{ base: number; percent: number; amount: number } | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const [r, st] = await Promise.all([sb.from('staff_payroll').select('*').eq('is_active', true).order('kind').order('name'), sb.from('system_settings').select('employee_discount_percent').maybeSingle()]);
    if (r.error) return setErr(friendly(r.error.message));
    setRows(r.data as StaffPayroll[]); setPct(String(st.data?.employee_discount_percent ?? 0));
    const [b, ad] = await Promise.all([sb.from('branches').select('*').eq('is_active', true).order('name'), sb.rpc('admin_salary_due', { p_from: monthStart(), p_to: toInputDate(new Date()) })]);
    const nu = await sb.from('staff').select('id').eq('nursery_assigned', true); setNur(new Set((nu.data ?? []).map((x: any) => x.id)));
    setBranches((b.data ?? []) as Branch[]); if (!ad.error) setAdminDue(ad.data as any);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const gross = (r: StaffPayroll) => r.kind === 'admin' ? (adminDue?.amount ?? 0) : (r.salary_type === 'daily' ? r.base_salary * (Number(days[r.id]) || 0) : r.base_salary);
  const net = (r: StaffPayroll) => gross(r) - r.advances - r.discounts;
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await p; if (error) return setErr(friendly(error.message));
    setErr(null); if (ok) notify({ title: ok, tone: 'success' }); void load();
  };
  const sb = createClient();

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>الموظفون والرواتب</h1>
        {isAdmin && <button className="btn-primary" onClick={() => setForm(blank)}><Plus size={18} /> موظف جديد</button>}
      </div>
      <ErrorNote message={err} />

      <div className={s.settings}>
        <div><label className="label" htmlFor="pct">خصم الموظفين على الطلبات الشخصية (%)</label>
          <input id="pct" dir="ltr" className="input" inputMode="decimal" disabled={!isAdmin} value={pct} onChange={(e) => setPct(e.target.value)} /></div>
        {isAdmin && <button className="btn btn-ghost" onClick={() => run(sb.from('system_settings').update({ employee_discount_percent: Math.min(Math.max(Number(pct) || 0, 0), 100) }).eq('id', true), 'اتحفظت نسبة الخصم')}>حفظ</button>}
      </div>

      {adminDue && <div className={s.settings}><b>راتب الأدمن ({adminDue.percent}% من صافي الربح قبل مصاريف التأسيس — الشهر الحالي):</b> <b className="num">{money(adminDue.amount)}</b> <span className={s.k}>(الوعاء {money(adminDue.base)})</span></div>}

      {form && (
        <div className={s.form}>
          <input className="input" placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.salary_type} onChange={(e) => setForm({ ...form, salary_type: e.target.value as SalaryType })}><option value="monthly">شهري</option><option value="daily">يومي</option></select>
          <input className="input" dir="ltr" inputMode="decimal" placeholder={form.salary_type === 'daily' ? 'اليومية' : 'الراتب الشهري'} value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} />
          <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className="input" aria-label="الوظيفة" value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value as '' | 'nursery_worker', nursery: e.target.value === 'nursery_worker' || form.nursery })}><option value="">وظيفة عادية</option><option value="nursery_worker">{JOB.nursery_worker}</option></select>
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={form.nursery} onChange={(e) => setForm({ ...form, nursery: e.target.checked })} /> موظف مشتل (راتبه ومصاريفه تتحسب على المشتل)</label>
          <div className={s.actions}>
            <button className="btn-primary" disabled={!form.name.trim()} onClick={async () => { await run(sb.from('staff').insert({ name: form.name.trim(), salary_type: form.salary_type, base_salary: Number(form.base_salary) || 0, branch_id: form.branch_id || null, nursery_assigned: form.nursery || form.job === 'nursery_worker', job_title: form.job || null }), 'اتضاف الموظف'); setForm(null); }}>حفظ</button>
            <button className="btn-ghost" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {!rows ? <Spinner /> : rows.map((r) => (
        <div key={r.id} className={s.card}>
          <div className={s.top}><p className={s.name}>{r.name} <span className={s.chip2}>{KIND[r.kind]}</span>{r.job_title && <span className={s.chip2}>{JOB[r.job_title]}</span>}</p>
            {isAdmin && <span className={s.actions}>
              {r.kind !== 'admin' && <button className="btn-ghost btn-sm" onClick={() => run(sb.from('staff').update({ nursery_assigned: !nur.has(r.id) }).eq('id', r.id), nur.has(r.id) ? 'اتشال من المشتل' : 'اتعيّن للمشتل')}>{nur.has(r.id) ? '🌱 مشتل ✓' : 'تعيين للمشتل'}</button>}
              {r.kind !== 'admin' && <select className="input" aria-label="الوظيفة" value={r.job_title ?? ''} onChange={(e) => run(sb.from('staff').update({ job_title: e.target.value || null, ...(e.target.value === 'nursery_worker' ? { nursery_assigned: true } : {}) }).eq('id', r.id), 'اتحدّثت الوظيفة')}><option value="">وظيفة عادية</option><option value="nursery_worker">{JOB.nursery_worker}</option></select>}
              <select className="input" value={r.salary_type} onChange={(e) => run(sb.from('staff').update({ salary_type: e.target.value }).eq('id', r.id))}><option value="monthly">شهري</option><option value="daily">يومي</option></select>
              <input className={clsx('input', s.days)} dir="ltr" inputMode="decimal" defaultValue={r.base_salary} key={r.id + r.base_salary} onBlur={(e) => Number(e.target.value) !== r.base_salary && run(sb.from('staff').update({ base_salary: Number(e.target.value) || 0 }).eq('id', r.id))} />
            </span>}
          </div>
          <div className={s.grid}>
            <div><p className={s.k}>{r.salary_type === 'daily' ? 'اليومية' : 'الراتب الأساسي'}</p><p className={s.v}><span className="num">{money(r.base_salary)}</span></p></div>
            <div><p className={s.k}>{r.salary_type === 'daily' ? 'عدد الأيام' : 'الإجمالي'}</p>
              {r.salary_type === 'daily'
                ? <input className={clsx('input', s.days)} dir="ltr" inputMode="decimal" value={days[r.id] ?? ''} onChange={(e) => setDays({ ...days, [r.id]: e.target.value })} />
                : <p className={s.v}><span className="num">{money(gross(r))}</span></p>}</div>
            <div><p className={s.k}>السلف</p><p className={s.v}><span className="num">{money(r.advances)}</span></p></div>
            <div><p className={s.k}>خصومات الطلبات ({r.orders})</p><p className={s.v}><span className="num">{money(r.discounts)}</span></p></div>
            <div><p className={s.k}>صافي المستحق</p><p className={clsx(s.v, s.net, net(r) < 0 && s.neg)}><span className="num">{money(net(r))}</span></p></div>
          </div>
          <div className={s.actions}>
            <button className="btn btn-ghost btn-sm" onClick={() => { const a = Number(prompt(`سلفة جديدة لـ ${r.name}؟`)); if (a > 0) void run(sb.rpc('add_staff_advance', { p_staff: r.id, p_amount: a }), 'اتسجلت السلفة'); }}>+ سلفة</button>
            <button className="btn btn-primary btn-sm" onClick={() => confirm(`صرف ${money(net(r))} لـ ${r.name} وتصفير السلف والخصومات؟`) && run(sb.rpc('pay_staff_salary', { p_staff: r.id, p_gross: gross(r) }), 'اتصرف الراتب')}>صرف الراتب</button>
          </div>
        </div>
      ))}
    </div>
  );
}
