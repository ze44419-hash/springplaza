'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { applyOrderRow, pullOrder, refreshOrders } from '@/lib/orders';
import type { LocalOrder, Profile } from '@/lib/types';

interface Handlers {
  /** Cashier: a waiter just sent a new order. */
  onNewOrder?: (o: LocalOrder) => void;
  /** Waiter: one of my orders just became "ready". */
  onReady?: (o: LocalOrder) => void;
}

/**
 * Subscribes to Supabase Realtime (`orders` table) and mirrors every change into IndexedDB.
 * UI reads from IndexedDB, so it updates instantly and keeps working offline.
 * On (re)subscribe we run a catch-up fetch so events missed while disconnected are never lost.
 */
export function useOrdersRealtime(profile: Profile | null, handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!profile) return;
    const sb = createClient();

    const channel = sb
      .channel(`orders-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
        if (payload.eventType === 'DELETE') return;
        const row: any = payload.new;
        // INSERT needs the line items (one fetch); UPDATE only changes the order row, so apply it locally.
        const order = payload.eventType === 'UPDATE' ? (await applyOrderRow(row)) ?? (await pullOrder(row.id)) : await pullOrder(row.id);
        if (!order) return;

        if (payload.eventType === 'INSERT' && profile.role !== 'waiter' && row.waiter_id !== profile.id) {
          ref.current.onNewOrder?.(order);
        }
        if (payload.eventType === 'UPDATE') {
          const prev: any = payload.old;
          if (row.status === 'ready' && prev?.status !== 'ready' && row.waiter_id === profile.id) ref.current.onReady?.(order);
        }
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void refreshOrders(); });

    const onOnline = () => void refreshOrders();
    window.addEventListener('online', onOnline);
    void refreshOrders();

    return () => { window.removeEventListener('online', onOnline); void sb.removeChannel(channel); };
  }, [profile?.id, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps
}
