'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { listSessions, saveSession, setSessionStatus } from '@/lib/sessions';
import { money } from '@/lib/format';
import { friendly, toInputDate } from '@/lib/util';
import type { PhotoSession, SessionStatus } from '@/lib/types';
import s from './sessions.module.css';

const STATUS: Record<SessionStatus, { label: string; cls: string }> = {
  pending: { label: 'قيد الانتظار', cls: 'bg-petal-100 text-bark-500' },
  confirmed: { label: 'مؤكدة', cls: 'bg-fern-light text-fern-ink' },
  completed: { label: 'تمت', cls: 'bg-fern text-white' },
  cancelled: { label: 'ملغاة', cls: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
};
const blank = { id: null as string | null, session_date: toInputDate(new Date()), session_time: '10:00', customer_name: '', customer_phone: '', price: '', deposit: '', notes: '' };
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

/** حجوزات سيشن التصوير: التاريخ + الوقت + السعر + الدفعة المقدمة (أدمن • محاسب • مسؤول القاعة • مسؤول السيشن). */
export default function SessionsPage() {
  const notify = useNotify();
  const [rows, setRows] = useState<PhotoSession[] | null>(null);
  const [all, setAll] = useState(false);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await listSessions(all ? undefined : toInputDate(new Date()))); setErr(null); }
    catch (e: any) { setErr(friendly(e.message)); setRows([]); }
  }, [all]);
  useEffect(() => { void load(); }, [load]);

  const live = (rows ?? []).filter((r) => r.status !== 'cancelled');
  const total = live.reduce((a, r) => a + Number(r.price), 0);
  const deposits = live.reduce((a, r) => a + Number(r.deposit), 0);

  async function save() {
    if (!form) return; setBusy(true); setErr(null);
    try {
      await saveSession(form.id, { session_date: form.session_date, session_time: form.session_time, customer_name: form.customer_name.trim(), customer_phone: form.customer_phone.trim() || null, price: Number(form.price) || 0, deposit: Number(form.deposit) || 0, notes: form.notes.trim() || null });
      notify({ title: form.id ? 'اتعدّلت السيشن' : 'اتحجزت السيشن', tone: 'success' });
      setForm(null); await load();
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  async function status(r: PhotoSession, st: SessionStatus) {
    if (st === 'cancelled' && !confirm(`إلغاء سيشن ${r.customer_name}؟`)) return;
    try { await setSessionStatus(r.id, st); await load(); } catch (e: any) { setErr(friendly(e.message)); }
  }

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>حجوزات السيشن</h1>
        <button className="btn-primary" onClick={() => { setErr(null); setForm(blank); }}><Plus size={18} /> حجز جديد</button>
      </div>
      <div className={s.tabs}>
        <button className={clsx('btn-sm', !all ? 'btn-primary' : 'btn-ghost')} onClick={() => setAll(false)}>القادمة</button>
        <button className={clsx('btn-sm', all ? 'btn-primary' : 'btn-ghost')} onClick={() => setAll(true)}>الكل</button>
      </div>
      <div className={s.kpis}>
        <div className={s.kpi}><p className={s.k}>عدد الحجوزات</p><p className={s.v}><span className="num">{live.length}</span></p></div>
        <div className={s.kpi}><p className={s.k}>إجمالي الأسعار</p><p className={s.v}><span className="num">{money(total)}</span></p></div>
        <div className={s.kpi}><p className={s.k}>الدفعات المقدمة</p><p className={s.v}><span className="num">{money(deposits)}</span></p></div>
        <div className={s.kpi}><p className={s.k}>المتبقي</p><p className={s.v}><span className="num">{money(total - deposits)}</span></p></div>
      </div>
      <ErrorNote message={form ? null : err} />

      {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="مفيش حجوزات" hint="اضغط «حجز جديد» لإضافة سيشن." /> : (
        <div className={s.list}>
          {rows.map((r) => (
            <div key={r.id} className={clsx(s.card, r.status === 'cancelled' && s.cardCancelled)}>
              <div className={s.top}>
                <p className={s.name}>#{r.session_no} · {r.customer_name}{r.customer_phone && <span dir="ltr" className="ms-2 text-sm text-bark-500">{r.customer_phone}</span>}</p>
                <span className={clsx('chip', STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
              </div>
              <p className={s.when}>{fmtDate(r.session_date)} · {r.session_time.slice(0, 5)}</p>
              <div className={s.nums}>
                <div><p className={s.k}>السعر</p><p className={s.v}><span className="num">{money(r.price)}</span></p></div>
                <div><p className={s.k}>الدفعة المقدمة</p><p className={s.v}><span className="num">{money(r.deposit)}</span></p></div>
                <div><p className={s.k}>المتبقي</p><p className={s.v}><span className="num">{money(r.price - r.deposit)}</span></p></div>
              </div>
              {r.notes && <p className={s.note}>{r.notes}</p>}
              <div className={s.actions}>
                <button className="btn-ghost btn-sm" onClick={() => { setErr(null); setForm({ id: r.id, session_date: r.session_date, session_time: r.session_time.slice(0, 5), customer_name: r.customer_name, customer_phone: r.customer_phone ?? '', price: String(r.price), deposit: String(r.deposit), notes: r.notes ?? '' }); }}>تعديل</button>
                {r.status === 'pending' && <button className="btn-primary btn-sm" onClick={() => status(r, 'confirmed')}>تأكيد</button>}
                {(r.status === 'pending' || r.status === 'confirmed') && <button className="btn-primary btn-sm" onClick={() => status(r, 'completed')}>تمت</button>}
                {r.status !== 'cancelled' && r.status !== 'completed' && <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" onClick={() => status(r, 'cancelled')}>إلغاء</button>}
                {r.status === 'cancelled' && <button className="btn-ghost btn-sm" onClick={() => status(r, 'confirmed')}>استرجاع</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل سيشن' : 'حجز سيشن جديد'}>
        {form && (
          <div className={s.form}>
            <div><label className="label" htmlFor="s-name">اسم العميل</label><input id="s-name" className="input" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div><label className="label" htmlFor="s-phone">الموبايل</label><input id="s-phone" dir="ltr" inputMode="tel" className="input" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
            <div className={s.row2}>
              <div><label className="label" htmlFor="s-date">التاريخ</label><input id="s-date" type="date" dir="ltr" className="input" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} /></div>
              <div><label className="label" htmlFor="s-time">الوقت</label><input id="s-time" type="time" dir="ltr" className="input" value={form.session_time} onChange={(e) => setForm({ ...form, session_time: e.target.value })} /></div>
            </div>
            <div className={s.row2}>
              <div><label className="label" htmlFor="s-price">السعر</label><input id="s-price" dir="ltr" inputMode="decimal" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><label className="label" htmlFor="s-dep">الدفعة المقدمة</label><input id="s-dep" dir="ltr" inputMode="decimal" className="input" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} /></div>
            </div>
            <div><label className="label" htmlFor="s-notes">ملاحظات</label><textarea id="s-notes" className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <ErrorNote message={err} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
