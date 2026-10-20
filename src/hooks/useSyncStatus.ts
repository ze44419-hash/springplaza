'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useOnline } from './useOnline';

export function useSyncStatus() {
  const online = useOnline();
  const pending = useLiveQuery(() => db.outbox.where('status').equals('pending').count(), [], 0);
  const failed = useLiveQuery(() => db.outbox.where('status').equals('failed').count(), [], 0);
  return { online, pending, failed };
}
