'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Loader2, Minus, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Modal, Spinner, StatusBadge } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { adminEditOrder } from '@/lib/inventory';
import { destText, fmtDateTime, money, orderLabel, orderTypeLabel } from '@/lib/format';
import { friendly, must, toInputDate } from '@/lib/util';
import type { CafeTable, Category, Modifier, Order, OrderItem, OrderStatus, OrderType, PayMethod, Product } from '@/lib/types';
import s from './orders.module.css';

type Row = Order & { order_items: OrderItem[] };
interface Line {
  key: string; id?: string; product_id: string; name: string; unit_price: number; qty: number; note: string;
  modifier_ids: string[]; modsTotal: number; touched: boolean;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل الحالات' }, { value: 'open', label: 'مفتوحة' }, { value: 'completed', label: 'مدفوعة' }, { value: 'cancelled', label: 'ملغية' },
];

/** الأدمن يراجع أي أوردر ويعدّله: الأصناف والكميات والإضافات، الطاولة/النوع، الخصم، طريقة الدفع، أو يلغيه. */
export default function OrdersAdmin() {
  const sb = createClient();
  const [day, setDay] = useState(toInputDate(new Date()));
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [lookups, setLookups] = useState<{ tables: CafeTable[]; products: Product[]; cats: Category[]; mods: Modifier[]; names: Record<string, string> }>({ tables: [], products: [], cats: [], mods: [], names: {} });

  useEffect(() => {
    (async () => {
      const [t, p, c, m, pr] = await Promise.all([
        sb.from('cafe_tables').select('*').order('sort_order'), sb.from('products').select('*').order('sort_order'),
        sb.from('categories').select('*').order('sort_order'), sb.from('modifiers').select('*').order('name'),
        sb.from('profiles').select('id,full_name'),
      ]);
      setLookups({
        tables: must(t) as CafeTable[], products: must(p) as Product[], cats: must(c) as Category[], mods: must(m) as Modifier[],
        names: Object.fromEntries((must(pr) as any[]).map((x) => [x.id, x.full_name])),
      });
    })().catch((e) => setErr(friendly(e.message)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const from = new Date(`${day}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + 1);
      const res = await sb.from('orders').select('*, order_items(*)').gte('created_at', from.toISOString()).lt('created_at', to.toISOString())
        .order('created_at', { ascending: false }).limit(400);
      const data = (must(res) as Row[]).map((o) => ({ ...o, order_items: [...(o.order_items ?? [])].sort((a, b) => a.position - b.position) }));
      setRows(data); setErr(null);
    } catch (e: any) { setErr(friendly(e.message)); setRows([]); }
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); void load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((o) => {
    if (filter === 'open' && !['new', 'preparing', 'ready'].includes(o.status)) return false;
    if (filter === 'completed' && o.status !== 'completed') return false;
    if (filter === 'cancelled' && o.status !== 'cancelled') return false;
    if (q.trim() && !String(o.order_no ?? '').includes(q.trim().replace('#', ''))) return false;
    return true;
  }), [rows, filter, q]);
  const sum = shown.filter((o) => o.status === 'completed').reduce((a, o) => a + Number(o.total), 0);

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>الأوردرات</h1>
        <div className={s.filters}>
          <input type="date" className={clsx('input', s.date)} aria-label="اليوم" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <select className={clsx('input', s.sel)} aria-label="الحالة" value={filter} onChange={(e) => setFilter(e.target.value)}>{STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
          <input className={clsx('input', s.search)} inputMode="numeric" placeholder="رقم الأوردر" aria-label="بحث برقم الأوردر" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-ghost btn-sm" onClick={() => { setRows(null); void load(); }} aria-label="تحديث"><RefreshCw size={16} /></button>
        </div>
      </div>
      <ErrorNote message={err} />
      {rows === null ? <Spinner /> : shown.length === 0 ? <Empty title="مفيش أوردرات" hint="غيّر اليوم أو الفلتر." /> : (
        <>
          <p className={s.summary}>{shown.length} أوردر · مبيعات مدفوعة: <b className="num">{money(sum)}</b></p>
          <div className={s.list}>
            {shown.map((o) => (
              <article key={o.id} className={clsx(s.row, o.status === 'cancelled' && s.rowDim)}>
                <div className={s.rowMain}>
                  <p className={s.rowTop}><b><bdi>{orderLabel(o)}</bdi></b><span>{destText(o, lookups.tables)}</span><StatusBadge status={o.status} />
                    {o.payment_method && <span className="chip bg-petal-100 text-bark-500">{o.payment_method === 'card' ? 'كارت' : 'كاش'}</span>}
                    {o.edited_at && <span className="chip bg-sun-light text-sun-ink" title={fmtDateTime(o.edited_at)}>معدّل</span>}</p>
                  <p className={s.items}>{o.order_items.map((i) => `${i.qty}× ${i.name}`).join('، ')}</p>
                  <p className={s.meta}>{fmtDateTime(o.created_at)} · كابتن: {o.waiter_id ? lookups.names[o.waiter_id] ?? '—' : '—'}{o.cashier_id ? ` · كاشير: ${lookups.names[o.cashier_id] ?? '—'}` : ''}</p>
                </div>
                <div className={s.rowSide}>
                  <span className={clsx('num', s.total)}>{money(o.total)}</span>
                  <button className="btn-primary btn-sm" onClick={() => setEditing(o)} disabled={o.status === 'cancelled'}><Pencil size={16} /> تعديل</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {editing && <EditModal order={editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ edit modal */
function EditModal({ order, lookups, onClose, onSaved }: {
  order: Row; lookups: { tables: CafeTable[]; products: Product[]; cats: Category[]; mods: Modifier[] }; onClose: () => void; onSaved: () => void;
}) {
  const paid = order.status === 'completed';
  const [type, setType] = useState<OrderType>(order.order_type);
  const [tableId, setTableId] = useState(order.table_id ?? '');
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [notes, setNotes] = useState(order.notes ?? '');
  const [discount, setDiscount] = useState(Number(order.discount) ? String(order.discount) : '');
  const [method, setMethod] = useState<PayMethod>(order.payment_method ?? 'cash');
  const [tendered, setTendered] = useState(order.amount_tendered != null ? String(order.amount_tendered) : '');
  const [lines, setLines] = useState<Line[]>(() => order.order_items.map((i) => ({
    key: i.id, id: i.id, product_id: i.product_id, name: i.name, unit_price: Number(i.unit_price), qty: i.qty, note: i.note ?? '',
    modifier_ids: i.modifiers.map((m) => m.id), modsTotal: Number(i.modifiers_total), touched: false,
  })));
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subtotal = lines.reduce((a, l) => a + (l.unit_price + l.modsTotal) * l.qty, 0);
  const d = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - d;
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function toggleMod(l: Line, m: Modifier) {
    const ids = l.modifier_ids.includes(m.id) ? l.modifier_ids.filter((x) => x !== m.id) : [...l.modifier_ids, m.id];
    const original = order.order_items.find((i) => i.id === l.id)?.modifiers ?? [];
    const total = ids.reduce((a, id) => a + Number(lookups.mods.find((x) => x.id === id)?.price_delta ?? original.find((x) => x.id === id)?.price_delta ?? 0), 0);
    upd(l.key, { modifier_ids: ids, modsTotal: total, touched: true });
  }
  function addProduct() {
    const p = lookups.products.find((x) => x.id === addId);
    if (!p) return;
    setLines((ls) => [...ls, { key: `new-${Date.now()}`, product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1, note: '', modifier_ids: [], modsTotal: 0, touched: true }]);
    setAddId('');
  }

  async function save() {
    if (lines.length === 0) return setErr('الأوردر لازم يكون فيه صنف واحد على الأقل. لو عايز تلغيه استخدم «إلغاء الأوردر».');
    if (type === 'dine_in' && !tableId) return setErr('اختار الطاولة.');
    if (paid && method === 'cash' && tendered !== '' && Number(tendered) < total) return setErr('المبلغ المستلم أقل من الإجمالي الجديد.');
    if (paid && !confirm('الأوردر ده مدفوع. تعديل الأصناف هيرجّع المخزون القديم ويخصم الجديد ويغيّر مبيعات الشيفت. تكمّل؟')) return;
    setBusy(true); setErr(null);
    try {
      await adminEditOrder({
        id: order.id, order_type: type, table_id: type === 'dine_in' ? tableId : null, notes, discount: d,
        ...(paid ? { payment_method: method, amount_tendered: method === 'cash' && tendered !== '' ? Number(tendered) : null } : { status }),
        items: lines.map((l) => ({ id: l.id, product_id: l.product_id, qty: l.qty, note: l.note.trim() || null, ...(l.touched ? { modifier_ids: l.modifier_ids } : {}) })),
      });
      onSaved();
    } catch (e: any) { setErr(friendly(e.message)); setBusy(false); }
  }

  async function cancelOrder() {
    const msg = paid ? 'الأوردر ده مدفوع. الإلغاء هيرجّع المخزون ويشيله من المبيعات. تلغيه؟' : 'تلغي الأوردر؟';
    if (!confirm(msg)) return;
    setBusy(true); setErr(null);
    try { await adminEditOrder({ id: order.id, status: 'cancelled' }); onSaved(); }
    catch (e: any) { setErr(friendly(e.message)); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`تعديل الأوردر ${orderLabel(order)}`} wide>
      <div className={s.form}>
        {paid && <p className={s.warn}>الأوردر ده مدفوع. تعديل الأصناف بيعيد حساب المخزون وإجمالي المبيعات (والنقدية المتوقعة في الدرج).</p>}

        <div className={s.grid2}>
          <div><label className="label" htmlFor="eo-type">نوع الأوردر</label>
            <select id="eo-type" className="input" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
              {(Object.keys(orderTypeLabel) as OrderType[]).map((t) => <option key={t} value={t}>{orderTypeLabel[t]}</option>)}</select></div>
          {type === 'dine_in' && (
            <div><label className="label" htmlFor="eo-table">الطاولة</label>
              <select id="eo-table" className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">اختار…</option>{lookups.tables.map((t) => <option key={t.id} value={t.id}>طاولة {t.label}</option>)}</select></div>
          )}
          {!paid && (
            <div><label className="label" htmlFor="eo-status">الحالة</label>
              <select id="eo-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
                <option value="new">جديد</option><option value="preparing">قيد التحضير</option><option value="ready">جاهز</option></select></div>
          )}
        </div>

        <div className={s.lines}>
          {lines.map((l) => {
            const mods = lookups.mods.filter((m) => m.is_active || l.modifier_ids.includes(m.id));
            const orig = order.order_items.find((i) => i.id === l.id)?.modifiers ?? [];
            return (
              <div key={l.key} className={s.line}>
                <div className={s.lineTop}>
                  <div className={s.lineName}><b>{l.name}</b>{!l.id && <span className="chip bg-fern-light text-fern-ink">جديد</span>}
                    <span className={s.muted}>{money(l.unit_price + l.modsTotal)} للوحدة</span></div>
                  <div className={s.qty}>
                    <button className="btn-ghost btn-sm" aria-label="قلّل" onClick={() => upd(l.key, { qty: Math.max(1, l.qty - 1) })}><Minus size={16} /></button>
                    <b className="num">{l.qty}</b>
                    <button className="btn-ghost btn-sm" aria-label="زوّد" onClick={() => upd(l.key, { qty: l.qty + 1 })}><Plus size={16} /></button>
                  </div>
                  <span className={clsx('num', s.lineTotal)}>{money((l.unit_price + l.modsTotal) * l.qty)}</span>
                  <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" aria-label={`شيل ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>
                </div>
                {(mods.length > 0) && (
                  <div className={s.mods}>{mods.map((m) => (
                    <button key={m.id} type="button" aria-pressed={l.modifier_ids.includes(m.id)} className={clsx(s.mod, l.modifier_ids.includes(m.id) && s.modOn)} onClick={() => toggleMod(l, m)}>
                      {m.name}{Number(m.price_delta) !== 0 && <span className="num"> +{Number(m.price_delta)}</span>}
                    </button>))}
                    {orig.filter((m) => !mods.some((x) => x.id === m.id)).map((m) => <span key={m.id} className={s.mod}>{m.name}</span>)}
                  </div>
                )}
                <input className={clsx('input', s.lineNote)} placeholder="ملاحظة على الصنف" aria-label={`ملاحظة ${l.name}`} value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} />
              </div>
            );
          })}
          {lines.length === 0 && <p className={s.muted}>مفيش أصناف. ضيف صنف أو الغي الأوردر.</p>}
        </div>

        <div className={s.addRow}>
          <select className="input" aria-label="إضافة صنف" value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">إضافة صنف للأوردر…</option>
            {lookups.cats.map((c) => (
              <optgroup key={c.id} label={c.name}>{lookups.products.filter((p) => p.category_id === c.id).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}</optgroup>
            ))}
          </select>
          <button className="btn-ghost btn-sm" disabled={!addId} onClick={addProduct}><Plus size={16} /> أضف</button>
        </div>

        <div><label className="label" htmlFor="eo-notes">ملاحظة على الأوردر</label>
          <input id="eo-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <div className={s.grid2}>
          <div><label className="label" htmlFor="eo-disc">خصم</label>
            <input id="eo-disc" dir="ltr" className="input" inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          {paid && (
            <div><label className="label" htmlFor="eo-method">طريقة الدفع</label>
              <select id="eo-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}><option value="cash">كاش</option><option value="card">كارت</option></select></div>
          )}
          {paid && method === 'cash' && (
            <div><label className="label" htmlFor="eo-tend">المبلغ المستلم</label>
              <input id="eo-tend" dir="ltr" className="input" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} /></div>
          )}
        </div>

        <div className={s.totals}>
          <span>المجموع {money(subtotal)}{d > 0 && <> · خصم {money(d)}</>}</span>
          <b className="num">الإجمالي {money(total)}</b>
        </div>

        <ErrorNote message={err} />
        <div className={s.actions}>
          <button className="btn-primary" disabled={busy || lines.length === 0} onClick={save}>{busy ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} حفظ التعديلات</button>
          <button className="btn-ghost text-red-700 dark:text-red-300" disabled={busy} onClick={cancelOrder}><Ban size={18} /> إلغاء الأوردر</button>
        </div>
      </div>
    </Modal>
  );
}
