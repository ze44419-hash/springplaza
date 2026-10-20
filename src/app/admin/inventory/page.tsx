'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2, MoveRight } from 'lucide-react';
import clsx from 'clsx';
import Crud from '@/components/Crud';
import StockWithdrawals from '@/components/StockWithdrawals';
import { ErrorNote, Modal } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { isLowStock, recordInventoryTx, transferStock } from '@/lib/inventory';
import { fmtDateTime, qtyFmt } from '@/lib/format';
import { friendly, must } from '@/lib/util';
import type { Ingredient, InvTxType, Warehouse, WarehouseStock } from '@/lib/types';
import s from './inventory.module.css';

const UNITS = ['g', 'kg', 'ml', 'l', 'pcs'].map((u) => ({ value: u, label: u }));
const MOVES: { value: Exclude<InvTxType, 'sale'>; label: string; hint: string }[] = [
  { value: 'purchase', label: 'شراء (إضافة للمخزن)', hint: 'الكمية اللي استلمتها من المورّد.' },
  { value: 'supplier_return', label: 'مرتجع للمورّد', hint: 'الكمية اللي رجعتها — بتتخصم من المخزن.' },
  { value: 'waste', label: 'تالف / هالك', hint: 'الكمية اللي اترمت — بتتخصم من المخزن.' },
  { value: 'adjustment', label: 'تسوية جرد', hint: 'اكتب الكمية اللي عديتها فعليًا في المخزن ده والفرق بيتسجّل.' },
];
const TYPE_LABEL: Record<string, string> = { purchase: 'شراء', sale: 'بيع', supplier_return: 'مرتجع مورّد', adjustment: 'تسوية', waste: 'تالف' };
type Tab = 'ingredients' | 'warehouses' | 'withdrawals' | 'ledger';
const TABS: { key: Tab; label: string }[] = [
  { key: 'ingredients', label: 'الخامات والأرصدة' },
  { key: 'warehouses', label: 'المخازن' },
  { key: 'withdrawals', label: 'سحب الكاشير (العهدة)' },
  { key: 'ledger', label: 'سجل الحركة' },
];

export default function InventoryAdmin() {
  const [tab, setTab] = useState<Tab>('ingredients');
  const [move, setMove] = useState<Ingredient | null>(null);
  const [xfer, setXfer] = useState<Ingredient | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<WarehouseStock[]>([]);
  const [ledgerErr, setLedgerErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to reload tables + balances

  const loadAll = useCallback(async () => {
    try {
      const sb = createClient();
      const [tx, ing, wh, st] = await Promise.all([
        sb.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(80),
        sb.from('ingredients').select('id,name'),
        sb.from('warehouses').select('*').order('sort_order'),
        sb.from('warehouse_stock').select('*'),
      ]);
      setLedger(must(tx) as any[]);
      setNames(Object.fromEntries((must(ing) as any[]).map((i) => [i.id, i.name])));
      setWarehouses(must(wh) as Warehouse[]);
      setStock(must(st) as WarehouseStock[]);
      setLedgerErr(null);
    } catch (e: any) { setLedgerErr(e.message); }
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll, version]);
  const bump = () => setVersion((v) => v + 1);

  const whName = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const balances = (ingredientId: string) => stock.filter((x) => x.ingredient_id === ingredientId && Math.abs(Number(x.qty)) > 0.0005);
  /** الإجمالي − اللي في المخازن = اللي مع الباريستا حاليًا (سحوبات مفتوحة). */
  const withBarista = (i: Ingredient) => Number(i.stock_qty) - stock.filter((x) => x.ingredient_id === i.id).reduce((a, x) => a + Number(x.qty), 0);

  return (
    <div className={s.page}>
      <div className={s.tabs} role="tablist" aria-label="أقسام المخزون">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={clsx(s.tab, tab === t.key && s.tabOn)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'ingredients' && (
        <>
          <Crud<Ingredient> key={version} table="ingredients" title="الخامات" noun="خامة" orderBy="name" onChanged={bump}
            defaults={{ name: '', unit: 'g', stock_qty: 0, min_threshold: 0, supplier: '' }}
            fields={[
              { key: 'name', label: 'الاسم', type: 'text', required: true },
              { key: 'unit', label: 'الوحدة', type: 'select', required: true, options: UNITS, hint: 'الوصفات بتستخدم نفس الوحدة.' },
              { key: 'stock_qty', label: 'رصيد أول المدة (بيدخل المخزن الأول)', type: 'number', step: '0.001', createOnly: true, hint: 'أي تغيير بعد كده بيتسجّل كحركة مخزون.' },
              { key: 'min_threshold', label: 'نبّهني لما يوصل لـ', type: 'number', step: '0.001' },
              { key: 'supplier', label: 'المورّد', type: 'text' },
            ]}
            columns={[
              { label: 'الخامة', render: (r) => <b>{r.name}</b> },
              { label: 'الإجمالي', render: (r) => (
                <span className={clsx(s.stock, isLowStock(r) && s.stockLow)}>
                  {qtyFmt(r.stock_qty)} {r.unit}{isLowStock(r) && <span className="chip bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300">قليل</span>}
                </span>) },
              { label: 'في المخازن', render: (r) => {
                const b = balances(r.id);
                return b.length === 0 ? <span className={s.muted}>—</span> : (
                  <span className={s.chips}>{b.map((x) => <span key={x.warehouse_id} className={s.whChip}>{whName[x.warehouse_id] ?? '؟'}: <b className="num">{qtyFmt(x.qty)}</b></span>)}</span>
                );
              } },
              { label: 'مع الباريستا', render: (r) => { const v = withBarista(r); return Math.abs(v) < 0.0005 ? <span className={s.muted}>—</span> : <b className="num">{qtyFmt(v)} {r.unit}</b>; } },
              { label: 'حد التنبيه', render: (r) => `${qtyFmt(r.min_threshold)} ${r.unit}` },
              { label: 'المورّد', render: (r) => r.supplier ?? '—' },
            ]}
            rowActions={(r) => (
              <>
                <button className="btn-primary btn-sm" onClick={() => setMove(r)}><ArrowLeftRight size={16} /> حركة</button>
                {warehouses.length > 1 && <button className="btn-ghost btn-sm" onClick={() => setXfer(r)}><MoveRight size={16} /> تحويل</button>}
              </>
            )} />
          <MoveModal ingredient={move} warehouses={warehouses} stock={stock} onClose={() => setMove(null)} onDone={() => { setMove(null); bump(); }} />
          <TransferModal ingredient={xfer} warehouses={warehouses} stock={stock} onClose={() => setXfer(null)} onDone={() => { setXfer(null); bump(); }} />
        </>
      )}

      {tab === 'warehouses' && (
        <Crud<Warehouse> key={`wh-${version}`} table="warehouses" title="المخازن" noun="مخزن" orderBy="sort_order" onChanged={bump}
          defaults={{ name: '', sort_order: warehouses.length + 1, is_active: true }}
          fields={[
            { key: 'name', label: 'اسم المخزن', type: 'text', required: true },
            { key: 'sort_order', label: 'الترتيب (الأول هو الافتراضي)', type: 'number', step: '1' },
            { key: 'is_active', label: 'شغّال', type: 'checkbox' },
          ]}
          columns={[
            { label: 'المخزن', render: (r) => <b>{r.name}</b> },
            { label: 'عدد الخامات اللي فيه', render: (r) => String(stock.filter((x) => x.warehouse_id === r.id && Number(x.qty) > 0.0005).length) },
            { label: 'الحالة', render: (r) => <span className={clsx('chip', r.is_active ? 'bg-fern-light text-fern-ink' : 'bg-petal-100 text-bark-500')}>{r.is_active ? 'شغّال' : 'متعطّل'}</span> },
          ]} />
      )}

      {tab === 'withdrawals' && <StockWithdrawals scope="admin" />}

      {tab === 'ledger' && (
        <section>
          <h2 className={s.sectionTitle}>سجل حركة المخزون</h2>
          <ErrorNote message={ledgerErr} />
          <div className={s.ledger}>
            <table className={s.table}>
              <thead><tr><th className="th">التوقيت</th><th className="th">الخامة</th><th className="th">المخزن</th><th className="th">النوع</th><th className="th">التغيير</th><th className="th">ملاحظة</th></tr></thead>
              <tbody>
                {ledger.map((t) => (
                  <tr key={t.id}>
                    <td className={`td ${s.nowrap}`}>{fmtDateTime(t.created_at)}</td>
                    <td className={`td ${s.strong}`}>{names[t.ingredient_id] ?? '—'}</td>
                    <td className="td">{t.warehouse_id ? whName[t.warehouse_id] ?? '—' : '—'}</td>
                    <td className="td">{TYPE_LABEL[t.type] ?? t.type}</td>
                    <td className={clsx('td', t.qty_change < 0 ? s.out : s.in)}>{t.qty_change > 0 ? '+' : ''}{qtyFmt(t.qty_change)}</td>
                    <td className={`td ${s.note}`}>{t.note ?? ''}</td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td className={`td ${s.empty}`} colSpan={6}>مفيش حركات لسه.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function MoveModal({ ingredient, warehouses, stock, onClose, onDone }: {
  ingredient: Ingredient | null; warehouses: Warehouse[]; stock: WarehouseStock[]; onClose: () => void; onDone: () => void;
}) {
  const active = warehouses.filter((w) => w.is_active);
  const [wh, setWh] = useState('');
  const [type, setType] = useState<Exclude<InvTxType, 'sale'>>('purchase');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setType('purchase'); setQty(''); setNote(''); setErr(null); setWh(active[0]?.id ?? ''); }, [ingredient?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ingredient) return null;
  const meta = MOVES.find((m) => m.value === type)!;
  const balance = Number(stock.find((x) => x.warehouse_id === wh && x.ingredient_id === ingredient.id)?.qty ?? 0);

  async function submit() {
    if (!ingredient) return;
    const n = Number(qty);
    if (!wh) return setErr('اختار المخزن.');
    if (qty === '' || Number.isNaN(n) || n < 0) return setErr('اكتب كمية صحيحة.');
    setBusy(true); setErr(null);
    try {
      // "adjustment" is entered as the counted quantity of THIS warehouse → convert to a signed delta.
      const value = type === 'adjustment' ? n - balance : n;
      await recordInventoryTx(ingredient.id, type, value, note, wh);
      onDone();
    } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`المخزون · ${ingredient.name}`}>
      <div className={s.form}>
        <div><label className="label" htmlFor="mv-wh">المخزن</label>
          <select id="mv-wh" className="input" value={wh} onChange={(e) => setWh(e.target.value)}>{active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <p className={s.current}>الرصيد في المخزن ده: <b>{qtyFmt(balance)} {ingredient.unit}</b> · الإجمالي: <b>{qtyFmt(ingredient.stock_qty)} {ingredient.unit}</b></p>
        <div><label className="label" htmlFor="mv-type">نوع الحركة</label>
          <select id="mv-type" className="input" value={type} onChange={(e) => setType(e.target.value as any)}>{MOVES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          <p className={s.hint}>{meta.hint}</p></div>
        <div><label className="label" htmlFor="mv-qty">{type === 'adjustment' ? `الكمية المعدودة (${ingredient.unit})` : `الكمية (${ingredient.unit})`}</label>
          <input id="mv-qty" className={`input ${s.qtyInput}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="label" htmlFor="mv-note">ملاحظة (رقم الفاتورة، السبب…)</label>
          <input id="mv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy && <Loader2 className="animate-spin" size={18} />} سجّل الحركة</button>
      </div>
    </Modal>
  );
}

function TransferModal({ ingredient, warehouses, stock, onClose, onDone }: {
  ingredient: Ingredient | null; warehouses: Warehouse[]; stock: WarehouseStock[]; onClose: () => void; onDone: () => void;
}) {
  const active = warehouses.filter((w) => w.is_active);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setFrom(active[0]?.id ?? ''); setTo(active[1]?.id ?? ''); setQty(''); setNote(''); setErr(null); }, [ingredient?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ingredient) return null;
  const have = Number(stock.find((x) => x.warehouse_id === from && x.ingredient_id === ingredient.id)?.qty ?? 0);

  async function submit() {
    if (!ingredient) return;
    const n = Number(qty);
    if (!from || !to || from === to) return setErr('اختار مخزنين مختلفين.');
    if (qty === '' || Number.isNaN(n) || n <= 0) return setErr('اكتب كمية صحيحة.');
    if (n > have) return setErr('الكمية أكبر من رصيد المخزن المحوَّل منه.');
    setBusy(true); setErr(null);
    try { await transferStock(from, to, ingredient.id, n, note); onDone(); }
    catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`تحويل · ${ingredient.name}`}>
      <div className={s.form}>
        <div><label className="label" htmlFor="tr-from">من مخزن</label>
          <select id="tr-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <p className={s.current}>الرصيد المتاح: <b>{qtyFmt(have)} {ingredient.unit}</b></p>
        <div><label className="label" htmlFor="tr-to">إلى مخزن</label>
          <select id="tr-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>{active.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <div><label className="label" htmlFor="tr-qty">الكمية ({ingredient.unit})</label>
          <input id="tr-qty" className={`input ${s.qtyInput}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="label" htmlFor="tr-note">ملاحظة (اختياري)</label>
          <input id="tr-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <ErrorNote message={err} />
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy && <Loader2 className="animate-spin" size={18} />} حوّل</button>
      </div>
    </Modal>
  );
}
