import { db } from './db';
import { enqueue, kickSync } from './outbox';
import { createClient } from './supabase/client';
import { uuid } from './format';
import type { LocalOrder, Modifier, OrderItem, OrderKind, OrderStatus, OrderType, PayMethod, Product } from './types';

export interface CartLine { product: Product; qty: number; modifiers: Modifier[]; note?: string }

const ACTIVE: OrderStatus[] = ['new', 'preparing', 'ready'];
export const isActive = (o: Pick<LocalOrder, 'status'>) => ACTIVE.includes(o.status);

export const lineUnitTotal = (l: CartLine) => l.product.price + l.modifiers.reduce((s, m) => s + m.price_delta, 0);
export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + lineUnitTotal(l) * l.qty, 0);

/**
 * Waiter sends an order. It is written to IndexedDB immediately (so it shows up in "My orders" even offline)
 * and queued for the server. The order id is generated here, which makes the RPC idempotent on retry.
 */
export async function submitOrder(args: {
  waiterId: string; orderType: OrderType; tableId: string | null; notes?: string; lines: CartLine[];
  /** 'employee' (needs employeeId) or 'hospitality' → goes through create_special_order and waits for approval. */
  kind?: OrderKind; employeeId?: string | null;
}): Promise<LocalOrder> {
  const id = uuid();
  const now = new Date().toISOString();
  const special = !!args.kind && args.kind !== 'standard';

  const items: OrderItem[] = args.lines.map((l, i) => ({
    id: uuid(), order_id: id, product_id: l.product.id, name: l.product.name, unit_price: l.product.price, qty: l.qty,
    modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.name, price_delta: m.price_delta })),
    modifiers_total: l.modifiers.reduce((s, m) => s + m.price_delta, 0), note: l.note?.trim() || null, position: i + 1,
  }));
  const subtotal = cartTotal(args.lines);

  const order: LocalOrder = {
    id, order_no: null, order_type: args.orderType, order_kind: args.kind ?? 'standard', table_id: args.tableId, waiter_id: args.waiterId, status: 'new',
    notes: args.notes?.trim() || null, subtotal, discount: 0, total: subtotal, payment_method: null, amount_tendered: null,
    paid_at: null, shift_id: null, cashier_id: null, created_at: now, updated_at: now, items, pending: true,
  };

  await db.transaction('rw', db.orders, db.outbox, async () => {
    await db.orders.put(order);
    await enqueue(special ? 'create_special_order' : 'create_order', {
      id, order_type: args.orderType, table_id: args.tableId, notes: order.notes, client_created_at: now,
      ...(special ? { order_kind: args.kind, staff_id: args.employeeId ?? null } : {}),
      items: args.lines.map((l) => ({ product_id: l.product.id, qty: l.qty, modifier_ids: l.modifiers.map((m) => m.id), note: l.note?.trim() || null })),
    }, id);
  });
  kickSync();
  return order;
}

export async function queueStatus(orderId: string, status: Exclude<OrderStatus, 'new' | 'completed'>) {
  await db.transaction('rw', db.orders, db.outbox, async () => {
    await db.orders.update(orderId, { status, pending: true, updated_at: new Date().toISOString() });
    await enqueue('set_status', { id: orderId, status }, orderId);
  });
  kickSync();
}

export async function queuePayment(order: LocalOrder, method: PayMethod, tendered: number | null, discount: number, shiftId: string | null) {
  const d = Math.min(Math.max(discount, 0), order.subtotal);
  await db.transaction('rw', db.orders, db.outbox, async () => {
    await db.orders.update(order.id, {
      status: 'completed', payment_method: method, amount_tendered: tendered, discount: d, total: order.subtotal - d,
      paid_at: new Date().toISOString(), shift_id: shiftId, pending: true,
    });
    await enqueue('pay_order', { id: order.id, method, tendered, discount: d }, order.id);
  });
  kickSync();
}

/** Store a server row locally — unless this device still has unsent changes for it (local intent wins until synced). */
export async function mergeServerOrder(row: any) {
  const unsent = await db.outbox.where('orderId').equals(row.id).and((i) => i.status === 'pending').count();
  if (unsent > 0) return;
  const { order_items, ...order } = row;
  const items = [...(order_items ?? [])].sort((a: OrderItem, b: OrderItem) => a.position - b.position);
  await db.orders.put({ ...order, items, pending: false });
}

/** Apply a realtime UPDATE row onto the local copy (items don't change on updates) — no network round-trip. */
export async function applyOrderRow(row: any): Promise<LocalOrder | null> {
  const local = await db.orders.get(row.id);
  if (!local) return null;
  // The admin edited the order (items may have changed) → refetch it with its lines instead of patching the row.
  if (row.edited_at && row.edited_at !== local.edited_at) return pullOrder(row.id);
  const unsent = await db.outbox.where('orderId').equals(row.id).and((i) => i.status === 'pending').count();
  if (unsent === 0) await db.orders.update(row.id, { ...row, pending: false });
  return (await db.orders.get(row.id)) ?? null;
}

export async function pullOrder(id: string): Promise<LocalOrder | null> {
  const { data } = await createClient().from('orders').select('*, order_items(*)').eq('id', id).maybeSingle();
  if (!data) return null;
  await mergeServerOrder(data);
  return (await db.orders.get(id)) ?? null;
}

/** Catch-up fetch: all open orders + everything created in the last 24 h (RLS scopes waiters to their own). */
export async function refreshOrders() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await createClient()
    .from('orders').select('*, order_items(*)')
    .or(`status.in.(new,preparing,ready),created_at.gte.${since}`)
    .order('created_at', { ascending: false }).limit(400);
  if (error || !data) return;
  for (const row of data) await mergeServerOrder(row);
  // housekeeping: drop synced orders older than 3 days from the local cache
  const cutoff = new Date(Date.now() - 3 * 86400_000).toISOString();
  await db.orders.where('created_at').below(cutoff).and((o) => !o.pending && !isActive(o)).delete();
}
