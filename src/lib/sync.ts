import { db, type OutboxItem } from './db';
import { pullOrder } from './orders';
import { createClient } from './supabase/client';
import { arabicError } from './util';

/**
 * Offline sync engine.
 *
 * Every write made while offline sits in the `outbox` table (IndexedDB). When connectivity returns the queue is
 * replayed strictly in order through server RPCs that are idempotent (client-generated ids), so a retry after a
 * dropped response can never create duplicates.
 *
 * Failure handling:
 *  - network / 5xx / 429 / expired JWT → transient: exponential back-off (max 60 s), queue order is preserved
 *  - business error (e.g. product removed, no open shift) → permanent: item is parked as `failed`, the order is
 *    flagged with `sync_error`, and the queue moves on.
 */

type RpcError = { message: string; code?: string };
type RpcResult = { error: RpcError | null; status: number };

function rpcFor(item: OutboxItem): [string, Record<string, unknown>] {
  const p = item.payload as any;
  switch (item.type) {
    case 'create_order': return ['create_order', { p }];
    case 'create_special_order': return ['create_special_order', { p }];
    case 'set_status':   return ['set_order_status', { p_id: p.id, p_status: p.status }];
    case 'pay_order':    return ['pay_order', { p_id: p.id, p_method: p.method, p_tendered: p.tendered, p_discount: p.discount }];
    case 'open_shift':   return ['open_shift', { p_id: p.id, p_opening: p.opening }];
    case 'close_shift':  return ['close_shift', { p_id: p.id, p_counted: p.counted }];
  }
}

async function execute(item: OutboxItem): Promise<RpcResult> {
  try {
    const [fn, args] = rpcFor(item);
    const res = await createClient().rpc(fn, args);
    return { error: res.error ? { message: res.error.message, code: res.error.code } : null, status: res.status };
  } catch (e: any) {
    return { error: { message: e?.message ?? 'Network error' }, status: 0 };
  }
}

function isTransient(r: RpcResult) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const { status, error } = r;
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500 || error?.code === 'PGRST301';
}

const backoff = (attempts: number) => Math.min(60_000, 1000 * 2 ** attempts);
let running = false;

export async function processOutbox(): Promise<void> {
  if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  running = true;
  try {
    for (;;) {
      const item = await db.outbox.where('status').equals('pending').first(); // lowest seq first
      if (!item || item.nextAttemptAt > Date.now()) break;

      const res = await execute(item);

      if (!res.error) {
        await db.outbox.delete(item.seq!);
        if (item.orderId) await pullOrder(item.orderId).catch(() => {}); // adopt server truth (order_no, totals…)
        continue;
      }

      if (isTransient(res)) {
        if (res.status === 401) await createClient().auth.refreshSession().catch(() => {});
        const attempts = item.attempts + 1;
        await db.outbox.update(item.seq!, { attempts, lastError: res.error.message, nextAttemptAt: Date.now() + backoff(attempts) });
        break; // keep order: don't skip ahead of a stuck item
      }

      // Permanent failure: park it and surface it.
      await db.outbox.update(item.seq!, { status: 'failed', lastError: arabicError(res.error.message), attempts: item.attempts + 1 });
      if (item.orderId) {
        if (item.type === 'create_order' || item.type === 'create_special_order') {
          await db.orders.update(item.orderId, { pending: false, status: 'cancelled', sync_error: arabicError(res.error.message) });
          // later queued changes for a never-created order can't succeed either
          await db.outbox.where('orderId').equals(item.orderId).and((i) => i.status === 'pending').modify({ status: 'failed', lastError: 'الأوردر اترفض' });
        } else {
          await pullOrder(item.orderId).catch(() => {});
          await db.orders.update(item.orderId, { sync_error: arabicError(res.error.message) });
        }
      }
    }
  } finally {
    running = false;
  }
}

export const retryFailed = async () => {
  await db.outbox.where('status').equals('failed').modify({ status: 'pending', nextAttemptAt: 0 });
  await processOutbox();
};
export const discardFailed = () => db.outbox.where('status').equals('failed').delete();

/** Start listeners + a heartbeat. Returns a cleanup function. */
export function startSyncEngine() {
  const run = () => void processOutbox();
  const onVisible = () => { if (!document.hidden) run(); };
  window.addEventListener('online', run);
  window.addEventListener('outbox:changed', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(run, 10_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('outbox:changed', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
