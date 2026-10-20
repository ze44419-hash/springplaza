'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import clsx from 'clsx';
import PeriodPicker, { type Period } from '@/components/PeriodPicker';
import { Empty, ErrorNote, Spinner } from '@/components/kit';
import { distributeProfit, getSummary, loadDistributions } from '@/lib/accounting';
import { exportAccountingXlsx } from '@/lib/accountingExport';
import { LOCALE, money } from '@/lib/format';
import { friendly } from '@/lib/util';
import type { AccountingSummary, ProfitDistribution } from '@/lib/types';
import s from './profit.module.css';

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE);

/** Pick any period → see the net profit and each partner's share → approve to save an immutable distribution. */
export default function ProfitPage() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [data, setData] = useState<AccountingSummary | null>(null);
  const [history, setHistory] = useState<ProfitDistribution[] | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadHistory = useCallback(async () => { try { setHistory(await loadDistributions()); } catch (e: any) { setErr(friendly(e.message)); setHistory([]); } }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const load = useCallback(async (p: Period) => {
    setPeriod(p); setData(null); setErr(null); setOk(null);
    try { setData(await getSummary(p.from, p.to)); } catch (e: any) { setErr(friendly(e.message)); }
  }, []);

  const overlap = period && history?.find((h) => h.period_from <= period.to && h.period_to >= period.from);
  const sharesOk = data ? Number(data.shares_total) === 100 && data.active_partners > 0 : false;
  const canApprove = !!data && data.net_profit > 0 && sharesOk && !overlap;

  async function approve() {
    if (!period || !data) return;
    if (!confirm(`اعتماد توزيع ${money(data.net_profit)} على الشركاء عن الفترة ${fmt(period.from)} – ${fmt(period.to)}؟ مش هتقدر تعدّله بعد كده.`)) return;
    setBusy(true); setErr(null); setOk(null);
    try { await distributeProfit(period.from, period.to, note); setOk('تم اعتماد التوزيع وحفظه.'); setNote(''); await loadHistory(); }
    catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  async function exportXlsx() {
    if (!period) return;
    setExporting(true); setErr(null);
    try { await exportAccountingXlsx(period.from, period.to); } catch (e: any) { setErr(friendly(e.message)); } finally { setExporting(false); }
  }

  return (
    <div className={s.page}>
      <h1 className={s.title}>توزيع الأرباح</h1>
      <PeriodPicker onChange={load} />
      <ErrorNote message={err} />
      {ok && <p role="status" className="rounded-xl bg-fern-light px-3 py-2 text-sm font-bold text-fern-ink">{ok}</p>}
      {!data && !err && <Spinner />}

      {data && (
        <section>
          <div className={s.card}>
            <div className={s.calc}>
              <div className={s.row}><span>إيرادات الكافيه</span><span className="num">{money(data.cafe_revenue)}</span></div>
              <div className={s.row}><span>إيرادات القاعة</span><span className="num">{money(data.hall_revenue)}</span></div>
              <div className={s.row}><span>تكلفة البضاعة المباعة (COGS)</span><span className="num">- {money(data.cogs_total)}</span></div>
              <div className={s.row}><span>المصروفات التشغيلية</span><span className="num">- {money(data.expenses_total)}</span></div>
              <div className={clsx(s.row, s.net, data.net_profit <= 0 && s.netLoss)}><span>{data.net_profit < 0 ? 'صافي الخسارة' : 'صافي الربح'}</span><span className="num">{money(data.net_profit)}</span></div>
            </div>
            {data.active_partners === 0 ? <p className={s.muted}>مفيش شركاء نشطين. <Link href="/accounting/partners" className="font-bold text-fern-ink">ضيف الشركاء</Link></p> : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th className="th">الشريك</th><th className="th">النسبة</th><th className="th">الحصة</th></tr></thead>
                  <tbody>{data.partners.map((p) => <tr key={p.partner_id}><td className="td font-bold">{p.name}</td><td className="td num">{p.share_pct}%</td><td className="td num font-bold">{money(p.amount)}</td></tr>)}</tbody>
                  <tfoot><tr><td className="td">الإجمالي</td><td className="td num">{data.shares_total}%</td><td className="td num">{money(data.partners.reduce((a, p) => a + Number(p.amount), 0))}</td></tr></tfoot>
                </table>
              </div>
            )}
            <div className={s.confirm}>
              {!sharesOk && data.active_partners > 0 && <p className={s.warn}>مجموع النسب {data.shares_total}% — لازم يساوي 100% علشان تعتمد التوزيع. <Link href="/accounting/partners" className="underline">عدّل النسب</Link></p>}
              {data.net_profit <= 0 && <p className={s.warn}>مفيش صافي ربح موجب في الفترة دي، فمفيش حاجة تتوزّع.</p>}
              {overlap && <p className={s.warn}>الفترة دي بتتقاطع مع توزيع معتمد ({fmt(overlap.period_from)} – {fmt(overlap.period_to)}). اختار فترة مختلفة علشان متصرفش الربح مرتين.</p>}
              <input className="input" placeholder="ملاحظة على التوزيع (اختياري)" aria-label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-ghost" disabled={exporting} onClick={exportXlsx}>{exporting ? <Loader2 className="animate-spin" size={18} /> : <FileSpreadsheet size={18} />} تصدير Excel</button>
              <button className="btn-primary" disabled={!canApprove || busy} onClick={approve}>{busy ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} اعتماد وحفظ التوزيع</button>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className={s.sectionTitle}>التوزيعات المعتمدة</h2>
        {history === null ? <Spinner /> : history.length === 0 ? <Empty title="لسه مفيش توزيعات" hint="التوزيعات المعتمدة هتظهر هنا." /> : (
          <div className={s.history}>
            {history.map((h) => (
              <details key={h.id} className={s.hItem}>
                <summary className={s.hSum}>
                  <span>{fmt(h.period_from)} – {fmt(h.period_to)}<br /><span className={s.hMeta}>اعتُمد {new Date(h.created_at).toLocaleDateString(LOCALE)}{h.note ? ` · ${h.note}` : ''}</span></span>
                  <span className="num">{money(h.net_profit)}</span>
                </summary>
                <div className={s.hBody}>
                  <div className={s.tableWrap} style={{ borderTop: 0 }}>
                    <table className={s.table}>
                      <thead><tr><th className="th">الشريك</th><th className="th">النسبة</th><th className="th">المبلغ</th></tr></thead>
                      <tbody>{h.profit_distribution_lines.map((l) => <tr key={l.id}><td className="td font-bold">{l.partner_name}</td><td className="td num">{l.share_pct}%</td><td className="td num font-bold">{money(l.amount)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className={s.calc}>
                    <div className={s.row}><span>كافيه</span><span className="num">{money(h.cafe_revenue)}</span></div>
                    <div className={s.row}><span>قاعة</span><span className="num">{money(h.hall_revenue)}</span></div>
                    <div className={s.row}><span>COGS</span><span className="num">- {money(h.cogs_total)}</span></div>
                    <div className={s.row}><span>مصروفات</span><span className="num">- {money(h.expenses_total)}</span></div>
                    <button className="btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => window.print()}><Printer size={16} /> طباعة الصفحة</button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
