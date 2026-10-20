'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Receipt, Store, Wallet } from 'lucide-react';
import { ErrorNote, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { money, qtyFmt } from '@/lib/format';
import { addDays, friendly, startOfDay } from '@/lib/util';
import type { Ingredient } from '@/lib/types';
import s from './admin.module.css';

export default function AdminHome() {
  const [today, setToday] = useState<any>(null);
  const [low, setLow] = useState<Ingredient[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    const s = startOfDay(new Date());
    (async () => {
      const [rep, stock] = await Promise.all([
        sb.rpc('sales_report', { p_from: s.toISOString(), p_to: addDays(s, 1).toISOString() }),
        sb.from('low_stock_ingredients').select('*').order('name'),
      ]);
      if (rep.error) setErr(friendly(rep.error.message)); else setToday(rep.data);
      setLow((stock.data as Ingredient[]) ?? []);
    })().catch((e) => setErr(friendly(e.message)));
  }, []);

  if (!today && !err) return <Spinner />;
  const openShifts = (today?.shifts ?? []).filter((x: any) => x.status === 'open');

  return (
    <div className={s.page}>
      <h1 className={s.title}>النهارده</h1>
      <ErrorNote message={err} />
      {today && (
        <div className={s.stats}>
          <Card icon={Wallet} label="المبيعات" value={money(today.totals.gross)} tone="fern" />
          <Card icon={Receipt} label="أوردرات مدفوعة" value={String(today.totals.orders)} />
          <Card icon={Store} label="شيفتات مفتوحة" value={String(openShifts.length)} hint={openShifts.map((x: any) => x.cashier).join(', ')} />
          <Card icon={AlertTriangle} label="خامات قربت تخلص" value={String(low?.length ?? 0)} tone={low && low.length > 0 ? 'warn' : undefined} />
        </div>
      )}
      <section>
        <div className={s.sectionHead}><h2 className={s.sectionTitle}>محتاجة تتوّرد</h2><Link href="/admin/inventory" className={s.link}>المخزون <ArrowLeft size={16} /></Link></div>
        <div className={s.list}>
          {(low ?? []).map((i) => (
            <div key={i.id} className={s.listRow}><span className={s.rowName}>{i.name}</span>
              <span><b className={s.low}>{qtyFmt(i.stock_qty)} {i.unit}</b> <span className={s.muted}>/ حد التنبيه {qtyFmt(i.min_threshold)}</span></span></div>
          ))}
          {low && low.length === 0 && <p className={s.okMsg}>كل الخامات فوق حد التنبيه.</p>}
        </div>
      </section>
    </div>
  );
}

function Card({ icon: Icon, label, value, hint, tone }: { icon: any; label: string; value: string; hint?: string; tone?: 'fern' | 'warn' }) {
  return (
    <div className={`${s.stat} ${tone === 'fern' ? s.statFern : tone === 'warn' ? s.statWarn : ''}`}>
      <Icon size={20} className={s.statIcon} /><p className={s.statLabel}>{label}</p>
      <p className={s.statValue}>{value}</p>{hint && <p className={s.statHint}>{hint}</p>}
    </div>
  );
}
