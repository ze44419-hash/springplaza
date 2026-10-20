'use client';
import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import clsx from 'clsx';
import { getPaper, PaperToggle, usePrint, type Paper } from '@/components/Print';
import { ErrorNote, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { fmtDateTime, LOCALE, money } from '@/lib/format';
import { addDays, friendly, startOfDay, toInputDate } from '@/lib/util';
import s from './reports.module.css';

interface Report {
  totals: { orders: number; gross: number; cash: number; card: number; discounts: number };
  top_products: { name: string; qty: number; revenue: number }[];
  shifts: { id: string; opened_at: string; closed_at: string | null; status: 'open' | 'closed'; opening_cash: number; closing_cash_counted: number | null; expected_cash: number | null; cashier: string; orders: number; total: number; cash: number; card: number }[];
}
type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function rangeFor(p: Preset, from: string, to: string): [Date, Date] {
  const today = startOfDay(new Date());
  switch (p) {
    case 'today': return [today, addDays(today, 1)];
    case 'yesterday': return [addDays(today, -1), today];
    case 'week': { const monday = addDays(today, -((today.getDay() + 6) % 7)); return [monday, addDays(today, 1)]; }
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
    default: return [startOfDay(new Date(from)), addDays(startOfDay(new Date(to)), 1)]; // inclusive end date
  }
}
const PRESETS: [Preset, string][] = [['today', 'النهارده'], ['yesterday', 'امبارح'], ['week', 'الأسبوع ده'], ['month', 'الشهر ده'], ['custom', 'فترة مخصصة']];

export default function ReportsAdmin() {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(toInputDate(new Date()));
  const [to, setTo] = useState(toInputDate(new Date()));
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paper, setPaper] = useState<Paper>(80);
  const { print, portal } = usePrint();
  useEffect(() => setPaper(getPaper()), []);

  const [start, end] = rangeFor(preset, from, to);
  const label = `${start.toLocaleDateString(LOCALE)} – ${addDays(end, -1).toLocaleDateString(LOCALE)}`;

  const load = useCallback(async () => {
    if (preset === 'custom' && (!from || !to || from > to)) { setErr('اختار فترة صحيحة.'); return; }
    setData(null); setErr(null);
    const [s, e] = rangeFor(preset, from, to);
    const { data: d, error } = await createClient().rpc('sales_report', { p_from: s.toISOString(), p_to: e.toISOString() });
    if (error) { setErr(friendly(error.message)); return; }
    setData(d as Report);
  }, [preset, from, to]);
  useEffect(() => { void load(); }, [load]);

  const drawerDiff = (s: Report['shifts'][number]) => (s.status === 'closed' && s.closing_cash_counted != null && s.expected_cash != null ? s.closing_cash_counted - s.expected_cash : null);

  return (
    <div className={s.page}>
      <div className={s.filters}>
        {PRESETS.map(([k, l]) => <button key={k} onClick={() => setPreset(k)} aria-pressed={preset === k} className={clsx(s.preset, preset === k && s.presetOn)}>{l}</button>)}
        {preset === 'custom' && (
          <span className={s.dates}>
            <input aria-label="من" type="date" className={`input ${s.dateInput}`} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input aria-label="إلى" type="date" className={`input ${s.dateInput}`} value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
        <span className={s.tools}>
          <PaperToggle value={paper} onChange={setPaper} />
          <button className="btn-accent btn-sm" disabled={!data} onClick={() => data && print(<ReportSheet data={data} label={label} />, paper)}><Printer size={16} /> اطبع التقرير</button>
        </span>
      </div>
      <ErrorNote message={err} />
      {!data && !err ? <Spinner /> : data && (
        <>
          <div className={s.tiles}>
            <Tile label="إجمالي المبيعات" value={money(data.totals.gross)} big />
            <Tile label="الأوردرات" value={String(data.totals.orders)} />
            <Tile label="كاش" value={money(data.totals.cash)} />
            <Tile label="كارت" value={money(data.totals.card)} />
          </div>

          <section>
            <h2 className={s.sectionTitle}>شيفتات الكاشير</h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr>{['الكاشير', 'فتح', 'إغلاق', 'الأوردرات', 'المبيعات', 'كاش', 'كارت', 'الدرج'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {data.shifts.map((sh) => {
                    const diff = drawerDiff(sh);
                    const expected = sh.expected_cash ?? sh.opening_cash + sh.cash;
                    return (
                      <tr key={sh.id}>
                        <td className={`td ${s.cashier}`}>{sh.cashier}</td><td className={`td ${s.nowrap}`}>{fmtDateTime(sh.opened_at)}</td>
                        <td className={`td ${s.nowrap}`}>{sh.status === 'open' ? <span className="chip bg-fern-light text-fern-ink">مفتوح</span> : fmtDateTime(sh.closed_at)}</td>
                        <td className="td">{sh.orders}</td><td className={`td ${s.strong}`}>{money(sh.total)}</td><td className="td">{money(sh.cash)}</td><td className="td">{money(sh.card)}</td>
                        <td className={`td ${s.nowrap}`}>{money(expected)}{diff !== null && <span className={clsx('ms-2 chip', diff === 0 ? 'bg-fern-light text-fern-ink' : 'bg-sun-light text-sun-ink')}>{diff === 0 ? 'مظبوط' : `${diff > 0 ? '+' : ''}${money(diff)}`}</span>}</td>
                      </tr>
                    );
                  })}
                  {data.shifts.length === 0 && <tr><td className={`td ${s.empty}`} colSpan={8}>مفيش شيفتات في الفترة دي.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className={s.footnote}>الدرج = رصيد أول الشيفت + مبيعات الكاش (المتوقع). الشارة بتبيّن الفرق بعد الجرد في الشيفتات المقفولة.</p>
          </section>

          <section>
            <h2 className={s.sectionTitle}>الأكثر مبيعًا</h2>
            <div className={s.top}>
              {data.top_products.map((p) => <div key={p.name} className={s.topRow}><span className={s.topName}>{p.name}</span><span className={s.topMeta}>{p.qty} اتباع · <b>{money(p.revenue)}</b></span></div>)}
              {data.top_products.length === 0 && <p className={s.empty} style={{ padding: 16 }}>مفيش مبيعات في الفترة دي.</p>}
            </div>
          </section>
        </>
      )}
      {portal}
    </div>
  );
}

const Tile = ({ label, value, big }: { label: string; value: string; big?: boolean }) => (
  <div className={clsx(s.tile, big && s.tileBig)}><p className={s.tileLabel}>{label}</p><p className={s.tileValue}>{value}</p></div>
);

/** Thermal-roll layout of the period report (58/80 mm). */
function ReportSheet({ data, label }: { data: Report; label: string }) {
  const n = (x: number) => Number(x).toFixed(2);
  return (
    <>
      <h1>{process.env.NEXT_PUBLIC_CAFE_NAME || 'سبرينج بلازا كافيه'}</h1>
      <p className="center">تقرير المبيعات</p><p className="center">{label}</p><div className="rule" />
      <div className="row"><span>الأوردرات</span><span>{data.totals.orders}</span></div>
      <div className="row"><span>كاش</span><span>{n(data.totals.cash)}</span></div>
      <div className="row"><span>كارت</span><span>{n(data.totals.card)}</span></div>
      {data.totals.discounts > 0 && <div className="row"><span>الخصومات</span><span>-{n(data.totals.discounts)}</span></div>}
      <div className="row big"><span>الإجمالي</span><span>{n(data.totals.gross)}</span></div>
      <div className="rule" /><p className="center">الشيفتات</p>
      {data.shifts.map((s) => (
        <div key={s.id} style={{ marginBottom: 4 }}>
          <div className="row"><span>{s.cashier}</span><span>{n(s.total)}</span></div>
          <div className="sub">{new Date(s.opened_at).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · {s.orders} أوردر</div>
          <div className="sub">الدرج {n(s.expected_cash ?? s.opening_cash + s.cash)}{s.closing_cash_counted != null && s.expected_cash != null ? ` (الفعلي ${n(s.closing_cash_counted)})` : ''}</div>
        </div>
      ))}
      <div className="rule" /><p className="center">الأصناف الأكثر مبيعًا</p>
      {data.top_products.slice(0, 8).map((p) => <div key={p.name} className="row"><span>{p.qty} x {p.name}</span><span>{n(p.revenue)}</span></div>)}
      <div className="rule" /><p className="center">طُبع {new Date().toLocaleString(LOCALE)}</p>
    </>
  );
}
