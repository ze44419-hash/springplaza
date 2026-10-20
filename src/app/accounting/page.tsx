'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import PeriodPicker, { type Period } from '@/components/PeriodPicker';
import { ErrorNote, Spinner } from '@/components/kit';
import { getSummary, scopeLabel } from '@/lib/accounting';
import { money } from '@/lib/format';
import { friendly } from '@/lib/util';
import type { AccountingSummary } from '@/lib/types';
import s from './accounting.module.css';

/** Accountant dashboard: revenue (café + hall), expenses, net profit and the partners' preview for any period. */
export default function AccountingHome() {
  const [data, setData] = useState<AccountingSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setData(null); setErr(null);
    try { setData(await getSummary(p.from, p.to)); } catch (e: any) { setErr(friendly(e.message)); }
  }, []);

  const maxDay = Math.max(1, ...(data?.daily ?? []).map((d) => Math.max(d.cafe + d.hall, d.expenses)));
  const maxCat = Math.max(1, ...(data?.expenses_by_category ?? []).map((c) => c.total));

  return (
    <div className={s.page}>
      <h1 className={s.title}>لوحة المحاسبة</h1>
      <PeriodPicker onChange={load} />
      <ErrorNote message={err} />
      {!data && !err && <Spinner />}
      {data && (
        <>
          <div className={s.tiles}>
            <Tile label="إيرادات الكافيه" value={money(data.cafe_revenue)} hint={`${data.cafe_orders} أوردر مدفوع`} />
            <Tile label="إيرادات القاعة" value={money(data.hall_revenue)} hint={`${data.hall_bookings} حجز منتهي`} />
            <Tile label="إجمالي الإيرادات" value={money(data.total_revenue)} />
            <Tile label="تكلفة البضاعة المباعة (COGS)" value={money(data.cogs_total)} hint={`مجمل الربح ${money(data.gross_profit)}`} />
            <Tile label="المصروفات التشغيلية" value={money(data.expenses_total)} />
            <div className={clsx(s.tile, s.net, data.net_profit < 0 && s.loss)}>
              <p className={s.tileLabel}>{data.net_profit < 0 ? 'صافي الخسارة' : 'صافي الربح'}</p>
              <p className={clsx('num', s.tileValue)}>{money(data.net_profit)}</p>
              <p className={s.formula}>(الإيرادات − COGS) − المصروفات التشغيلية</p>
            </div>
          </div>

          <section>
            <h2 className={s.sectionTitle}>الإيرادات والمصروفات يوميًا</h2>
            <div className={s.card}>
              <div className={s.chart} role="img" aria-label="رسم بياني يومي للإيرادات والمصروفات">
                {data.daily.map((d) => (
                  <div key={d.day} className={s.col} title={`${d.day}\nكافيه: ${money(d.cafe)}\nقاعة: ${money(d.hall)}\nمصروفات: ${money(d.expenses)}`}>
                    <div className={s.stack} style={{ height: `${((d.cafe + d.hall) / maxDay) * 78}%` }}>
                      <div className={s.segCafe} style={{ flex: d.cafe }} /><div className={s.segHall} style={{ flex: d.hall }} />
                    </div>
                    <div className={s.exp} style={{ height: `${(d.expenses / maxDay) * 18}%` }} />
                    <span className={clsx('num', s.day)}>{Number(d.day.slice(8))}</span>
                  </div>
                ))}
              </div>
              <div className={s.chartLegend}>
                <span><i className={s.sw} style={{ background: 'var(--fern)' }} />كافيه</span>
                <span><i className={s.sw} style={{ background: 'var(--blossom)' }} />قاعة</span>
                <span><i className={s.sw} style={{ background: 'var(--sun)' }} />مصروفات</span>
              </div>
            </div>
          </section>

          <div className={s.two}>
            <section>
              <h2 className={s.sectionTitle}>المصروفات حسب البند</h2>
              <div className={s.card}>
                {data.expenses_by_category.length === 0 ? <p className={s.muted}>مفيش مصروفات في الفترة دي.</p> : data.expenses_by_category.map((c) => (
                  <div key={c.category} className={s.rowBar}>
                    <div className={s.rowTop}><span>{c.category}</span><span className="num">{money(c.total)}</span></div>
                    <div className={s.track}><div className={s.fill} style={{ width: `${(c.total / maxCat) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              {data.expenses_by_scope.length > 0 && (
                <p className={s.formula} style={{ marginTop: 8 }}>{data.expenses_by_scope.map((x) => `${scopeLabel[x.scope]}: ${money(x.total)}`).join('  ·  ')}</p>
              )}
            </section>

            <section>
              <h2 className={s.sectionTitle}>حصص الشركاء (معاينة)</h2>
              {data.active_partners === 0 ? <p className={s.warn}>مفيش شركاء نشطين. <Link href="/accounting/partners" className={s.link}>ضيف الشركاء</Link></p> : (
                <div className={s.card}>
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead><tr><th className="th">الشريك</th><th className="th">النسبة</th><th className="th">الحصة</th></tr></thead>
                      <tbody>{data.partners.map((p) => (
                        <tr key={p.partner_id}><td className="td font-bold">{p.name}</td><td className="td num">{p.share_pct}%</td><td className="td num font-bold">{money(p.amount)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className={s.cardPad}><Link href="/accounting/profit" className={s.link}>اعتماد التوزيع <ArrowLeft size={16} /></Link></div>
                </div>
              )}
              {data.active_partners > 0 && Number(data.shares_total) !== 100 && <p className={s.warn} style={{ marginTop: 8 }}>مجموع النسب {data.shares_total}% — لازم يكون 100% قبل اعتماد التوزيع.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className={s.tile}><p className={s.tileLabel}>{label}</p><p className={clsx('num', s.tileValue)}>{value}</p>{hint && <p className={s.tileHint}>{hint}</p>}</div>
);
