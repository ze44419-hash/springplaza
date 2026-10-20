'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageMinus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner } from './kit';
import { createClient } from '@/lib/supabase/client';
import { createWithdrawal, remainingOf, settleWithdrawal } from '@/lib/inventory';
import { fmtDateTime, qtyFmt, timeAgo } from '@/lib/format';
import { friendly, must } from '@/lib/util';
import type { Ingredient, Warehouse, WarehouseStock, Withdrawal } from '@/lib/types';
import s from './StockWithdrawals.module.css';

interface Data {
  warehouses: Warehouse[]; stock: WarehouseStock[]; ings: Ingredient[]; withdrawals: Withdrawal[]; names: Record<string, string>;
}

/**
 * سحب الخامات من المخازن (عهدة الباريستا).
 * الكاشير بيسحب خامات من مخزن → بيتسجّل اسمه، وبعدين بيرجّع اللي فضل. اللي بيتباع بيتحسب تلقائيًا من الوصفات،
 * فالباقي مع الباريستا = اتسحب − اتصرف في الأوردرات − رجع. الشاشة دي محتاجة إنترنت.
 */
export default function StockWithdrawals({ scope }: { scope: 'cashier' | 'admin' }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<Withdrawal | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = createClient();
      const [wh, st, ing, w, pr] = await Promise.all([
        sb.from('warehouses').select('*').order('sort_order'),
        sb.from('warehouse_stock').select('*'),
        sb.from('ingredients').select('id,name,unit,stock_qty,min_threshold,supplier').order('name'),
        sb.from('stock_withdrawals').select('*, stock_withdrawal_items(*)').order('created_at', { ascending: false }).limit(scope === 'admin' ? 150 : 60),
        sb.from('profiles').select('id,full_name'),
      ]);
      setData({
        warehouses: must(wh) as Warehouse[], stock: must(st) as WarehouseStock[], ings: must(ing) as Ingredient[],
        withdrawals: must(w) as Withdrawal[], names: Object.fromEntries((must(pr) as any[]).map((p) => [p.id, p.full_name])),
      });
      setErr(null);
    } catch (e: any) { setErr(friendly(e.message)); setData((d) => d ?? { warehouses: [], stock: [], ings: [], withdrawals: [], names: {} }); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <Spinner />;
  const open = data.withdrawals.filter((w) => w.status === 'open');
  const closed = data.withdrawals.filter((w) => w.status === 'closed').slice(0, scope === 'admin' ? 60 : 8);
  const ingOf = (id: string) => data.ings.find((i) => i.id === id);
  const whName = (id: string) => data.warehouses.find((w) => w.id === id)?.name ?? '—';

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <div>
          <h2 className={s.title}>سحب من المخزن</h2>
          <p className={s.sub}>اللي بتسحبه بيتسجّل باسمك. الباقي مع الباريستا = اتسحب − اتصرف في الأوردرات − رجع.</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setCreating(true); }}><Plus size={18} /> سحب جديد</button>
      </div>
      <ErrorNote message={err} />

      <section>
        <h3 className={s.group}>سحوبات مفتوحة <span className={s.count}>{open.length}</span></h3>
        {open.length === 0 ? <Empty title="مفيش سحوبات مفتوحة" hint="اضغط «سحب جديد» لما الباريستا يحتاج خامات." /> : (
          <div className={s.list}>{open.map((w) => <Card key={w.id} w={w} data={data} ingOf={ingOf} whName={whName} onSettle={() => setSettling(w)} />)}</div>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h3 className={s.group}>اتقفلت مؤخرًا</h3>
          <div className={s.list}>{closed.map((w) => <Card key={w.id} w={w} data={data} ingOf={ingOf} whName={whName} />)}</div>
        </section>
      )}

      {creating && <NewWithdrawal data={data} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} />}
      {settling && <SettleModal w={settling} ingOf={ingOf} onClose={() => setSettling(null)} onDone={() => { setSettling(null); void load(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ one withdrawal */
function Card({ w, data, ingOf, whName, onSettle }: {
  w: Withdrawal; data: Data; ingOf: (id: string) => Ingredient | undefined; whName: (id: string) => string; onSettle?: () => void;
}) {
  const isOpen = w.status === 'open';
  return (
    <article className={clsx(s.card, isOpen && s.cardOpen)}>
      <header className={s.cardHead}>
        <div>
          <p className={s.who}>الكاشير: <b>{data.names[w.cashier_id] ?? '—'}</b> · من <b>{whName(w.warehouse_id)}</b></p>
          <p className={s.meta}>{fmtDateTime(w.created_at)} · {timeAgo(w.created_at)}{w.closed_at && <> · اتقفل {fmtDateTime(w.closed_at)}{w.closed_by && w.closed_by !== w.cashier_id ? ` بواسطة ${data.names[w.closed_by] ?? '—'}` : ''}</>}</p>
          {w.note && <p className={s.note}>ملاحظة: {w.note}</p>}
        </div>
        <span className={clsx('chip', isOpen ? 'bg-sun-light text-sun-ink' : 'bg-petal-100 text-bark-500')}>{isOpen ? 'مفتوح' : 'مقفول'}</span>
      </header>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th className="th">الخامة</th><th className="th">اتسحب</th><th className="th">اتصرف في الأوردرات</th><th className="th">رجع</th>{!isOpen && <th className="th">عجز</th>}<th className="th">{isOpen ? 'الباقي مع الباريستا' : 'الباقي'}</th></tr></thead>
          <tbody>
            {w.stock_withdrawal_items.map((it) => {
              const u = ingOf(it.ingredient_id)?.unit ?? '';
              const rem = remainingOf(it);
              return (
                <tr key={it.id}>
                  <td className={`td ${s.strong}`}>{ingOf(it.ingredient_id)?.name ?? '—'}</td>
                  <td className="td num">{qtyFmt(it.qty_out)} {u}</td>
                  <td className="td num">{qtyFmt(it.qty_used)} {u}</td>
                  <td className="td num">{qtyFmt(it.qty_returned)} {u}</td>
                  {!isOpen && <td className={clsx('td num', Number(it.qty_variance) > 0 && s.bad)}>{qtyFmt(it.qty_variance)} {u}</td>}
                  <td className={clsx('td num', s.strong, isOpen && s.rem)}>{qtyFmt(rem)} {u}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isOpen && onSettle && <button className="btn-ghost btn-sm" onClick={onSettle}><RotateCcw size={16} /> رجّع / قفّل السحب</button>}
    </article>
  );
}

/* ------------------------------------------------------------------ new withdrawal */
function NewWithdrawal({ data, onClose, onDone }: { data: Data; onClose: () => void; onDone: () => void }) {
  const active = data.warehouses.filter((w) => w.is_active);
  const [wh, setWh] = useState(active[0]?.id ?? '');
  const [rows, setRows] = useState<{ ingredient_id: string; qty: string }[]>([{ ingredient_id: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const avail = useCallback((ing: string) => Number(data.stock.find((x) => x.warehouse_id === wh && x.ingredient_id === ing)?.qty ?? 0), [data.stock, wh]);
  const inWarehouse = useMemo(() => data.ings.filter((i) => avail(i.id) > 0), [data.ings, avail]);
  useEffect(() => { setRows([{ ingredient_id: '', qty: '' }]); }, [wh]);

  async function submit() {
    const clean = rows.filter((r) => r.ingredient_id || r.qty !== '');
    if (!wh) return setErr('اختار المخزن.');
    if (clean.length === 0) return setErr('ضيف خامة واحدة على الأقل.');
    if (clean.some((r) => !r.ingredient_id || !(Number(r.qty) > 0))) return setErr('اختار الخامة واكتب كمية أكبر من صفر في كل سطر.');
    if (new Set(clean.map((r) => r.ingredient_id)).size !== clean.length) return setErr('كل خامة تظهر مرة واحدة بس.');
    const over = clean.find((r) => Number(r.qty) > avail(r.ingredient_id));
    if (over) return setErr(`الكمية المطلوبة من ${data.ings.find((i) => i.id === over.ingredient_id)?.name} أكبر من المتاح في المخزن.`);
    setBusy(true); setErr(null);
    try { await createWithdrawal(wh, clean.map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) })), note); onDone(); }
    catch (e: any) { setErr(friendly(e.message)); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="سحب جديد من المخزن" wide>
      <div className={s.form}>
        <div><label className="label" htmlFor="wd-wh">المخزن</label>
          <select id="wd-wh" className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
            {active.length === 0 && <option value="">مفيش مخازن — الأدمن يضيف مخزن</option>}
            {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>

        {rows.map((r, i) => {
          const ing = data.ings.find((x) => x.id === r.ingredient_id);
          const taken = rows.filter((x, j) => j !== i).map((x) => x.ingredient_id);
          return (
            <div key={i} className={s.line}>
              <div className={s.lineMain}>
                <select className={clsx('input', s.ingSel)} aria-label="الخامة" value={r.ingredient_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ingredient_id: e.target.value } : x)))}>
                  <option value="">اختار الخامة…</option>
                  {inWarehouse.filter((g) => !taken.includes(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input className={clsx('input', s.qtyIn)} aria-label="الكمية" inputMode="decimal" dir="ltr" placeholder="الكمية" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <span className={s.unit}>{ing?.unit ?? ''}</span>
                <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" aria-label="شيل السطر" onClick={() => setRows(rows.length === 1 ? [{ ingredient_id: '', qty: '' }] : rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
              </div>
              {ing && <p className={s.avail}>المتاح في المخزن: <b className="num">{qtyFmt(avail(ing.id))} {ing.unit}</b></p>}
            </div>
          );
        })}
        <button className="btn-ghost btn-sm" onClick={() => setRows([...rows, { ingredient_id: '', qty: '' }])} disabled={rows.length >= inWarehouse.length}><Plus size={16} /> خامة تانية</button>

        <div><label className="label" htmlFor="wd-note">ملاحظة (اختياري)</label>
          <input id="wd-note" className="input" placeholder="مثلًا: لشيفت الصبح" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy || !wh} onClick={submit}>{busy ? <Loader2 className="animate-spin" size={18} /> : <PackageMinus size={18} />} سجّل السحب</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ return / close */
function SettleModal({ w, ingOf, onClose, onDone }: { w: Withdrawal; ingOf: (id: string) => Ingredient | undefined; onClose: () => void; onDone: () => void }) {
  const [ret, setRet] = useState<Record<string, string>>({});
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lines = w.stock_withdrawal_items.map((it) => {
    const rem = remainingOf(it);
    const back = Math.max(0, Number(ret[it.id] || 0));
    return { it, rem, back, left: Math.round((rem - back) * 1000) / 1000 };
  });
  const bad = lines.some((l) => Number.isNaN(Number(ret[l.it.id] || 0)) || l.back > l.rem + 0.0005);
  const shortage = lines.filter((l) => close && l.left > 0.0005);

  async function submit() {
    if (bad) return setErr('في كمية راجعة أكبر من الباقي مع الباريستا.');
    if (shortage.length > 0 && !confirm('اللي مش راجع هيتسجّل عجز ويتخصم من المخزون. تكمّل؟')) return;
    setBusy(true); setErr(null);
    try {
      await settleWithdrawal(w.id, lines.filter((l) => l.back > 0).map((l) => ({ item_id: l.it.id, qty: l.back })), close);
      onDone();
    } catch (e: any) { setErr(friendly(e.message)); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="رجّع الخامات / قفّل السحب" wide>
      <div className={s.form}>
        <p className={s.hintBox}>اكتب الكمية اللي <b>رجعت فعلًا</b> للمخزن. اللي اتباع اتحسب لوحده من الوصفات. لو قفلت السحب، أي كمية مش راجعة ومش في مبيعات بتتسجّل <b>عجز</b>.</p>
        {lines.map(({ it, rem, left }) => {
          const g = ingOf(it.ingredient_id);
          return (
            <div key={it.id} className={s.settleRow}>
              <div className={s.settleInfo}>
                <b>{g?.name ?? '—'}</b>
                <span className={s.muted}>اتسحب {qtyFmt(it.qty_out)} · اتصرف {qtyFmt(it.qty_used)} · رجع {qtyFmt(it.qty_returned)} {g?.unit}</span>
                <span className={s.rem}>الباقي مع الباريستا: <b className="num">{qtyFmt(rem)} {g?.unit}</b></span>
              </div>
              <div className={s.settleIn}>
                <input className={clsx('input', s.qtyIn)} dir="ltr" inputMode="decimal" aria-label={`الراجع من ${g?.name}`} placeholder="0" value={ret[it.id] ?? ''} onChange={(e) => setRet({ ...ret, [it.id]: e.target.value })} />
                <button className="btn-ghost btn-sm" onClick={() => setRet({ ...ret, [it.id]: String(rem) })} disabled={rem <= 0}>رجّع الكل</button>
              </div>
              {close && left > 0.0005 && <p className={s.shortage}>هيتسجّل عجز {qtyFmt(left)} {g?.unit}</p>}
            </div>
          );
        })}
        <label className={s.check}><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /> قفّل السحب (خلصت العهدة)</label>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy || bad} onClick={submit}>{busy && <Loader2 className="animate-spin" size={18} />} {close ? 'سجّل الراجع وقفّل' : 'سجّل الراجع'}</button>
      </div>
    </Modal>
  );
}
