import { db, type OutboxType } from './db';

/** Append a write to the offline queue. Call inside the same Dexie transaction as the local optimistic update. */
export function enqueue(type: OutboxType, payload: Record<string, unknown>, orderId?: string) {
  return db.outbox.add({ type, payload, orderId, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0, status: 'pending' });
}

/** Wake the sync engine (it also runs on `online`, on tab focus and on a timer). */
export const kickSync = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('outbox:changed'));
};
