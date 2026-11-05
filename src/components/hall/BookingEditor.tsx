'use client';
import { useNotify } from '@/components/layout/Providers';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Lock, Minus, Moon, Plus, Sun, Sunset, Users } from 'lucide-react';
import { ErrorNote, Modal } from '@/components/ui/kit';
import { createClient } from '@/lib/supabase/client';
import { computeQuote, dayState, saveBooking, slotsOf, SLOT_KEYS, SLOT_META, ymd } from '@/lib/services/hall';
import { money } from '@/lib/helpers/format';
import { friendly } from '@/lib/helpers/util';
import type { HallBooking, HallRate, HallService, SlotKey } from '@/lib/types';
import s from './BookingEditor.module.css';

const SLOT_ICON = { day: Sun, evening: Sunset, night: Moon } as const;
interface DayRow { id: string; customer_name: string; slots: SlotKey[] | null; periods: number }

interface Props {
  open: boolean; onClose: () => void; onSaved: () => void;
  /** New booking: the day clicked on the calendar. */
  initialDate: string | null;
  /** Existing booking (with `hall_booking_items`) when editing. */
  booking: HallBooking | null;
  rates: HallRate[]; services: HallService[];
}

/** Add / edit a hall booking with the live cost calculator. The server recalculates everything on save. */
export default function BookingEditor(p: Props) {
  return (
    <Modal open={p.open} onClose={p.onClose} wide title={p.booking ? `تعديل حجز #${p.booking.booking_no}` : 'حجز جديد'}>
      {p.open && <Form {...p} />}
    </Modal>
  );
}

function Form({ onClose, onSaved, initialDate, booking, rates, services }: Props) {
  const notify = useNotify();
  const today = ymd(new Date());
  const [date, setDate] = useState(booking?.event_date ?? initialDate ?? today);
  const [name, setName] = useState(booking?.customer_name ?? '');
  const [phone, setPhone] = useState(booking?.customer_phone ?? '');
  const [eventType, setEventType] = useState(booking?.event_type ?? '');
  const [guests, setGuests] = useState<string>(booking?.guests != null ? String(booking.guests) : '');
  const [slots, setSlots] = useState<SlotKey[]>(booking ? slotsOf(booking) : []);
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [rateId, setRateId] = useState(booking?.rate_id ?? rates.find((r) => r.is_active)?.id ?? '');
  const [discount, setDiscount] = useState(booking?.discount ? String(booking.discount) : '');
  const [paid, setPaid] = useState(booking?.paid_amount ? String(booking.paid_amount) : '');

  // Prices already saved on this booking stay frozen (server does the same) — price edits never rewrite old quotes.
  const items = useMemo(() => booking?.hall_booking_items ?? [], [booking]);
  const frozenPrices = useMemo(() => Object.fromEntries(items.filter((i) => i.service_id).map((i) => [i.service_id as string, i.unit_price])), [items]);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(items.filter((i) => i.service_id).map((i) => [i.service_id as string, i.qty])));

  const rateOptions = rates.filter((r) => r.is_active || r.id === booking?.rate_id);
  const rate = rates.find((r) => r.id === rateId) ?? null;
  const visible = services.filter((x) => x.is_active || frozenPrices[x.id] !== undefined);
  const dishes = visible.filter((x) => x.kind === 'dish');
  const extras = visible.filter((x) => x.kind === 'extra');

  const quote = useMemo(() => computeQuote({
    rate, qty, services: visible, discount: Number(discount) || 0, frozenPrices,
    frozenHallPrice: booking && booking.rate_id === rateId ? booking.hall_price : null,
  }), [rate, qty, visible, discount, frozenPrices, booking, rateId]);
  const paidNum = Number(paid) || 0;

  // Other (non-cancelled) bookings on the same date: their slots are locked here. The server re-checks on save.
  const [others, setOthers] = useState<DayRow[]>([]);
  const [dayLoaded, setDayLoaded] = useState(false);
  useEffect(() => {
    if (!date) return;
    let alive = true;
    setDayLoaded(false);
    (async () => {
      let q = createClient().from('hall_bookings').select('id, customer_name, slots, periods').eq('event_date', date).neq('status', 'cancelled');
      if (booking) q = q.neq('id', booking.id);
      const { data, error } = await q.limit(20);
      if (!alive) return;
      const rows = error ? [] : ((data ?? []) as DayRow[]);
      const st = dayState(rows);
      setOthers(rows);
      // drop slots that are taken on this date; a new booking starts with the first free slot selected
      setSlots((cur) => { const keep = cur.filter((k) => !st.taken.has(k)); return keep.length || booking ? keep : st.free.slice(0, 1); });
      setDayLoaded(true);
    })();
    return () => { alive = false; };
  }, [date, booking]);

  const st = useMemo(() => dayState(others), [others]);
  const fullDay = dayLoaded && st.free.length === 0;
  const ownerOf = (k: SlotKey) => others.find((o) => slotsOf(o).includes(k))?.customer_name ?? '';
  const toggleSlot = (k: SlotKey) => setSlots((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : SLOT_KEYS.filter((x) => x === k || cur.includes(x))));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isPast = !booking && !!date && date < today;
  const problem = !date ? 'اختار تاريخ المناسبة.'
    : isPast ? 'مينفعش تحجز في تاريخ فات.'
    : !dayLoaded ? 'استنى لحظة… بنراجع الفترات المتاحة.'
    : fullDay ? 'اليوم ده محجوز بالكامل. اختار يوم تاني.'
    : slots.length === 0 ? 'اختار فترة واحدة على الأقل.'
    : slots.some((k) => st.taken.has(k)) ? 'في فترة مختارة محجوزة بالفعل.'
    : !name.trim() ? 'اكتب اسم العميل.' : !rateId ? 'اختار سعر إيجار القاعة.' : paidNum > quote.total ? 'المدفوع أكبر من الإجمالي.' : null;

  const setQ = (id: string, v: number) => setQty((m) => ({ ...m, [id]: Math.max(0, Math.floor(v || 0)) }));
  const fillGuests = () => { const g = Number(guests); if (g > 0) setQty((m) => { const n = { ...m }; for (const d of dishes) if ((n[d.id] ?? 0) > 0) n[d.id] = g; return n; }); };

  async function save() {
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try {
      await saveBooking({
        id: booking?.id ?? null, event_date: date, customer_name: name, customer_phone: phone, event_type: eventType,
        guests: guests === '' ? null : Number(guests), periods: slots.length, slots, rate_id: rateId, discount: Number(discount) || 0, paid_amount: paidNum, notes,
        items: Object.entries(qty).filter(([, q]) => q > 0).map(([service_id, q]) => ({ service_id, qty: q })),
      });
      notify({ title: booking?.id ? 'اتحفظ تعديل الحجز' : 'اتحفظ الحجز', body: `${name} · ${date}`, tone: 'success' });
      onSaved(); onClose();
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  return (
    <div className={s.form}>
      <section className={s.block}>
        <h3 className={s.h}>بيانات الحجز</h3>
        <div className={s.grid2}>
          <div><label className="label" htmlFor="b-date">تاريخ المناسبة</label><input id="b-date" type="date" className="input" min={booking ? undefined : today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-type">نوع المناسبة</label><input id="b-type" className="input" placeholder="فرح، خطوبة، عيد ميلاد…" value={eventType} onChange={(e) => setEventType(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-name">اسم العميل</label><input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-phone">التليفون</label><input id="b-phone" dir="ltr" inputMode="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-guests">عدد الضيوف</label><input id="b-guests" type="number" min={0} inputMode="numeric" className="input" value={guests} onChange={(e) => setGuests(e.target.value)} /></div>
        </div>
      </section>

      <section className={s.block} aria-labelledby="b-slots-h">
        <div className={s.hRow}>
          <h3 className={s.h} id="b-slots-h">الفترات</h3>
          {dayLoaded && !fullDay && <span className={s.muted}>{slots.length === 0 ? 'اختار فترة أو أكتر' : `${slots.length === 1 ? 'فترة واحدة' : slots.length === 2 ? 'فترتين' : '3 فترات'} مختارة`}</span>}
        </div>
        {fullDay && <p className={s.fullAlert} role="alert"><Lock size={18} /> اليوم ده محجوز بالكامل (كل الفترات). مينفعش تضيف حجز جديد — اختار تاريخ تاني.</p>}
        <div className={s.slots} role="group" aria-label="اختيار الفترات" aria-busy={!dayLoaded}>
          {SLOT_KEYS.map((k) => {
            const Icon = SLOT_ICON[k];
            const taken = st.taken.has(k);
            const on = slots.includes(k);
            return (
              <button key={k} type="button" data-slot={k} disabled={taken || !dayLoaded || isPast} aria-pressed={on}
                className={`${s.slot} ${on ? s.slotOn : ''} ${taken ? s.slotTaken : ''}`} onClick={() => toggleSlot(k)}>
                <span className={s.slotIcon}>{taken ? <Lock size={20} /> : <Icon size={22} />}</span>
                <span className={s.slotName}>{SLOT_META[k].short}</span>
                <span className={s.slotNote}>{taken ? `محجوز${ownerOf(k) ? ` · ${ownerOf(k)}` : ''}` : SLOT_META[k].hint}</span>
              </button>
            );
          })}
        </div>
        {dayLoaded && others.length > 0 && !fullDay && <p className={s.info} role="status"><AlertTriangle size={16} /> فيه حجز تاني في اليوم ده — الفترات المقفولة محجوزة، والباقي متاح.</p>}
      </section>

      <section className={s.block}>
        <h3 className={s.h}>إيجار القاعة</h3>
        {rateOptions.length === 0
          ? <p className={s.warn}>مفيش أسعار إيجار. ضيف سعر من «الأسعار والخدمات» الأول.</p>
          : <div className={s.rates}>{rateOptions.map((r) => {
              const price = booking && booking.rate_id === r.id ? booking.hall_price : r.price;
              return (
                <label key={r.id} className={`${s.rate} ${rateId === r.id ? s.rateOn : ''}`}>
                  <input type="radio" name="rate" className="sr-only" checked={rateId === r.id} onChange={() => setRateId(r.id)} />
                  <span className={s.rateName}>{r.name}</span><span className={`num ${s.ratePrice}`}>{money(price)}</span>
                </label>
              );
            })}</div>}
      </section>

      <Picker title="الأطباق والوجبات" list={dishes} qty={qty} setQ={setQ} frozen={frozenPrices}
        extra={Number(guests) > 0 ? <button type="button" className="btn-ghost btn-sm" onClick={fillGuests}><Users size={16} /> الكمية = عدد الضيوف</button> : null} />
      <Picker title="الشوك والخدمات الإضافية" list={extras} qty={qty} setQ={setQ} frozen={frozenPrices} />

      <section className={s.block}>
        <h3 className={s.h}>الخصم والمدفوع</h3>
        <div className={s.grid2}>
          <div><label className="label" htmlFor="b-disc">خصم</label><input id="b-disc" type="number" min={0} inputMode="decimal" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-paid">العربون / المدفوع</label><input id="b-paid" type="number" min={0} inputMode="decimal" className="input" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="b-notes">ملاحظات</label><textarea id="b-notes" rows={2} className={`input ${s.textarea}`} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </section>

      {/* Sticky cost summary — recalculated live; the server re-checks every price on save */}
      <div className={s.summary} aria-live="polite">
        <Row label="إيجار القاعة" v={quote.hall_price} />
        <Row label="الأطباق" v={quote.dishes_total} />
        <Row label="الخدمات والشوك" v={quote.extras_total} />
        {quote.discount > 0 && <Row label="خصم" v={-quote.discount} />}
        <div className={`${s.row} ${s.total}`}><span>الإجمالي</span><span className="num">{money(quote.total)}</span></div>
        <div className={s.row}><span>المتبقي بعد المدفوع</span><span className="num">{money(Math.max(0, quote.total - paidNum))}</span></div>
        <ErrorNote message={err} />
        <div className={s.btns}>
          <button className="btn-primary flex-1" disabled={busy || !!problem} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} {booking ? 'حفظ التعديلات' : 'حفظ الحجز'}</button>
          <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, v }: { label: string; v: number }) => <div className={s.row}><span>{label}</span><span className="num">{money(v)}</span></div>;

function Picker({ title, list, qty, setQ, frozen, extra }: {
  title: string; list: HallService[]; qty: Record<string, number>; setQ: (id: string, v: number) => void; frozen: Record<string, number>; extra?: React.ReactNode;
}) {
  return (
    <section className={s.block}>
      <div className={s.hRow}><h3 className={s.h}>{title}</h3>{extra}</div>
      {list.length === 0 ? <p className={s.muted}>مفيش عناصر. ضيفها من «الأسعار والخدمات».</p> : (
        <div className={s.items}>
          {list.map((x) => {
            const q = qty[x.id] ?? 0;
            const price = frozen[x.id] ?? x.price;
            return (
              <div key={x.id} className={`${s.item} ${q > 0 ? s.itemOn : ''}`}>
                <div className={s.itemInfo}>
                  <p className={s.itemName}>{x.name}{!x.is_active && <span className="ms-2 chip bg-petal-100 text-bark-500">متوقف</span>}</p>
                  <p className={`num ${s.itemPrice}`}>{money(price)}{x.unit_label ? ` / ${x.unit_label}` : ''}</p>
                </div>
                <div className={s.stepper}>
                  <button type="button" aria-label={`إنقاص ${x.name}`} onClick={() => setQ(x.id, q - 1)} disabled={q === 0}><Minus size={16} /></button>
                  <input aria-label={`كمية ${x.name}`} inputMode="numeric" className={s.qty} value={q || ''} placeholder="0" onChange={(e) => setQ(x.id, Number(e.target.value.replace(/\D/g, '')))} />
                  <button type="button" aria-label={`زيادة ${x.name}`} onClick={() => setQ(x.id, q + 1)}><Plus size={16} /></button>
                </div>
                <p className={`num ${s.lineTotal}`}>{q > 0 ? money(price * q) : ''}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
