'use client';
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { cacheCatalog } from '@/lib/catalog';
import type { CafeTable, Category, Modifier, Product } from '@/lib/types';

const EMPTY: never[] = []; // stable reference → no needless re-renders while the first query resolves
const sortBy = <T,>(rows: T[], key: (r: T) => number) => rows.sort((a, b) => key(a) - key(b));

/** Menu data served from IndexedDB (live), refreshed from Supabase on mount and on reconnect. */
export function useCatalog() {
  useEffect(() => {
    void cacheCatalog();
    const onOnline = () => void cacheCatalog(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const categories = useLiveQuery(async () => sortBy(await db.categories.toArray(), (c) => c.sort_order), [], EMPTY as Category[]);
  const products = useLiveQuery(async () => sortBy(await db.products.toArray(), (p) => p.sort_order), [], EMPTY as Product[]);
  const modifiers = useLiveQuery(() => db.modifiers.toArray(), [], EMPTY as Modifier[]);
  const tables = useLiveQuery(async () => sortBy(await db.cafeTables.toArray(), (t) => t.sort_order), [], EMPTY as CafeTable[]);
  return { categories, products, modifiers, tables };
}
