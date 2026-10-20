'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import clsx from 'clsx';
import { ErrorNote, Spinner } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { createClient } from '@/lib/supabase/client';
import { money, timeAgo } from '@/lib/format';
import { friendly } from '@/lib/util';
import type { HospitalityRequest } from '@/lib/types';
import s from './special.module.css';

export default function SpecialOrdersPage() {
  const notify = useNotify();
  const [pending, setPending] = useState<HospitalityRequest[] | null>(null);
  const [recent, setRecent] = useState<HospitalityRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const sel = '*, orders(order_no, order_items(name, qty))';
    const [p, r] = await Promise.all([
      sb.from('hospitality_requests').select(sel).is('approved_by_admin', null).order('created_at'),
      sb.from('hospitality_requests').select(sel).not('approved_by_admin', 'is', null).order('decided_at', { ascending: false }).limit(15),
    ]);
    if (p.error) return setErr(friendly(p.error.message));
    setPending(p.data as any); setRecent((r.data as any) ?? []);
  }, []);

  useEffect(() => {
    void load();
    const sb = createClient();
    const ch = sb.channel('special-orders-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hospitality_requests' }, (e) => {
        if (e.eventType === 'INSERT') notify({ title: 'طلب ضيافة جديد', body: `${money((e.new as any).amount)} · مستني تأكيدك`, tone: 'info', sound: 'newOrder' });
        void load();
      })
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(r: HospitalityRequest, approve: boolean) {
    setBusy(r.id); setErr(null);
    const { error } = await createClient().rpc('decide_hospitality_request', { p_id: r.id, p_approve: approve, p_notes: notes[r.id] ?? null });
    setBusy(null);
    if (error) return setErr(friendly(error.message));
    notify({ title: approve ? 'اتسجّل مصروف ضيافة وخصمنا المكونات' : 'تم رفض الضيافة', tone: approve ? 'success' : 'info' });
    void load();
  }

  if (!pending && !err) return <Spinner />;
  const items = (r: HospitalityRequest) => (r.orders?.order_items ?? []).map((i) => `${i.name} ×${i.qty}`).join('، ');

  return (
    <div className={s.page}>
      <h1 className={s.title}>الضيافة والطلبات الشخصية</h1>
      <ErrorNote message={err} />

      <section>
        <h2 className={s.sectionTitle}>ضيافة مستنية تأكيدك</h2>
        <div className={s.list}>
          {(pending ?? []).length === 0 && <p className={s.muted}>مفيش طلبات ضيافة معلّقة.</p>}
          {(pending ?? []).map((r) => (
            <div key={r.id} className={clsx(s.card, s.cardWait)}>
              <div className={s.head}><p className={s.name}>أوردر <bdi>#{r.orders?.order_no}</bdi></p><span className={s.amount}><span className="num">{money(r.amount)}</span></span></div>
              <p className={s.items}>{items(r)}</p>
              <p className={s.meta}>{timeAgo(r.created_at)}{r.notes ? ` · ${r.notes}` : ''}</p>
              <input className="input" placeholder="ملاحظة / لمين الضيافة (اختياري)" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
              <div className={s.actions}>
                <button className={clsx('btn btn-primary', s.grow)} disabled={busy === r.id} onClick={() => decide(r, true)}>{busy === r.id ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />} موافقة وتسجيل كمصروف</button>
                <button className={clsx('btn btn-ghost', s.grow)} disabled={busy === r.id} onClick={() => decide(r, false)}><X size={18} /> رفض</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className={s.sectionTitle}>آخر قرارات الضيافة</h2>
          <div className={s.box}>
            {recent.map((r) => (
              <div key={r.id} className={s.row}>
                <span><bdi>#{r.orders?.order_no}</bdi> · {items(r)}</span>
                <span className="num">{money(r.amount)} · {r.approved_by_admin ? 'اتوافق' : 'اترفض'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
