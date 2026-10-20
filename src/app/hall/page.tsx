'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Pencil } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { bookingChip, bookingLabel, loadBookingFull, loadBookingsRange, monthCells, setBookingStatus, WEEKDAYS, ymd } from '@/lib/hall';
import { LOCALE, money } from '@/lib/format';
import { friendly, must } from '@/lib/util';
import type { BookingStatus, HallBooking, HallRate, HallService } from '@/lib/types';
import s from './hall.module.css';

// The editor (calculator) is only needed when a booking is opened — keep it out of the first load.
const BookingEditor = dynamic(() => import('@/components/hall/BookingEditor'), { ssr: false });

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default function HallHome() {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [bookings, setBookings] = useState<HallBooking[] | null>(null);
  const [upcoming, setUpcoming] = useState<HallBooking[] | null>(null);
  const [rates, setRates] = useState<HallRate[]>([]);
  const [services, setServices] = useState<HallService[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ booking: HallBooking | null; date: string | null } | null>(null);
  const [viewing, setViewing] = useState<HallBooking | null>(null);
  const [opening, setOpening] = useState(false);

  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const todayStr = ymd(now);

  const load = useCallback(async () => {
    try {
      const days = cells.filter(Boolean) as string[];
      const sb = createClient();
      const [month, next] = await Promise.all([
        loadBookingsRange(days[0], days[days.length - 1]),
        sb.from('hall_bookings').select('*').neq('status', 'cancelled').gte('event_date', todayStr).order('event_date').limit(8),
      ]);
      setBookings(month); setUpcoming(must(next) as HallBooking[]); setErr(null);
    } catch (e: any) { setErr(friendly(e.message)); setBookings([]); setUpcoming([]); }
  }, [cells, todayStr]);
  useEffect(() => { void load(); }, [load]);

  // Prices for the calculator (inactive ones are included so old bookings still render).
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [r, sv] = await Promise.all([sb.from('hall_rates').select('*').order('sort_order'), sb.from('hall_services').select('*').order('sort_order')]);
      setRates((r.data as HallRate[]) ?? []); setServices((sv.data as HallService[]) ?? []);
    })();
  }, []);

  // Live calendar: another device booking a day shows up here without a refresh.
  useEffect(() => {
    const sb = createClient();
    const ch = sb.channel('hall-bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'hall_bookings' }, () => { void load(); }).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load]);

  const byDate = useMemo(() => new Map((bookings ?? []).map((b) => [b.event_date, b])), [bookings]);
  const shift = (d: number) => setCursor(({ y, m }) => { const x = new Date(y, m + d, 1); return { y: x.getFullYear(), m: x.getMonth() }; });

  async function openBooking(b: HallBooking) {
    setOpening(true);
    try { setViewing(await loadBookingFull(b.id)); } catch (e: any) { setErr(friendly(e.message)); } finally { setOpening(false); }
  }
  const onDay = (d: string) => { const b = byDate.get(d); if (b) void openBooking(b); else setEditor({ booking: null, date: d }); };

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>التقويم والحجوزات</h1>
        <button className="btn-primary" onClick={() => setEditor({ booking: null, date: todayStr })}><CalendarPlus size={18} /> حجز جديد</button>
      </div>
      <div style={{ gridColumn: '1 / -1' }}><ErrorNote message={err} /></div>

      <section className={s.cal} aria-label="تقويم القاعة">
        <div className={s.calTop}>
          <button className={s.navBtn} onClick={() => shift(-1)} aria-label="الشهر اللي فات"><ChevronRight size={20} /></button>
          <h2 className={s.month}>{new Date(cursor.y, cursor.m, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}</h2>
          <button className={s.navBtn} onClick={() => shift(1)} aria-label="الشهر الجاي"><ChevronLeft size={20} /></button>
        </div>
        {bookings === null ? <Spinner /> : (
          <div className={s.grid}>
            {WEEKDAYS.map((w) => <div key={w} className={s.dow}>{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className={clsx(s.day, s.empty)} aria-hidden />;
              const b = byDate.get(d);
              return (
                <button key={d} onClick={() => onDay(d)} className={clsx(s.day, b ? s[b.status] : s.free, d < todayStr && s.past, d === todayStr && s.today)}
                  aria-label={`${fmtDay(d)} — ${b ? `${bookingLabel[b.status]}: ${b.customer_name}` : 'متاح'}`}>
                  <span className={clsx('num', s.num)}>{Number(d.slice(8))}</span>
                  {b && <span className={s.who}>{b.customer_name}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className={s.legend}>
          <span><i className={s.dot} style={{ background: 'var(--fern-wash)' }} />متاح</span>
          <span><i className={s.dot} style={{ background: 'var(--sun-light)', borderColor: 'var(--sun)' }} />حجز مبدئي</span>
          <span><i className={s.dot} style={{ background: 'var(--blossom-light)', borderColor: 'var(--blossom)' }} />مؤكد</span>
          <span><i className={s.dot} style={{ background: 'var(--fern-light)', borderColor: 'var(--fern)' }} />تم وتحصّل</span>
        </div>
      </section>

      <aside className={s.side}>
        <h2 className={s.sideTitle}>الحجوزات الجاية</h2>
        {upcoming === null ? <Spinner /> : upcoming.length === 0 ? <Empty title="مفيش حجوزات جاية" hint="اضغط على أي يوم متاح في التقويم لحجزه." /> : (
          <div className={s.list}>
            {upcoming.map((b) => (
              <button key={b.id} className={s.item} onClick={() => openBooking(b)}>
                <span><p className={s.itemName}>{b.customer_name}</p>
                  <p className={s.itemMeta}>{fmtDay(b.event_date)}{b.event_type ? ` · ${b.event_type}` : ''}</p></span>
                <span className="text-end"><p className={clsx('num', s.itemTotal)}>{money(b.total)}</p><span className={clsx('chip', bookingChip[b.status])}>{bookingLabel[b.status]}</span></span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <BookingEditor open={!!editor} onClose={() => setEditor(null)} onSaved={() => void load()}
        initialDate={editor?.date ?? null} booking={editor?.booking ?? null} rates={rates} services={services} />

      <Details booking={viewing} loading={opening} onClose={() => setViewing(null)}
        onEdit={(b) => { setViewing(null); setEditor({ booking: b, date: b.event_date }); }}
        onChanged={() => { setViewing(null); void load(); }} />
    </div>
  );
}

function Details({ booking: b, onClose, onEdit, onChanged }: { booking: HallBooking | null; loading: boolean; onClose: () => void; onEdit: (b: HallBooking) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [b?.id]);

  async function move(status: BookingStatus, ask: string) {
    if (!b || !confirm(ask)) return;
    setBusy(true); setErr(null);
    try { await setBookingStatus(b.id, status); onChanged(); } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  const open = b && (b.status === 'pending' || b.status === 'confirmed');

  return (
    <Modal open={!!b} onClose={onClose} wide title={b ? `حجز #${b.booking_no} — ${b.customer_name}` : ''}>
      {b && (
        <div className={s.detail}>
          <div><span className={clsx('chip', bookingChip[b.status])}>{bookingLabel[b.status]}</span></div>
          <div className={s.kv}>
            <div><p className={s.k}>تاريخ المناسبة</p><p className={s.v}>{fmtDay(b.event_date)}</p></div>
            <div><p className={s.k}>نوع المناسبة</p><p className={s.v}>{b.event_type ?? '—'}</p></div>
            <div><p className={s.k}>التليفون</p><p className={s.v} dir="ltr" style={{ textAlign: 'start' }}>{b.customer_phone ?? '—'}</p></div>
            <div><p className={s.k}>عدد الضيوف</p><p className={clsx('num', s.v)}>{b.guests ?? '—'}</p></div>
          </div>

          <div className={s.lines}>
            <div className={s.line}><span>{b.rate_name}</span><span className="num">{money(b.hall_price)}</span></div>
            {(b.hall_booking_items ?? []).map((i) => (
              <div key={i.id} className={s.line}><span>{i.name} <bdi className="num">× {i.qty}</bdi></span><span className="num">{money(i.line_total)}</span></div>
            ))}
            {b.discount > 0 && <div className={s.line}><span>خصم</span><span className="num">-{money(b.discount)}</span></div>}
            <div className={clsx(s.line, s.totalRow)}><span>الإجمالي</span><span className="num">{money(b.total)}</span></div>
            <div className={s.line}><span>المدفوع</span><span className="num">{money(b.paid_amount)}</span></div>
            <div className={s.line}><span>المتبقي</span><span className="num">{money(Math.max(0, b.total - b.paid_amount))}</span></div>
          </div>
          {b.notes && <p className={s.v}>{b.notes}</p>}

          <ErrorNote message={err} />
          {open && (
            <div className={s.actions}>
              {b.status === 'pending' && <button className="btn-primary" disabled={busy} onClick={() => move('confirmed', 'تأكيد الحجز؟')}>{busy && <Loader2 className="animate-spin" size={18} />} تأكيد الحجز</button>}
              {b.status === 'confirmed' && <button className="btn-primary" disabled={busy} onClick={() => move('completed', 'المناسبة تمت واتحصّل المبلغ كله؟ هيتسجّل كإيراد للقاعة.')}>{busy && <Loader2 className="animate-spin" size={18} />} تمت وتحصّل المبلغ</button>}
              <button className="btn-ghost" disabled={busy} onClick={() => onEdit(b)}><Pencil size={16} /> تعديل</button>
              <button className="btn-ghost text-red-700 dark:text-red-300" disabled={busy} onClick={() => move('cancelled', 'إلغاء الحجز؟ اليوم هيرجع متاح.')}>إلغاء الحجز</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
