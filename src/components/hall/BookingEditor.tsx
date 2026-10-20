'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Minus, Plus, Users } from 'lucide-react';
import { ErrorNote, Modal } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { computeQuote, saveBooking, ymd } from '@/lib/hall';
import { money } from '@/lib/format';
import { friendly } from '@/lib/util';
import type { HallBooking, HallRate, HallService } from '@/lib/types';
import s from './BookingEditor.module.css';

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
  const today = ymd(new Date());
  const [date, setDate] = useState(booking?.event_date ?? initialDate ?? today);
  const [name, setName] = useState(booking?.customer_name ?? '');
  const [phone, setPhone] = useState(booking?.customer_phone ?? '');
  const [eventType, setEventType] = useState(booking?.event_type ?? '');
  const [guests, setGuests] = useState<string>(booking?.guests != null ? String(booking.guests) : '');
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

  // Availability: is another (non-cancelled) booking already on this date?
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    if (!date) return;
    let alive = true;
    (async () => {
      let q = createClient().from('hall_bookings').select('id, customer_name').eq('event_date', date).neq('status', 'cancelled');
      if (booking) q = q.neq('id', booking.id);
      const { data } = await q.limit(1);
      if (alive) setConflict(data?.[0] ? (data[0] as { customer_name: string }).customer_name : null);
    })();
    return () => { alive = false; };
  }, [date, booking]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problem = !date ? 'اختار تاريخ المناسبة.' : conflict ? 'اليوم ده محجوز بالفعل.' : !name.trim() ? 'اكتب اسم العميل.' : !rateId ? 'اختار سعر إيجار القاعة.' : paidNum > quote.total ? 'المدفوع أكبر من الإجمالي.' : null;

  const setQ = (id: string, v: number) => setQty((m) => ({ ...m, [id]: Math.max(0, Math.floor(v || 0)) }));
  const fillGuests = () => { const g = Number(guests); if (g > 0) setQty((m) => { const n = { ...m }; for (const d of dishes) if ((n[d.id] ?? 0) > 0) n[d.id] = g; return n; }); };

  async function save() {
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try {
      await saveBooking({
        id: booking?.id ?? null, event_date: date, customer_name: name, customer_phone: phone, event_type: eventType,
        guests: guests === '' ? null : Number(guests), rate_id: rateId, discount: Number(discount) || 0, paid_amount: paidNum, notes,
        items: Object.entries(qty).filter(([, q]) => q > 0).map(([service_id, q]) => ({ service_id, qty: q })),
      });
      onSaved(); onClose();
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  return (
    <div className={s.form}>
      <section className={s.block}>
        <h3 className={s.h}>بيانات الحجز</h3>
        <div className={s.grid2}>
          <div><label className="label" htmlFor="b-date">تاريخ المناسبة</label><input id="b-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-type">نوع المناسبة</label><input id="b-type" className="input" placeholder="فرح، خطوبة، عيد ميلاد…" value={eventType} onChange={(e) => setEventType(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-name">اسم العميل</label><input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-phone">التليفون</label><input id="b-phone" dir="ltr" inputMode="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><label className="label" htmlFor="b-guests">عدد الضيوف</label><input id="b-guests" type="number" min={0} inputMode="numeric" className="input" value={guests} onChange={(e) => setGuests(e.target.value)} /></div>
        </div>
        {conflict && <p className={s.warn} role="alert"><AlertTriangle size={16} /> اليوم ده محجوز باسم «{conflict}». اختار تاريخ تاني.</p>}
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
