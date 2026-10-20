'use client';
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ErrorNote, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { roleLabel } from '@/lib/format';
import { friendly } from '@/lib/util';
import type { Branch, Profile } from '@/lib/types';
import s from './branches.module.css';

type Assign = { user_id: string; branch_id: string };
const MANAGER = { cafe_manager: 'cafe', hall_manager: 'hall' } as const;

/** الفروع (كافيهات/قاعات) + تعيين المسؤولين: مدير بدون تعيين = عام على كل فروع نوعه، ومعاه تعيين = محصور على فرعه. */
export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [asg, setAsg] = useState<Assign[]>([]);
  const [nb, setNb] = useState({ type: 'cafe' as 'cafe' | 'hall', name: '' });
  const [na, setNa] = useState({ user: '', branch: '' });
  const [err, setErr] = useState<string | null>(null);
  const sb = createClient();

  const load = useCallback(async () => {
    const [b, u, a] = await Promise.all([
      sb.from('branches').select('*').order('type').order('created_at'),
      sb.from('profiles').select('*').eq('is_active', true).in('role', ['cafe_manager', 'hall_manager', 'cashier', 'waiter']).order('full_name'),
      sb.from('user_assignments').select('user_id, branch_id'),
    ]);
    if (b.error) return setErr(friendly(b.error.message));
    setBranches(b.data as Branch[]); setUsers((u.data ?? []) as Profile[]); setAsg((a.data ?? []) as Assign[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await p; if (error) return setErr(friendly(error.message)); setErr(null); void load(); };
  if (!branches) return <Spinner />;
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? '—';
  const uname = (id: string) => users.find((u) => u.id === id);
  const scopeOf = (u: Profile) => {
    const t = MANAGER[u.role as keyof typeof MANAGER];
    if (!t) return null;
    const mine = asg.filter((a) => a.user_id === u.id && branches.find((b) => b.id === a.branch_id)?.type === t);
    return mine.length ? `محدد: ${mine.map((a) => name(a.branch_id)).join('، ')}` : `عام (كل ${t === 'cafe' ? 'الكافيهات' : 'القاعات'})`;
  };

  return (
    <div className={s.page}>
      <h1 className={s.title}>الفروع والمسؤولين</h1>
      <ErrorNote message={err} />

      <section><h2 className={s.h2}>الفروع</h2>
        <div className={s.form}>
          <select className="input" value={nb.type} onChange={(e) => setNb({ ...nb, type: e.target.value as 'cafe' | 'hall' })}><option value="cafe">كافيه</option><option value="hall">قاعة</option></select>
          <input className="input" placeholder="اسم الفرع" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
          <button className="btn btn-primary" disabled={!nb.name.trim()} onClick={async () => { await run(sb.from('branches').insert({ type: nb.type, name: nb.name.trim() })); setNb({ ...nb, name: '' }); }}>إضافة فرع</button>
        </div>
        <div className={s.box} style={{ marginTop: 10 }}>
          {branches.map((b) => (
            <div key={b.id} className={s.row}>
              <span><b>{b.name}</b> <span className={s.chip2}>{b.type === 'cafe' ? 'كافيه' : 'قاعة'}</span>{!b.is_active && <span className={s.chip2}> متوقف</span>}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => run(sb.from('branches').update({ is_active: !b.is_active }).eq('id', b.id))}>{b.is_active ? 'إيقاف' : 'تفعيل'}</button>
            </div>))}
        </div>
      </section>

      <section><h2 className={s.h2}>المسؤولون (عام / محدد)</h2>
        <div className={s.box}>
          {users.filter((u) => u.role in MANAGER).length === 0 && <p className={s.muted}>أنشئ حساب «مدير كافيهات» أو «مسؤول القاعة» من صفحة الحسابات.</p>}
          {users.filter((u) => u.role in MANAGER).map((u) => <div key={u.id} className={s.row}><b>{u.full_name} <span className={s.chip2}>{roleLabel[u.role]}</span></b><span>{scopeOf(u)}</span></div>)}
        </div>
      </section>

      <section><h2 className={s.h2}>تعيين مستخدم على فرع</h2>
        <div className={s.form}>
          <select className="input" value={na.user} onChange={(e) => setNa({ ...na, user: e.target.value })}><option value="">المستخدم…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {roleLabel[u.role]}</option>)}</select>
          <select className="input" value={na.branch} onChange={(e) => setNa({ ...na, branch: e.target.value })}><option value="">الفرع…</option>{branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.type === 'cafe' ? 'كافيه' : 'قاعة'} · {b.name}</option>)}</select>
          <button className="btn btn-primary" disabled={!na.user || !na.branch} onClick={async () => { await run(sb.from('user_assignments').upsert({ user_id: na.user, branch_id: na.branch })); setNa({ user: '', branch: '' }); }}>تعيين</button>
        </div>
        <div className={s.box} style={{ marginTop: 10 }}>
          {asg.length === 0 && <p className={s.muted}>مفيش تعيينات: المديرين عموميين، والكاشير/الكابتن على الفرع الافتراضي.</p>}
          {asg.map((a) => (
            <div key={a.user_id + a.branch_id} className={s.row}>
              <span>{uname(a.user_id)?.full_name ?? '—'} ← <b>{name(a.branch_id)}</b></span>
              <button className="btn btn-ghost btn-sm" aria-label="إلغاء التعيين" onClick={() => run(sb.from('user_assignments').delete().eq('user_id', a.user_id).eq('branch_id', a.branch_id))}><Trash2 size={16} /></button>
            </div>))}
        </div>
      </section>
    </div>
  );
}
