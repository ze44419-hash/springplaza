import { db, delMeta, getLocalShift, setMeta } from './db';
import { enqueue, kickSync } from './outbox';
import { createClient } from './supabase/client';
import { uuid } from './format';
import type { LocalShift } from './types';

export async function openShift(opening: number): Promise<LocalShift> {
  const shift: LocalShift = { id: uuid(), opened_at: new Date().toISOString(), opening_cash: opening, status: 'open' };
  await db.transaction('rw', db.meta, db.outbox, async () => {
    await setMeta('shift', shift);
    await enqueue('open_shift', { id: shift.id, opening });
  });
  kickSync();
  return shift;
}

/** Everything printed on the shift-handover receipt. */
export interface ShiftSummary {
  cashier: string; openedAt: string; closedAt: string;
  orders: number; total: number; cash: number; card: number; discounts: number;
  opening: number; expected: number; counted: number; diff: number;
  items: { name: string; qty: number; revenue: number }[];
}

/** Totals for the drawer, computed from this device's copy of the shift's paid orders. */
export async function summarizeShift(shift: LocalShift, counted = 0, cashier = ''): Promise<ShiftSummary> {
  const paid = (await db.orders.where('shift_id').equals(shift.id).toArray()).filter((o) => o.status === 'completed');
  const sum = (f: (o: (typeof paid)[number]) => number) => paid.reduce((s, o) => s + f(o), 0);
  const cash = sum((o) => (o.payment_method === 'cash' ? o.total : 0));
  const card = sum((o) => (o.payment_method === 'card' ? o.total : 0));
  const expected = shift.opening_cash + cash;

  const byName = new Map<string, { qty: number; revenue: number }>();
  for (const o of paid) for (const it of o.items) {
    const cur = byName.get(it.name) ?? { qty: 0, revenue: 0 };
    byName.set(it.name, { qty: cur.qty + it.qty, revenue: cur.revenue + it.qty * (it.unit_price + it.modifiers_total) });
  }
  const items = [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);

  return {
    cashier, openedAt: shift.opened_at, closedAt: new Date().toISOString(),
    orders: paid.length, total: cash + card, cash, card, discounts: sum((o) => o.discount),
    opening: shift.opening_cash, expected, counted, diff: counted - expected, items,
  };
}

/** Shift handover: queues close_shift (works offline) and returns the figures for the printed receipt. */
export async function closeShift(counted: number, cashier: string): Promise<ShiftSummary | null> {
  const shift = await getLocalShift();
  if (!shift) return null;
  const summary = await summarizeShift(shift, counted, cashier);
  await db.transaction('rw', db.meta, db.outbox, async () => {
    await enqueue('close_shift', { id: shift.id, counted });
    await delMeta('shift');
  });
  kickSync();
  return summary;
}

/** Align the local shift with the server (e.g. shift opened on another device, or a new browser profile). */
export async function reconcileShift(userId: string) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const queued = await db.outbox.where('status').equals('pending').and((i) => i.type === 'open_shift' || i.type === 'close_shift').count();
  if (queued > 0) return; // local intent still in flight
  const { data, error } = await createClient().from('shifts').select('*').eq('cashier_id', userId).eq('status', 'open').maybeSingle();
  if (error) return;
  if (data) await setMeta('shift', { id: data.id, opened_at: data.opened_at, opening_cash: Number(data.opening_cash), status: 'open' } satisfies LocalShift);
  else await delMeta('shift');
}
