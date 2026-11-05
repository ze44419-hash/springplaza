'use client';
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/offline/db';
import { cacheCatalog } from '@/lib/services/catalog';
import type { CafeTable, Category, Modifier, Product } from '@/lib/types';

const EMPTY: never[] = []; // stable reference → no needless re-renders while the first query resolves

/** Menu data served from IndexedDB (live), refreshed from Supabase on mount and on reconnect. */
export function useCatalog() {
  useEffect(() => {
    void cacheCatalog();
    const onOnline = () => void cacheCatalog(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const categories = useLiveQuery(() => db.categories.orderBy('sort_order').toArray(), [], EMPTY as Category[]);
  const products = useLiveQuery(() => db.products.orderBy('sort_order').toArray(), [], EMPTY as Product[]);
  const modifiers = useLiveQuery(() => db.modifiers.toArray(), [], EMPTY as Modifier[]);
  const tables = useLiveQuery(() => db.cafeTables.orderBy('sort_order').toArray(), [], EMPTY as CafeTable[]);
  return { categories, products, modifiers, tables };
}
