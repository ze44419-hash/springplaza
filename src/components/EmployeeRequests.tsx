'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, HandCoins, Loader2, X } from 'lucide-react';
import { ErrorNote } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { money } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { friendly } from '@/lib/util';
import type { EmployeeRequest, Profile } from '@/lib/types';
import s from './EmployeeRequests.module.css';

/**
 * الطلبات الشخصية المعلّقة:
 *  - لو الموظف عنده حساب: بيوافق بنفسه من حسابه.
 *  - لو مالوش حساب: اللي عمل الطلب (أو الكاشير/الأدمن) بيأكد موافقته قدامه.
 * القبول بيخصم الصافي (بعد خصم الأدمن) من راتبه.
 */
export default function EmployeeRequests({ profile }: { profile: Profile }) {
  const notify = useNotify();
  const [rows, setRows] = useState<EmployeeRequest[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = createClient();
      const [mine, pending] = await Promise.all([
        sb.rpc('my_staff_id'),
        sb.from('employee_requests').select('*').eq('status', 'pending').order('created_at'),
      ]);
      const myId = (mine.data as string | null) ?? null;
      // أنا صاحب الطلب، أو طلب لموظف مالوش حساب (RLS بيرجّع بس اللي مسموح لي أشوفه)
      const list = ((pending.data ?? []) as EmployeeRequest[]).filter((r) => r.staff_id === myId || r.proxy);
      if (seen.current) for (const r of list) if (!seen.current.has(r.id) && r.staff_id === myId)
        notify({ title: 'طلب شخصي محتاج موافقتك', body: `${r.summary ?? ''} · ${money(r.amount)}`, tone: 'info', sound: 'newOrder' });
      seen.current = new Set(list.map((r) => r.id));
      setMe(myId); setRows(list);
    } catch { /* offline: يفضل آخر عرض */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sb = createClient();
    const ch = sb.channel(`emp-req-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_requests' }, () => void load())
      .subscribe((st) => { if (st === 'SUBSCRIBED') void load(); });
    const on = () => void load();
    window.addEventListener('online', on);
    return () => { window.removeEventListener('online', on); void sb.removeChannel(ch); };
  }, [profile.id, load]);

  async function decide(r: EmployeeRequest, approve: boolean) {
    const who = r.staff_id === me ? 'هيتخصم من مستحقاتك' : `هيتخصم من راتب ${r.staff_name}`;
    if (approve && !confirm(`تأكيد؟ ${money(r.amount)} ${who}.`)) return;
    setBusy(r.id); setErr(null);
    const { error } = await createClient().rpc('decide_employee_request', { p_id: r.id, p_approve: approve });
    setBusy(null);
    if (error) return setErr(friendly(error.message));
    notify({ title: approve ? 'تمت الموافقة' : 'تم الرفض', body: approve ? `${money(r.amount)} اتحسبت على ${r.staff_name}.` : undefined, tone: approve ? 'success' : 'info' });
    void load();
  }

  if (rows.length === 0 && !err) return null;
  return (
    <div className={s.wrap}>
      <ErrorNote message={err} />
      {rows.map((r) => (
        <div key={r.id} className={s.card}>
          <p className={s.head}><HandCoins size={20} /> {r.staff_id === me ? 'طلب شخصي على حسابك' : `طلب شخصي · ${r.staff_name} — أكّد موافقته`}</p>
          <p className={s.sum}>{r.summary}</p>
          <p className={s.dues}>
            {r.discount_amount > 0 && <>الإجمالي <span className="num">{money(r.gross)}</span> − خصم <span className="num">{money(r.discount_amount)}</span> = </>}
            <b className={s.amount}><span className="num">{money(r.amount)}</span></b>
          </p>
          <div className={s.actions}>
            <button className={`btn btn-primary ${s.grow}`} disabled={busy === r.id} onClick={() => decide(r, true)}>{busy === r.id ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />} موافق</button>
            <button className={`btn btn-ghost ${s.grow}`} disabled={busy === r.id} onClick={() => decide(r, false)}><X size={18} /> رفض</button>
          </div>
        </div>
      ))}
    </div>
  );
}
