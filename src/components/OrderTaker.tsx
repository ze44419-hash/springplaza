'use client';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Bike, ChevronDown, Gift, Loader2, Minus, Plus, Send, ShoppingBag, Trash2, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { Empty, Modal } from '@/components/kit';
import { useNotify } from '@/components/Providers';
import { useCatalog } from '@/hooks/useCatalog';
import { useOnline } from '@/hooks/useOnline';
import { createClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';
import { destText, money, qtyFmt, uuid } from '@/lib/format';
import { cartTotal, lineUnitTotal, submitOrder, type CartLine } from '@/lib/orders';
import type { LocalOrder, Modifier, OrderKind, OrderType, Product, Profile } from '@/lib/types';
import s from './OrderTaker.module.css';

type Line = CartLine & { id: string };
type Dest = { type: OrderType; tableId: string | null; kind?: OrderKind; employeeId?: string; employeeName?: string };

/**
 * Order-taking flow shared by the Captain screen and the Cashier screen:
 * pick table / takeaway / delivery → touch menu by category → cart with quick modifiers → send.
 * Orders are saved to IndexedDB first, so it works offline.
 */
export default function OrderTaker({ profile, onSent }: { profile: Profile; onSent?: (o: LocalOrder) => void }) {
  const notify = useNotify();
  const online = useOnline();
  const { categories, products, modifiers, tables } = useCatalog();

  const [dest, setDest] = useState<Dest | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pickEmp, setPickEmp] = useState(false);
  const canSpecial = true; // كاشير / كابتن / أدمن

  // Table occupancy: indexed query on open orders only.
  const busy = useLiveQuery(async () => {
    const open = await db.orders.where('status').anyOf('new', 'preparing', 'ready').toArray();
    return new Map(open.filter((o) => o.table_id).map((o) => [o.table_id!, o.status] as const));
  }, [], new Map<string, string>());

  const catId = activeCat ?? categories[0]?.id ?? null;
  const visible = useMemo(() => products.filter((p) => p.category_id === catId), [products, catId]);
  const inCartByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.qty);
    return m;
  }, [lines]);
  const total = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);

  const addProduct = useCallback((p: Product) => {
    setLines((ls) => {
      const plain = ls.find((l) => l.product.id === p.id && l.modifiers.length === 0 && !l.note);
      return plain ? ls.map((l) => (l === plain ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { id: uuid(), product: p, qty: 1, modifiers: [], note: '' }];
    });
  }, []);
  const patch = (id: string, fn: (l: Line) => Line | null) =>
    setLines((ls) => ls.flatMap((l) => { if (l.id !== id) return [l]; const n = fn(l); return n ? [n] : []; }));
  const toggleMod = (id: string, m: Modifier) =>
    patch(id, (l) => ({ ...l, modifiers: l.modifiers.some((x) => x.id === m.id) ? l.modifiers.filter((x) => x.id !== m.id) : [...l.modifiers, m] }));

  async function send() {
    if (!dest || lines.length === 0) return;
    setSending(true);
    try {
      const o = await submitOrder({ waiterId: profile.id, orderType: dest.type, tableId: dest.tableId, notes, lines, kind: dest.kind, employeeId: dest.employeeId });
      notify(online
        ? { title: `تم إرسال أوردر ${destText(o, tables)}`, body: dest.kind === 'employee' ? `مستني موافقة ${dest.employeeName}.` : dest.kind === 'hospitality' ? 'مستني تأكيد الأدمن.' : profile.role === 'waiter' ? 'الكاشير وصله إشعار والتذكرة بتتطبع عنده.' : 'الأوردر ظهر في قائمة الجديد.', tone: 'success' }
        : { title: 'اتحفظ على الجهاز', body: 'الأوردر هيتبعت لوحده أول ما الإنترنت يرجع.', tone: 'info' });
      setLines([]); setNotes(''); setDest(null); setCartOpen(false);
      onSent?.(o);
    } catch (e: any) {
      notify({ title: 'تعذّر حفظ الأوردر', body: e?.message, tone: 'error', sound: 'error' });
    } finally { setSending(false); }
  }

  const cartPanel = (
    <CartPanel lines={lines} modifiers={modifiers} notes={notes} setNotes={setNotes} total={total} sending={sending}
      onQty={(id, d) => patch(id, (l) => (l.qty + d <= 0 ? null : { ...l, qty: l.qty + d }))}
      onToggleMod={toggleMod} onNote={(id, note) => patch(id, (l) => ({ ...l, note }))} onSend={send} />
  );

  if (!dest) return (
    <>
      <TablePicker tables={tables} busy={busy} onPick={setDest} canSpecial={canSpecial}
        onHospitality={() => setDest({ type: 'takeaway', tableId: null, kind: 'hospitality' })} onEmployee={() => setPickEmp(true)} />
      <EmployeePicker open={pickEmp} onClose={() => setPickEmp(false)}
        onPick={(e) => { setPickEmp(false); setDest({ type: 'takeaway', tableId: null, kind: 'employee', employeeId: e.id, employeeName: e.full_name }); }} />
    </>
  );

  return (
    <div className={s.layout}>
      <section style={{ minWidth: 0 }}>
        <div className={s.topRow}>
          <button className="btn btn-ghost btn-sm" onClick={() => (lines.length === 0 || confirm('تلغي الأوردر الحالي وتغيّر الطاولة؟')) && (setDest(null), setLines([]))}><ArrowRight size={18} /> الطاولات</button>
          <h2 className={s.destTitle}>{destText({ order_type: dest.type, table_id: dest.tableId, order_kind: dest.kind }, tables)}{dest.employeeName ? ` · ${dest.employeeName}` : ''}</h2>
        </div>

        <div className={s.tabs} role="tablist" aria-label="أقسام المنيو">
          {categories.map((c) => (
            <button key={c.id} role="tab" aria-selected={c.id === catId} onClick={() => setActiveCat(c.id)} className={clsx(s.tab, c.id === catId && s.tabActive)}>{c.name}</button>
          ))}
        </div>

        {categories.length === 0 ? <Empty title="المنيو فاضي" hint="اتصل بالإنترنت مرة واحدة علشان المنيو يتحفظ على الجهاز." /> : (
          <div className={s.grid}>
            {visible.map((p) => <ProductTile key={p.id} product={p} inCart={inCartByProduct.get(p.id) ?? 0} onAdd={addProduct} />)}
          </div>
        )}
      </section>

      <aside className={s.aside}><div className={s.asideCard}>{cartPanel}</div></aside>

      <div className={s.bar}>
        <button className={clsx('btn btn-primary', s.barBtn)} disabled={count === 0} onClick={() => setCartOpen(true)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShoppingBag size={20} /> شوف الأوردر ({count})</span><span className="num">{money(total)}</span>
        </button>
      </div>
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="الأوردر الحالي">{cartPanel}</Modal>
    </div>
  );
}

/** Memoised: tapping one product re-renders only that tile instead of the whole grid. */
const ProductTile = memo(function ProductTile({ product: p, inCart, onAdd }: { product: Product; inCart: number; onAdd: (p: Product) => void }) {
  return (
    <button disabled={!p.is_available} onClick={() => onAdd(p)} className={clsx(s.tile, inCart > 0 && s.tileOn)}>
      {p.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.image_url} alt="" loading="lazy" decoding="async" className={s.thumb} />
        : <span className={s.thumbLetter}>{p.name[0]}</span>}
      <span className={s.name}>{p.name}</span>
      <span className={s.price}>{p.is_available ? <span className="num">{money(p.price)}</span> : 'خلص'}</span>
      {inCart > 0 && <span className={s.badge}>{inCart}</span>}
    </button>
  );
});

/* ---------------------------------------------------------------- Table picker */
function TablePicker({ tables, busy, onPick, canSpecial, onHospitality, onEmployee }: {
  tables: { id: string; label: string }[]; busy: Map<string, string>; onPick: (d: Dest) => void;
  canSpecial: boolean; onHospitality: () => void; onEmployee: () => void;
}) {
  return (
    <section>
      <h1 className={s.pickTitle}>الأوردر رايح فين؟</h1>
      <div className={s.quickDest}>
        <button className="btn btn-accent" onClick={() => onPick({ type: 'takeaway', tableId: null })}><ShoppingBag /> تيك أواي</button>
        <button className="btn btn-accent" onClick={() => onPick({ type: 'delivery', tableId: null })}><Bike /> دليفري</button>
        {canSpecial && <button className="btn btn-ghost" onClick={onEmployee}><UserRound /> طلب شخصي لموظف</button>}
        {canSpecial && <button className="btn btn-ghost" onClick={onHospitality}><Gift /> ضيافة</button>}
      </div>
      <div className={s.tables}>
        {tables.map((t) => {
          const st = busy.get(t.id);
          return (
            <button key={t.id} onClick={() => onPick({ type: 'dine_in', tableId: t.id })} className={clsx(s.table, st === 'ready' ? s.tableReady : st ? s.tableBusy : '')}>
              {t.label}
              <span className={s.tableState}>{st === 'ready' ? 'جاهز!' : st ? 'عليها أوردر' : 'فاضية'}</span>
            </button>
          );
        })}
      </div>
      {tables.length === 0 && <div style={{ marginTop: 16 }}><Empty title="مفيش طاولات لسه" hint="المدير يقدر يضيف طاولات. التيك أواي والدليفري شغالين عادي." /></div>}
    </section>
  );
}

/* ---------------------------------------------------------------- Cart */
function CartPanel(p: {
  lines: Line[]; modifiers: Modifier[]; notes: string; setNotes: (v: string) => void; total: number; sending: boolean;
  onQty: (id: string, d: number) => void; onToggleMod: (id: string, m: Modifier) => void;
  onNote: (id: string, n: string) => void; onSend: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (p.lines.length === 0) return <Empty title="مفيش أصناف لسه" hint="اضغط على الأصناف في المنيو علشان تضيفها." />;
  return (
    <div className={s.cart}>
      <ul className={s.lines}>
        {p.lines.map((l) => (
          <li key={l.id} className={s.line}>
            <div className={s.lineTop}>
              <div className={s.lineInfo}>
                <p className={s.lineName}>{l.product.name}</p>
                <p className={s.lineSub}><span className="num">{money(lineUnitTotal(l))}</span>{l.modifiers.length > 0 && ` · ${l.modifiers.map((m) => m.name).join('، ')}`}</p>
              </div>
              <div className={s.stepper}>
                <button className={s.stepBtn} aria-label="قلل" onClick={() => p.onQty(l.id, -1)}>{l.qty === 1 ? <Trash2 size={18} color="#dc2626" /> : <Minus size={18} />}</button>
                <span className={s.stepQty}>{l.qty}</span>
                <button className={s.stepBtn} aria-label="زوّد" onClick={() => p.onQty(l.id, 1)}><Plus size={18} /></button>
              </div>
            </div>
            <button className={s.optToggle} onClick={() => setOpen(open === l.id ? null : l.id)}>
              إضافات وملاحظات <ChevronDown size={16} style={{ transform: open === l.id ? 'rotate(180deg)' : undefined }} />
            </button>
            {open === l.id && (
              <div className={s.opts}>
                <div className={s.mods}>
                  {p.modifiers.map((m) => {
                    const on = l.modifiers.some((x) => x.id === m.id);
                    return <button key={m.id} aria-pressed={on} onClick={() => p.onToggleMod(l.id, m)} className={clsx(s.mod, on && s.modOn)}>{m.name}{m.price_delta > 0 && ` +${qtyFmt(m.price_delta)}`}</button>;
                  })}
                </div>
                <input className="input" placeholder="ملاحظة على الصنف ده" value={l.note} maxLength={80} onChange={(e) => p.onNote(l.id, e.target.value)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <input className="input" placeholder="ملاحظة على الأوردر كله (اختياري)" value={p.notes} maxLength={140} onChange={(e) => p.setNotes(e.target.value)} />
      <div className={s.total}><span>الإجمالي</span><span className="num">{money(p.total)}</span></div>
      <button className={clsx('btn btn-accent', s.send)} disabled={p.sending} onClick={p.onSend}>
        {p.sending ? <Loader2 className="animate-spin" /> : <Send size={20} style={{ transform: 'scaleX(-1)' }} />} ابعت الأوردر
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- Employee picker (طلب شخصي) */
function EmployeePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (e: { id: string; full_name: string }) => void }) {
  const [list, setList] = useState<{ id: string; full_name: string; role: string }[] | null>(null);
  useEffect(() => {
    if (!open || list) return;
    void createClient().from('staff_names').select('id,name').order('name')
      .then(({ data }) => setList((data ?? []).map((x: any) => ({ id: x.id, full_name: x.name, role: '' }))));
  }, [open, list]);
  return (
    <Modal open={open} onClose={onClose} title="الطلب لأنهي موظف؟">
      {!list ? <Loader2 className="animate-spin" /> : list.length === 0 ? <Empty title="مفيش موظفين" hint="لازم اتصال بالإنترنت لتحميل القائمة." /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((e) => <button key={e.id} className="btn btn-ghost" onClick={() => onPick(e)}>{e.full_name}</button>)}
        </div>
      )}
    </Modal>
  );
}
