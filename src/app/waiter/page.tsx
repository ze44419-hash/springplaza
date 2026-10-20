'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UtensilsCrossed } from 'lucide-react';
import clsx from 'clsx';
import AppShell from '@/components/AppShell';
import OrderTaker from '@/components/OrderTaker';
import { useNotify } from '@/components/Providers';
import { Empty, StatusBadge } from '@/components/kit';
import { useCatalog } from '@/hooks/useCatalog';
import s from './waiter.module.css';
import { useOrdersRealtime } from '@/hooks/useOrdersRealtime';
import { useProfile } from '@/hooks/useProfile';
import { db } from '@/lib/db';
import { destText, orderLabel, timeAgo } from '@/lib/format';
import type { LocalOrder } from '@/lib/types';

/** شاشة الكابتن (role = waiter في قاعدة البيانات). */
export default function CaptainPage() {
  const { profile } = useProfile();
  const notify = useNotify();
  const { tables } = useCatalog();
  const [tab, setTab] = useState<'order' | 'mine'>('order');

  const myOrders = useLiveQuery(async () => {
    if (!profile) return [] as LocalOrder[];
    const rows = await db.orders.where('waiter_id').equals(profile.id).sortBy('created_at');
    return rows.reverse();
  }, [profile?.id], [] as LocalOrder[]);

  // Real-time "ready" alert for this captain's orders.
  useOrdersRealtime(profile, {
    onReady: (o) => notify({ title: `أوردر ${destText(o, tables)} جاهز للاستلام`, body: `${orderLabel(o)} · ${o.items.length} صنف`, tone: 'success', sound: 'ready' }),
  });

  const readyCount = myOrders.filter((o) => o.status === 'ready').length;

  return (
    <AppShell subtitle="كابتن">
      <div className={s.page}>
        <div className={s.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'order'} className={clsx(s.tab, tab === 'order' && s.tabActive)} onClick={() => setTab('order')}>أوردر جديد</button>
          <button role="tab" aria-selected={tab === 'mine'} className={clsx(s.tab, tab === 'mine' && s.tabActive)} onClick={() => setTab('mine')}>
            أوردراتي
            {readyCount > 0 && <span className={s.readyPill}>{readyCount} جاهز</span>}
          </button>
        </div>

        {tab === 'mine' ? <MyOrders orders={myOrders} tables={tables} /> : profile && <OrderTaker profile={profile} onSent={() => setTab('order')} />}
      </div>
    </AppShell>
  );
}

function MyOrders({ orders, tables }: { orders: LocalOrder[]; tables: { id: string; label: string }[] }) {
  if (orders.length === 0) return <Empty title="مفيش أوردرات لسه" hint="الأوردرات اللي تبعتها بتظهر هنا مع حالتها لحظة بلحظة." />;
  return (
    <ul className={s.orders}>
      {orders.slice(0, 40).map((o) => (
        <li key={o.id} className={clsx(s.order, o.status === 'ready' && s.orderReady)}>
          <div className={s.orderHead}>
            <h3 className={s.orderTitle}>{destText(o, tables)} <span className={s.orderNo}><bdi>{orderLabel(o)}</bdi></span></h3>
            <StatusBadge status={o.status} />
          </div>
          <p className={s.when}>{timeAgo(o.created_at)}</p>
          <ul className={s.items}>
            {o.items.map((it) => <li key={it.id}>{it.qty}× {it.name}{it.modifiers.length > 0 && <span className={s.itemMods}> ({it.modifiers.map((m) => m.name).join('، ')})</span>}</li>)}
          </ul>
          {o.status === 'ready' && <p className={s.readyMsg}><UtensilsCrossed size={18} /> جاهز للاستلام</p>}
          {o.pending && <p className={s.wait}>مستني المزامنة…</p>}
          {o.sync_error && <p className={s.err}>الأوردر ما اتقبلش: {o.sync_error}</p>}
        </li>
      ))}
    </ul>
  );
}
