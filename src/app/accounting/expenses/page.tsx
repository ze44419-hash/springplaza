'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import PeriodPicker, { type Period } from '@/components/PeriodPicker';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_CATEGORIES, scopeChip, scopeLabel } from '@/lib/accounting';
import { LOCALE, money } from '@/lib/format';
import { friendly, must, toInputDate } from '@/lib/util';
import type { Branch, Expense, ExpenseScope, ExpenseType } from '@/lib/types';
import s from './expenses.module.css';

const blank = () => ({ id: null as string | null, expense_date: toInputDate(new Date()), scope: 'general' as ExpenseScope, expense_type: 'operational' as ExpenseType, branch_id: '', category: '', description: '', amount: '' });

export default function ExpensesPage() {
  const sb = createClient();
  const [period, setPeriod] = useState<Period | null>(null);
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => { void createClient().from('my_branches').select('*').then(({ data }) => setBranches((data ?? []) as Branch[])); }, []);

  const load = useCallback(async (p: Period) => {
    setPeriod(p); setRows(null);
    try {
      setRows(must(await sb.from('expenses').select('*').gte('expense_date', p.from).lte('expense_date', p.to)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false })) as Expense[]);
      setErr(null);
    } catch (e: any) { setErr(friendly(e.message)); setRows([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form) return;
    const amount = Number(form.amount);
    if (!form.category.trim()) return setErr('اكتب بند المصروف.');
    if (!(amount > 0)) return setErr('اكتب مبلغ أكبر من صفر.');
    setBusy(true); setErr(null);
    try {
      const payload = { expense_date: form.expense_date, scope: form.scope, category: form.category.trim(), description: form.description.trim() || null, amount, expense_type: form.expense_type, branch_id: form.branch_id || null };
      if (form.id) must(await sb.from('expenses').update(payload).eq('id', form.id).select());
      else must(await sb.from('expenses').insert(payload).select());
      setForm(null); if (period) await load(period);
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  async function remove(r: Expense) {
    if (!confirm(`حذف مصروف «${r.category}» بمبلغ ${money(r.amount)}؟`)) return;
    try { must(await sb.from('expenses').delete().eq('id', r.id).select()); if (period) await load(period); } catch (e: any) { setErr(friendly(e.message)); }
  }

  const total = (rows ?? []).reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>المصروفات</h1>
        <button className="btn-primary" onClick={() => { setErr(null); setForm(blank()); }}><Plus size={18} /> مصروف جديد</button>
      </div>
      <PeriodPicker onChange={load} />
      {!form && <ErrorNote message={err} />}
      {rows && <p className={s.total}>إجمالي المصروفات في الفترة: <span className={clsx('num', s.totalValue)}>{money(total)}</span></p>}

      {rows === null ? <Spinner /> : rows.length === 0 ? <Empty title="مفيش مصروفات في الفترة دي" hint="اضغط «مصروف جديد» لتسجيل أول مصروف." /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr>{['التاريخ', 'البند', 'يخص', 'البيان', 'المبلغ'].map((h) => <th key={h} className="th">{h}</th>)}<th className="th" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td num">{new Date(`${r.expense_date}T00:00:00`).toLocaleDateString(LOCALE)}</td>
                  <td className="td font-bold">{r.category}</td>
                  <td className="td"><span className={clsx('chip', scopeChip[r.scope])}>{scopeLabel[r.scope]}</span></td>
                  <td className="td">{r.description ?? '—'}</td>
                  <td className="td num font-bold">{money(r.amount)}</td>
                  <td className="td"><div className={s.actions}>
                    <button className="btn-ghost btn-sm" aria-label="تعديل" onClick={() => { setErr(null); setForm({ id: r.id, expense_date: r.expense_date, scope: r.scope, expense_type: r.expense_type ?? 'operational', branch_id: r.branch_id ?? '', category: r.category, description: r.description ?? '', amount: String(r.amount) }); }}><Pencil size={16} /></button>
                    <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" aria-label="حذف" onClick={() => remove(r)}><Trash2 size={16} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل مصروف' : 'مصروف جديد'}>
        {form && (
          <div className={s.form}>
            <div><label className="label" htmlFor="x-date">التاريخ</label><input id="x-date" type="date" className="input" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
            <div><label className="label" htmlFor="x-scope">المصروف يخص</label>
              <select id="x-scope" className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as ExpenseScope })}>
                {(Object.keys(scopeLabel) as ExpenseScope[]).map((k) => <option key={k} value={k}>{scopeLabel[k]}</option>)}
              </select></div>
            <div><label className="label" htmlFor="x-br">الفرع (فاضي = عام / تأسيس مشترك)</label>
              <select id="x-br" className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">عام</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.type === 'cafe' ? 'كافيه' : 'قاعة'} · {b.name}</option>)}
              </select></div>
            <div><label className="label" htmlFor="x-type">نوع المصروف</label>
              <select id="x-type" className="input" value={form.expense_type} onChange={(e) => setForm({ ...form, expense_type: e.target.value as ExpenseType })}>
                <option value="operational">تشغيلي</option><option value="establishment">تأسيس / تصميم</option><option value="hospitality">ضيافة</option>
              </select></div>
            <div><label className="label" htmlFor="x-cat">البند</label>
              <input id="x-cat" list="x-cats" className="input" placeholder="رواتب، إيجار، كهرباء…" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="x-cats">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
            <div><label className="label" htmlFor="x-amt">المبلغ</label><input id="x-amt" type="number" min={0} inputMode="decimal" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><label className="label" htmlFor="x-desc">البيان (اختياري)</label><input id="x-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <ErrorNote message={err} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ المصروف</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
