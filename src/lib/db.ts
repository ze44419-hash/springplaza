import Dexie, { type Table } from 'dexie';
import type { CafeTable, Category, LocalOrder, LocalShift, Modifier, Product } from './types';

export type OutboxType = 'create_order' | 'create_special_order' | 'set_status' | 'pay_order' | 'open_shift' | 'close_shift';

/** One queued write. Items are replayed strictly in `seq` order so causality is preserved
 *  (e.g. create_order → set_status → pay_order for the same order). */
export interface OutboxItem {
  seq?: number;
  type: OutboxType;
  orderId?: string;          // indexed so we can tell which orders still have unsynced changes
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: 'pending' | 'failed';
  lastError?: string;
}

export interface MetaRow { key: string; value: unknown }

class CafeDB extends Dexie {
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  modifiers!: Table<Modifier, string>;
  cafeTables!: Table<CafeTable, string>;
  orders!: Table<LocalOrder, string>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('spring-plaza-cafe');
    this.version(1).stores({
      categories: 'id, sort_order',
      products: 'id, category_id',
      modifiers: 'id',
      cafeTables: 'id, sort_order',
      orders: 'id, status, waiter_id, created_at',
      outbox: '++seq, orderId, status, nextAttemptAt',
      meta: 'key',
    });
    // v2: shift_id index → shift totals are an index lookup instead of scanning every order.
    this.version(2).stores({ orders: 'id, status, waiter_id, created_at, shift_id' });
    // v3: products were queried with orderBy('sort_order') but that field was never indexed → SchemaError.
    this.version(3).stores({ products: 'id, category_id, sort_order', modifiers: 'id, name' });
  }
}

export const db = new CafeDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });
export const delMeta = (key: string) => db.meta.delete(key);

// Convenience for shift state (cashier device).
export const getLocalShift = () => getMeta<LocalShift>('shift');
