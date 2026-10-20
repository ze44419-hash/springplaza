'use client';
import dynamic from 'next/dynamic';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, BellRing, CheckCheck, ChefHat, ClipboardList, CreditCard, HandCoins, Loader2, Package, PlusCircle, Printer, Receipt as ReceiptIcon, Store, X, XCircle } from 'lucide-react';
import clsx from 'clsx';
import AppShell from '@/components/AppShell';
import { getPaper, PaperToggle, ShiftReceipt, usePrint, type Paper } from '@/components/Print';
import { fontPxFor, ReceiptCopies } from '@/components/ReceiptView';
import { useNotify } from '@/components/Providers';
import { Empty, ErrorNote, Modal, StatusBadge } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { useCatalog } from '@/hooks/useCatalog';
import { useOrdersRealtime } from '@/hooks/useOrdersRealtime';
import { useProfile } from '@/hooks/useProfile';
import { db, getLocalShift, getMeta, setMeta } from '@/lib/db';
import { destText, money, orderLabel, timeAgo } from '@/lib/format';
import { isActive, queuePayment, queueStatus } from '@/lib/orders';
import { useReceiptTemplates, useStaffNames, type ReceiptKind } from '@/lib/receipt';
import { closeShift, openShift, reconcileShift, summarizeShift, type ShiftSummary } from '@/lib/shift';
import type { LocalOrder, PayMethod } from '@/lib/types';
import s from './cashier.module.css';

// Loaded only when the cashier opens the stock panel (needs internet, so it stays out of the main POS bundle).
const StockWithdrawals = dynamic(() => import('@/components/StockWithdrawals'), { ssr: false });

// Loaded only when the cashier opens "new order" — keeps the main POS screen light and fast.
const OrderTaker = dynamic(() => import('@/components/OrderTaker'), { ssr: false });

export default function CashierPage() {
  const { profile } = useProfile();
  const notify = useNotify();
  const { tables } = useCatalog();
  const templates = useReceiptTemplates();
  const staff = useStaffNames();
  const { print, portal } = usePrint();

  const [paper, setPaperState] = useState<Paper>(80);
  const [autoPrint, setAutoPrint] = useState(true);
  const [payFor, setPayFor] = useState<LocalOrder | null>(null);
  const [handover, setHandover] = useState(false);
  const [handedOver, setHandedOver] = useState<ShiftSummary | null>(null);
  const [newOrder, setNewOrder] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [openWithdrawals, setOpenWithdrawals] = useState(0); // withdrawals still open when the cashier hands over
  const [now, setNow] = useState(0); // bumps every 30 s so "منذ 5 دقيقة" labels refresh without re-querying

  useEffect(() => {
    setPaperState(getPaper());
    setAutoPrint(localStorage.getItem('autoPrint') !== '0');
    const t = setInterval(() => setNow((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Live shift + running totals.
  const shiftState = useLiveQuery(async () => {
    const sh = await getLocalShift();
    return sh ? { shift: sh, summary: await summarizeShift(sh) } : null;
  }, [], undefined);

  // Only what the board needs: open orders + everything from yesterday on (indexed queries, not a full-table read).
  const orders = useLiveQuery(async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 1);
    const [open, recent] = await Promise.all([
      db.orders.where('status').anyOf('new', 'preparing', 'ready').toArray(),
      db.orders.where('created_at').aboveOrEqual(since.toISOString()).toArray(),
    ]);
    const byId = new Map<string, LocalOrder>();
    for (const o of open) byId.set(o.id, o);
    for (const o of recent) byId.set(o.id, o);
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [], [] as LocalOrder[]);

  // Before handover: how many stock withdrawals are still open (best effort — silently ignored while offline).
  useEffect(() => {
    if (!handover) return;
    void (async () => {
      try {
        const { count } = await createClient().from('stock_withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'open');
        setOpenWithdrawals(count ?? 0);
      } catch { setOpenWithdrawals(0); }
    })();
  }, [handover]);

  useEffect(() => {
    if (!profile) return;
    void reconcileShift(profile.id);
    const on = () => void reconcileShift(profile.id);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [profile]);

  // ---- printing -----------------------------------------------------------------------------------------
  // Latest values in a ref so printing callbacks stay stable (keeps memoised cards from re-rendering).
  const ctx = useRef({ templates, staff, tables, paper, profile });
  ctx.current = { templates, staff, tables, paper, profile };

  const printReceipt = useCallback((kind: ReceiptKind, o: LocalOrder) => {
    const c = ctx.current;
    const cfg = c.templates[kind];
    return print(
      <ReceiptCopies order={o} config={cfg} ctx={{
        tableLabel: c.tables.find((t) => t.id === o.table_id)?.label,
        captain: o.waiter_id ? c.staff[o.waiter_id] : undefined,
        cashier: (o.cashier_id && c.staff[o.cashier_id]) || c.profile?.full_name,
      }} />, cfg.paperWidth, fontPxFor(cfg), cfg.sideMargin);
  }, [print]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Auto-print: every NEW order sent by a captain prints a ticket here, once, in arrival order. */
  const printed = useRef<Set<string> | null>(null);
  const queue = useRef<LocalOrder[]>([]);
  const draining = useRef(false);
  const [printedReady, setPrintedReady] = useState(false);
  useEffect(() => { void getMeta<string[]>('printedSlips').then((ids) => { printed.current = new Set(ids ?? []); setPrintedReady(true); }); }, []);

  useEffect(() => {
    if (!printedReady || !profile || !autoPrint || !printed.current) return;
    const cutoff = Date.now() - 3 * 3600_000; // never mass-print old orders after a long outage
    const fresh = orders.filter((o) => o.status === 'new' && !o.pending && o.waiter_id && o.waiter_id !== profile.id
      && !printed.current!.has(o.id) && new Date(o.created_at).getTime() > cutoff);
    if (fresh.length === 0) return;
    for (const o of fresh) { printed.current.add(o.id); queue.current.push(o); }
    void setMeta('printedSlips', [...printed.current].slice(-500));
    if (draining.current) return;
    draining.current = true;
    void (async () => {
      try { while (queue.current.length) await printReceipt('cashier_slip', queue.current.shift()!); }
      finally { draining.current = false; }
    })();
  }, [orders, autoPrint, printedReady, profile, printReceipt]);

  // Real-time: a captain sent a new order → toast + sound (the ticket itself is printed by the effect above).
  useOrdersRealtime(profile, {
    onNewOrder: (o) => notify({ title: `أوردر جديد · ${destText(o, ctx.current.tables)}`, body: `${orderLabel(o)} · ${o.items.reduce((n, i) => n + i.qty, 0)} صنف · ${money(o.total)}`, tone: 'info', sound: 'newOrder' }),
  });

  const onStatus = useCallback(async (o: LocalOrder, st: 'preparing' | 'ready' | 'cancelled') => {
    if (st === 'cancelled' && !confirm(`تلغي الأوردر ${orderLabel(o)}؟`)) return;
    await queueStatus(o.id, st);
  }, []);
  const onPrintBill = useCallback((o: LocalOrder) => void printReceipt('customer_bill', o), [printReceipt]);
  const onPrintSlip = useCallback((o: LocalOrder) => void printReceipt('cashier_slip', o), [printReceipt]);
  const onPay = useCallback((o: LocalOrder) => setPayFor(o), []);

  const active = orders.filter(isActive);
  const cols = [
    { key: 'new', title: 'جديد', icon: BellRing, list: active.filter((o) => o.status === 'new') },
    { key: 'preparing', title: 'قيد التحضير', icon: ChefHat, list: active.filter((o) => o.status === 'preparing') },
    { key: 'ready', title: 'جاهز للتسليم', icon: CheckCheck, list: active.filter((o) => o.status === 'ready') },
  ] as const;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const paidToday = orders.filter((o) => (o.order_kind ?? 'standard') === 'standard' && o.status === 'completed' && o.paid_at && new Date(o.paid_at) >= todayStart).reverse().slice(0, 12);

  return (
    <AppShell subtitle="كاشير" actions={<>
      <button className="btn-ghost btn-sm" onClick={() => setStockOpen(true)} aria-label="المخزن وسحب الخامات"><Package size={18} /><span className="hidden sm:inline">المخزن</span></button>
      <PaperToggle value={paper} onChange={setPaperState} />
    </>}>
      <div className={s.page}>
        {shiftState === undefined ? null : shiftState === null ? (
          <OpenShiftCard />
        ) : (
          <div className={s.shiftBar}>
            <p className={s.shiftTitle}><Store className="text-fern" /> الشيفت مفتوح من {new Date(shiftState.shift.opened_at).toLocaleTimeString('ar-EG-u-nu-latn', { timeStyle: 'short' })}</p>
            <Stat label="أوردرات مدفوعة" value={String(shiftState.summary.orders)} />
            <Stat label="المبيعات" value={money(shiftState.summary.total)} />
            <Stat label="النقدية في الدرج" value={money(shiftState.summary.expected)} />
            <div className={s.barActions}>
              <label className={s.switch} title="بيطبع تذكرة لكل أوردر جديد من الكباتن. للطباعة بدون نافذة تأكيد شغّل المتصفح بـ --kiosk-printing">
                <input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrint(e.target.checked); localStorage.setItem('autoPrint', e.target.checked ? '1' : '0'); }} />
                <span className={s.track} aria-hidden="true" /> طباعة تلقائية
              </label>
              <button className="btn btn-accent btn-sm" onClick={() => setNewOrder(true)}><PlusCircle size={18} /> أوردر جديد</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setHandover(true)}><HandCoins size={18} /> تسليم الشيفت</button>
            </div>
          </div>
        )}

        <div className={s.board}>
          {cols.map((c) => (
            <section key={c.key} aria-label={c.title} className={s.col}>
              <h2 className={s.colHead}><c.icon size={20} /> {c.title} <span className={s.count}>{c.list.length}</span></h2>
              <div className={s.stack}>
                {c.list.length === 0 && <p className={s.emptyCol}>مفيش أوردرات</p>}
                {c.list.map((o) => (
                  <OrderCard key={o.id} order={o} dest={destText(o, tables)} canPay={!!shiftState} tick={now}
                    onStatus={onStatus} onPrintBill={onPrintBill} onPrintSlip={onPrintSlip} onPay={onPay} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <section>
          <h2 className={s.sectionTitle}>اتدفع النهارده</h2>
          {paidToday.length === 0 ? <Empty title="لسه مفيش مدفوعات" /> : (
            <div className={s.paidList}>
              {paidToday.map((o) => (
                <div key={o.id} className={s.paidRow}>
                  <b><bdi>{orderLabel(o)}</bdi></b><span className="text-bark-500">{destText(o, tables)}</span>
                  <span className="chip bg-petal-100 text-bark-500">{o.payment_method === 'card' ? 'كارت' : 'كاش'}</span>
                  {o.pending && <span className="chip bg-sun-light text-sun-ink">مستني المزامنة</span>}
                  {o.sync_error && <span className="chip bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300" title={o.sync_error}>مشكلة في المزامنة</span>}
                  <span className={s.spacer}>{money(o.total)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => onPrintBill(o)}><Printer size={16} /> إعادة طباعة</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {newOrder && profile && (
        <div className={s.overlay} role="dialog" aria-modal="true" aria-label="أوردر جديد">
          <div className={s.overlayBar}>
            <h2 className={s.overlayTitle}>أوردر جديد من الكاشير</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setNewOrder(false)}><X size={18} /> إغلاق</button>
          </div>
          <div className={s.overlayBody}><OrderTaker profile={profile} onSent={() => setNewOrder(false)} /></div>
        </div>
      )}

      <Modal open={stockOpen} onClose={() => setStockOpen(false)} title="المخزن · عهدة الباريستا" wide>
        {stockOpen && <StockWithdrawals scope="cashier" />}
      </Modal>

      {payFor && shiftState && (
        <PayModal order={payFor} dest={destText(payFor, tables)} onClose={() => setPayFor(null)}
          onConfirm={async (method, tendered, discount, doPrint) => {
            await queuePayment(payFor, method, tendered, discount, shiftState.shift.id);
            const fresh = await db.orders.get(payFor.id);
            setPayFor(null);
            notify({ title: `الأوردر ${orderLabel(payFor)} اتدفع`, body: `${money(fresh?.total ?? payFor.total)} · ${method === 'cash' ? 'كاش' : 'كارت'}`, tone: 'success' });
            if (doPrint && fresh) void printReceipt('customer_bill', fresh);
          }} />
      )}

      {handover && shiftState && profile && (
        <HandoverModal expected={shiftState.summary.expected} openOrders={active.length} openWithdrawals={openWithdrawals} onClose={() => setHandover(false)}
          onConfirm={async (counted) => {
            const sm = await closeShift(counted, profile.full_name);
            setHandover(false);
            if (sm) { setHandedOver(sm); void print(<ShiftReceipt s={sm} />, paper); } // receipt prints immediately
          }} />
      )}

      <Modal open={!!handedOver} onClose={() => setHandedOver(null)} title="تم تسليم الشيفت">
        {handedOver && (
          <div className={s.stackY}>
            <Row k="عدد الأوردرات" v={String(handedOver.orders)} /><Row k="مبيعات كاش" v={money(handedOver.cash)} /><Row k="مبيعات كارت" v={money(handedOver.card)} />
            <Row k="المتوقع في الدرج" v={money(handedOver.expected)} /><Row k="الفعلي" v={money(handedOver.counted)} />
            <Row k={handedOver.diff === 0 ? 'الدرج مظبوط' : handedOver.diff > 0 ? 'زيادة' : 'عجز'} v={money(Math.abs(handedOver.diff))} strong tone={handedOver.diff === 0 ? 'ok' : 'warn'} />
            <button className="btn btn-primary" onClick={() => void print(<ShiftReceipt s={handedOver} />, paper)}><Printer size={18} /> إعادة طباعة إيصال التسليم</button>
          </div>
        )}
      </Modal>
      {portal}
    </AppShell>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className={s.stat}><p className={s.statLabel}>{label}</p><p className={s.statValue}>{value}</p></div>
);
const Row = ({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'ok' | 'warn' }) => (
  <div className={clsx(s.row, strong && s.rowStrong, tone === 'ok' && s.rowOk, tone === 'warn' && s.rowWarn)}><span>{k}</span><span className="num">{v}</span></div>
);

/* ---------------------------------------------------------------- Shift open / handover */
function OpenShiftCard() {
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className={s.openShift}>
      <h1>ابدأ شيفتك</h1>
      <p className={s.hint}>عُدّ النقدية اللي في الدرج واكتبها. استلام المدفوعات بيتفتح بعد فتح الشيفت.</p>
      <div><label className="label" htmlFor="open-cash">رصيد أول الشيفت</label>
        <input id="open-cash" dir="ltr" className={clsx('input', s.bigInput)} inputMode="decimal" placeholder="0.00" value={cash} onChange={(e) => setCash(e.target.value)} /></div>
      <button className="btn btn-primary" disabled={busy || cash.trim() === '' || Number.isNaN(Number(cash))}
        onClick={async () => { setBusy(true); await openShift(Number(cash)); setBusy(false); }}>
        {busy ? <Loader2 className="animate-spin" /> : <Store size={18} />} افتح الشيفت
      </button>
    </div>
  );
}

function HandoverModal({ expected, openOrders, openWithdrawals, onClose, onConfirm }: { expected: number; openOrders: number; openWithdrawals: number; onClose: () => void; onConfirm: (counted: number) => Promise<void> }) {
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = counted === '' ? null : Number(counted) - expected;
  return (
    <Modal open onClose={onClose} title="تسليم الشيفت">
      <div className={s.stackY}>
        {openWithdrawals > 0 && <p className={s.warnBox}>في {openWithdrawals} سحب مفتوح من المخزن. رجّع الباقي وقفّله من زرار «المخزن» قبل التسليم، عشان الباريستا اللي بعدك يعرف الكميات.</p>}
        {openOrders > 0 && <p className={s.warnBox}>في {openOrders} أوردر لسه مفتوح (مش مدفوع). ادفعه أو الغيه قبل التسليم لو تحب.</p>}
        <Row k="المتوقع في الدرج" v={money(expected)} strong />
        <div><label className="label" htmlFor="counted">النقدية اللي عديتها فعليًا</label>
          <input id="counted" dir="ltr" className={clsx('input', s.bigInput)} inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
        {diff !== null && !Number.isNaN(diff) && <Row k={diff === 0 ? 'الدرج مظبوط' : diff > 0 ? 'زيادة' : 'عجز'} v={money(Math.abs(diff))} strong tone={diff === 0 ? 'ok' : 'warn'} />}
        <button className="btn btn-primary" disabled={busy || counted === '' || Number.isNaN(Number(counted))}
          onClick={async () => { setBusy(true); await onConfirm(Number(counted)); }}>
          {busy ? <Loader2 className="animate-spin" size={18} /> : <Printer size={18} />} سلّم الشيفت واطبع الإيصال
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Order card (memoised: only re-renders when its own order changes) */
interface CardProps {
  order: LocalOrder; dest: string; canPay: boolean; tick: number;
  onStatus: (o: LocalOrder, s: 'preparing' | 'ready' | 'cancelled') => void;
  onPrintBill: (o: LocalOrder) => void; onPrintSlip: (o: LocalOrder) => void; onPay: (o: LocalOrder) => void;
}
const OrderCard = memo(function OrderCard({ order: o, dest, canPay, onStatus, onPrintBill, onPrintSlip, onPay }: CardProps) {
  const kind = o.order_kind ?? 'standard';
  return (
    <article className={clsx(s.card, o.status === 'new' && s.cardNew)}>
      <header className={s.cardHead}>
        <div>
          <p className={s.dest}>{dest}</p>
          <p className={s.meta}><bdi>{orderLabel(o)}</bdi> · {timeAgo(o.created_at)}</p>
        </div>
        <StatusBadge status={o.status} />
      </header>
      {kind !== 'standard' && <p className={clsx(s.flag, s.flagWait)}>{kind === 'employee' ? 'طلب شخصي · مستني موافقة الموظف (مش بيدخل في الدرج)' : 'ضيافة · مستني تأكيد الأدمن'}</p>}
      <ul className={s.items}>
        {o.items.map((it) => (
          <li key={it.id}>
            <span className={s.qty}>{it.qty}×</span> {it.name}
            {it.modifiers.length > 0 && <span className={s.mods}> · {it.modifiers.map((m) => m.name).join('، ')}</span>}
            {it.note && <span className={s.itemNote}>“{it.note}”</span>}
          </li>
        ))}
      </ul>
      {o.notes && <p className={s.orderNote}>ملاحظة: {o.notes}</p>}
      {o.pending && <p className={clsx(s.flag, s.flagWait)}>مستني المزامنة…</p>}
      {o.sync_error && <p className={clsx(s.flag, s.flagErr)}>مشكلة في المزامنة: {o.sync_error}</p>}
      <div className={s.actions}>
        {o.status === 'new' && <button className={clsx('btn btn-primary btn-sm', s.grow)} onClick={() => onStatus(o, 'preparing')}><ChefHat size={16} /> ابدأ التحضير</button>}
        {o.status === 'preparing' && <button className={clsx('btn btn-primary btn-sm', s.grow)} onClick={() => onStatus(o, 'ready')}><CheckCheck size={16} /> جاهز</button>}
        {kind === 'standard' && <button className={clsx('btn btn-accent btn-sm', s.grow)} disabled={!canPay} title={canPay ? '' : 'افتح شيفت الأول'} onClick={() => onPay(o)}>ادفع <span className="num">{money(o.total)}</span></button>}
        <button className="btn btn-ghost btn-sm" onClick={() => onPrintBill(o)} aria-label="طباعة حساب العميل" title="طباعة حساب العميل"><ReceiptIcon size={16} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => onPrintSlip(o)} aria-label="طباعة تذكرة الأوردر" title="طباعة تذكرة الأوردر"><ClipboardList size={16} /></button>
        <button className="btn btn-ghost btn-sm text-red-700 dark:text-red-300" onClick={() => onStatus(o, 'cancelled')} aria-label="إلغاء الأوردر"><XCircle size={16} /></button>
      </div>
    </article>
  );
}, (a, b) => a.order === b.order && a.dest === b.dest && a.canPay === b.canPay && a.tick === b.tick);

/* ---------------------------------------------------------------- Payment */
function PayModal({ order, dest, onClose, onConfirm }: {
  order: LocalOrder; dest: string; onClose: () => void;
  onConfirm: (method: PayMethod, tendered: number | null, discount: number, print: boolean) => Promise<void>;
}) {
  const [method, setMethod] = useState<PayMethod>('cash');
  const [discount, setDiscount] = useState('');
  const [tendered, setTendered] = useState('');
  const [doPrint, setDoPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const d = Math.min(Math.max(Number(discount) || 0, 0), order.subtotal);
  const total = order.subtotal - d;
  const paid = tendered === '' ? null : Number(tendered);
  const change = paid == null ? null : paid - total;
  const insufficient = method === 'cash' && paid != null && paid < total;
  const quick = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 200) * 200]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4);

  return (
    <Modal open onClose={onClose} title={`دفع · ${dest}`}>
      <div className={s.stackY}>
        <div className={s.payItems}>
          {order.items.map((it) => <div key={it.id}><span>{it.qty}× {it.name}</span><span className="num">{money((it.unit_price + it.modifiers_total) * it.qty)}</span></div>)}
        </div>
        <div><label className="label" htmlFor="disc">خصم (اختياري)</label>
          <input id="disc" dir="ltr" className="input" inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
        <div className={s.payTotal}><span>الإجمالي</span><span className="num">{money(total)}</span></div>

        <div className={s.methods} role="group" aria-label="طريقة الدفع">
          {([['cash', 'كاش', Banknote], ['card', 'كارت', CreditCard]] as const).map(([m, label, Icon]) => (
            <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)}
              className={clsx('btn ring-2', s.method, method === m ? 'bg-fern text-white ring-fern' : 'bg-surface ring-petal-200')}><Icon size={20} /> {label}</button>
          ))}
        </div>

        {method === 'cash' && (
          <div className={s.stackY}>
            <label className="label" htmlFor="tend" style={{ margin: 0 }}>المبلغ المستلم</label>
            <input id="tend" dir="ltr" className={clsx('input', s.bigInput)} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} />
            <div className={s.quick}>{quick.map((q) => <button key={q} className="btn btn-ghost btn-sm" onClick={() => setTendered(String(q))}>{q === total ? 'المبلغ بالظبط' : money(q)}</button>)}</div>
            {change != null && !insufficient && <p className={s.change}>الباقي: <span className="num">{money(change)}</span></p>}
            {insufficient && <ErrorNote message="المبلغ المستلم أقل من الإجمالي." />}
          </div>
        )}

        <label className={s.check}><input type="checkbox" checked={doPrint} onChange={(e) => setDoPrint(e.target.checked)} /> اطبع حساب العميل</label>
        <ErrorNote message={err} />
        <button className="btn btn-primary" style={{ minHeight: 58, fontSize: '1.15rem' }} disabled={busy || insufficient}
          onClick={async () => {
            setBusy(true); setErr(null);
            try { await onConfirm(method, method === 'cash' ? paid ?? total : null, d, doPrint); }
            catch (e: any) { setErr(e?.message ?? 'تعذّر تسجيل الدفع'); setBusy(false); }
          }}>
          {busy ? <Loader2 className="animate-spin" /> : null} تأكيد الدفع
        </button>
      </div>
    </Modal>
  );
}
