'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import clsx from 'clsx';
import { ErrorNote, Modal, Spinner } from '@/components/kit';
import { useProfile } from '@/hooks/useProfile';
import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import { roleLabel } from '@/lib/format';
import { PERMISSIONS } from '@/lib/permissions';
import type { Permission, Profile, Role } from '@/lib/types';
import s from './users.module.css';

const ROLES: Role[] = ['admin', 'cashier', 'waiter', 'accountant', 'hall_manager', 'cafe_manager', 'session_manager'];

export default function UsersAdmin() {
  const sb = createClient();
  const { profile: me } = useProfile();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [permFor, setPermFor] = useState<Profile | null>(null);
  const [perms, setPerms] = useState<Record<string, Permission[]>>({});

  const load = useCallback(async () => {
    try {
      setUsers(must(await sb.from('profiles').select('*').order('created_at')) as Profile[]);
      const up = await sb.from('user_permissions').select('user_id,permission');
      const m: Record<string, Permission[]> = {};
      (up.data ?? []).forEach((r: any) => { (m[r.user_id] ||= []).push(r.permission); });
      setPerms(m);
    }
    catch (e: any) { setErr(e.message); setUsers([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  async function update(u: Profile, patch: Partial<Profile>) {
    setErr(null);
    try { await api('PATCH', { id: u.id, role: patch.role, is_active: patch.is_active }); await load(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <section>
      <div className={s.head}>
        <h1 className={s.title}>الحسابات</h1>
        <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><UserPlus size={18} /> حساب جديد</button>
      </div>
      <ErrorNote message={err} />
      {users === null ? <Spinner /> : (
        <div className={s.list}>
          {users.map((u) => {
            const self = u.id === me?.id;
            return (
              <div key={u.id} className={s.row}>
                <div className={s.who}><p className={s.name}>{u.full_name}{self && <span className="ms-2 chip bg-petal-100 text-bark-500">إنت</span>}</p>
                  <span className={clsx('chip mt-1', u.is_active ? 'bg-fern-light text-fern-ink' : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300')}>{u.is_active ? 'شغّال' : 'متعطل'}</span></div>
                <select className={`input ${s.role}`} aria-label={`دور ${u.full_name}`} value={u.role} disabled={self} onChange={(e) => update(u, { role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
                <button className="btn-ghost btn-sm" onClick={() => setPermFor(u)}><ShieldCheck size={16} /> الصلاحيات{(perms[u.id]?.length ?? 0) > 0 && <span className="chip ms-1 bg-fern-light text-fern-ink">+{perms[u.id].length}</span>}</button>
                <button className="btn-ghost btn-sm" onClick={() => setResetFor(u)}><KeyRound size={16} /> كلمة السر</button>
                <button className={clsx('btn-sm', u.is_active ? 'btn-ghost text-red-700 dark:text-red-300' : 'btn-primary')} disabled={self} onClick={() => update(u, { is_active: !u.is_active })}>{u.is_active ? 'تعطيل' : 'تفعيل'}</button>
              </div>
            );
          })}
        </div>
      )}
      <CreateModal open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} />
      <ResetModal user={resetFor} onClose={() => setResetFor(null)} />
      <PermModal user={permFor} current={permFor ? perms[permFor.id] ?? [] : []} onClose={() => setPermFor(null)} onDone={() => { setPermFor(null); void load(); }} />
    </section>
  );
}

async function api(method: 'POST' | 'PATCH', body: object) {
  const res = await fetch('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'فشل الطلب');
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ full_name: '', email: '', password: '', role: 'waiter' as Role });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="حساب جديد">
      <div className={s.form}>
        <div><label className="label" htmlFor="u-name">الاسم بالكامل</label><input id="u-name" className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
        <div><label className="label" htmlFor="u-email">الإيميل (للدخول)</label><input id="u-email" type="email" dir="ltr" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label" htmlFor="u-pass">كلمة سر مؤقتة</label><input id="u-pass" type="text" dir="ltr" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><p className={s.hint}>8 حروف على الأقل.</p></div>
        <div><label className="label" htmlFor="u-role">الدور</label>
          <select id="u-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select></div>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api('POST', f); setF({ full_name: '', email: '', password: '', role: 'waiter' }); onDone(); }
          catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}>{busy && <Loader2 className="animate-spin" size={18} />} إنشاء الحساب</button>
      </div>
    </Modal>
  );
}

/** صلاحيات إضافية فوق الدور: مثلًا «مسؤول قاعة» + «سيشن التصوير» على نفس الحساب. */
function PermModal({ user, current, onClose, onDone }: { user: Profile | null; current: Permission[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<Permission[]>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setSel(current); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  const toggle = (k: Permission) => setSel((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  return (
    <Modal open onClose={onClose} title={`صلاحيات · ${user.full_name}`}>
      <div className={s.form}>
        <p className={s.hint}>الدور الحالي ({roleLabel[user.role]}) بيدّي صلاحياته الأساسية. اختار هنا أي شاشات إضافية.</p>
        {PERMISSIONS.map((p) => (
          <label key={p.key} className="flex items-start gap-3 font-bold">
            <input type="checkbox" className="mt-1" checked={sel.includes(p.key)} onChange={() => toggle(p.key)} />
            <span>{p.label}<span className="block text-sm font-normal text-bark-500">{p.hint}</span></span>
          </label>
        ))}
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api('PATCH', { id: user.id, permissions: sel }); onDone(); }
          catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ الصلاحيات</button>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: Profile | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!user) return null;
  return (
    <Modal open onClose={onClose} title={`كلمة سر جديدة · ${user.full_name}`}>
      <div className={s.form}>
        <div><label className="label" htmlFor="r-pw">كلمة السر الجديدة</label><input id="r-pw" dir="ltr" className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api('PATCH', { id: user.id, password: pw }); setPw(''); onClose(); }
          catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}>{busy && <Loader2 className="animate-spin" size={18} />} تعيين كلمة السر</button>
      </div>
    </Modal>
  );
}
