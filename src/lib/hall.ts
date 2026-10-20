import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import type { BookingStatus, HallBooking, HallRate, HallService, Quote, QuoteLine } from '@/lib/types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const bookingLabel: Record<BookingStatus, string> = {
  pending: 'حجز مبدئي', confirmed: 'مؤكد', completed: 'تم وتحصّل', cancelled: 'ملغي',
};
/** Tailwind chip colours per status (same palette as the rest of the app). */
export const bookingChip: Record<BookingStatus, string> = {
  pending: 'bg-sun-light text-sun-ink',
  confirmed: 'bg-blossom-light text-blossom-ink',
  completed: 'bg-fern-light text-fern-ink',
  cancelled: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300',
};

export interface QuoteInput {
  rate: HallRate | null;
  /** serviceId → qty */
  qty: Record<string, number>;
  services: HallService[];
  discount: number;
  /** Prices frozen on an existing booking (the server keeps them too): serviceId → unit_price. */
  frozenPrices?: Record<string, number>;
  /** Frozen rent when editing a booking whose rate did not change. */
  frozenHallPrice?: number | null;
}

/**
 * Instant client-side preview of the booking cost. The SERVER (`_hall_compute`) recalculates the same formula on save,
 * so this is only for live feedback:
 *   total = rent + Σ(dish qty × price) + Σ(extra qty × price) − discount
 */
export function computeQuote(i: QuoteInput): Quote {
  const hall = i.frozenHallPrice ?? i.rate?.price ?? 0;
  const lines: QuoteLine[] = [];
  let dishes = 0, extras = 0;
  for (const svc of i.services) {
    const q = Math.max(0, Math.floor(i.qty[svc.id] ?? 0));
    if (q === 0) continue;
    const price = i.frozenPrices?.[svc.id] ?? svc.price;
    const line = round2(price * q);
    lines.push({ service_id: svc.id, kind: svc.kind, name: svc.name, unit_price: price, qty: q, line_total: line });
    if (svc.kind === 'dish') dishes += line; else extras += line;
  }
  const subtotal = round2(hall + dishes + extras);
  const discount = round2(Math.min(Math.max(i.discount || 0, 0), subtotal));
  return { hall_price: hall, dishes_total: round2(dishes), extras_total: round2(extras), subtotal, discount, total: round2(subtotal - discount), lines };
}

// ---------------- Supabase RPC wrappers (the "API" of the hall module) ----------------
export interface BookingPayload {
  id?: string | null; event_date: string; customer_name: string; customer_phone?: string; event_type?: string;
  guests?: number | null; rate_id: string; items: { service_id: string; qty: number }[]; discount: number; paid_amount: number; notes?: string;
}

export async function saveBooking(p: BookingPayload): Promise<string> {
  return must(await createClient().rpc('hall_save_booking', { p })) as unknown as string;
}
export async function setBookingStatus(id: string, status: BookingStatus): Promise<void> {
  must(await createClient().rpc('hall_set_booking_status', { p_id: id, p_status: status }));
}
/** Server-side quote (authoritative). Handy for confirming the preview matches before saving. */
export async function quoteOnServer(p: Pick<BookingPayload, 'id' | 'rate_id' | 'items' | 'discount'>): Promise<Quote> {
  return must(await createClient().rpc('hall_quote', { p })) as unknown as Quote;
}

export async function loadBookingsRange(fromISO: string, toISO: string): Promise<HallBooking[]> {
  return must(await createClient().from('hall_bookings').select('*').neq('status', 'cancelled')
    .gte('event_date', fromISO).lte('event_date', toISO).order('event_date')) as HallBooking[];
}
export async function loadBookingFull(id: string): Promise<HallBooking> {
  return must(await createClient().from('hall_bookings').select('*, hall_booking_items(*)').eq('id', id).single()) as unknown as HallBooking;
}

// ---------------- Calendar helpers ----------------
/** Weeks start on Saturday (Egypt). */
export const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Cells of a month grid: leading/trailing nulls pad whole weeks (Saturday-first). */
export function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 1) % 7;                     // Sat=0 … Fri=6
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(ymd(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}
