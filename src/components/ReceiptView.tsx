import clsx from 'clsx';
import type { LocalOrder } from '@/lib/types';
import { LABEL_DEFAULTS, type LabelKey, type ReceiptConfig } from '@/lib/receipt';
import { fmtDateTime, orderLabel, orderTypeLabel } from '@/lib/format';

const n2 = (n: number) => Number(n).toFixed(2);
const CUR = process.env.NEXT_PUBLIC_CURRENCY_LABEL || 'ج.م';

export interface ReceiptCtx { tableLabel?: string; captain?: string; cashier?: string }

/**
 * One receipt, driven entirely by the admin-edited ReceiptConfig.
 * Used for: the order ticket auto-printed at the cashier, the customer's bill, and the live preview in the admin page.
 */
export default function ReceiptView({ order, config: c, ctx = {} }: { order: LocalOrder; config: ReceiptConfig; ctx?: ReceiptCtx }) {
  const rule = <div className={clsx('rule', c.divider)} />;
  const head = c.headerAlign === 'center' ? 'center' : '';
  const change = order.payment_method === 'cash' && order.amount_tendered != null ? order.amount_tendered - order.total : null;
  const footerLines = c.footer.split('\n').map((l) => l.trim()).filter(Boolean);
  const L = (k: LabelKey) => c.labels?.[k]?.trim() || LABEL_DEFAULTS[k];

  return (
    <>
      {c.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img className="logo" src={c.logoUrl} alt="" style={{ maxWidth: `${c.logoWidth}%` }} />}
      <h1 className={head} style={{ textAlign: c.headerAlign === 'center' ? 'center' : 'start', fontSize: c.titlePx }}>{c.title}</h1>
      {c.subtitle && <p className={head}>{c.subtitle}</p>}
      {c.phone && <p className={head}><bdi dir="ltr">{c.phone}</bdi></p>}
      {c.headline && <p className={clsx('big', head)} style={{ marginTop: 4 }}>{c.headline}</p>}
      {rule}
      {c.show.orderNo && <div className="row"><span>{L('orderNo')}</span><span><bdi>{orderLabel(order)}</bdi></span></div>}
      {c.show.type && <div className="row"><span>{L('type')}</span><span>{orderTypeLabel[order.order_type]}</span></div>}
      {c.show.table && ctx.tableLabel && <div className="row"><span>{L('table')}</span><span>{ctx.tableLabel}</span></div>}
      {c.show.captain && ctx.captain && <div className="row"><span>{L('captain')}</span><span>{ctx.captain}</span></div>}
      {c.show.cashier && ctx.cashier && <div className="row"><span>{L('cashier')}</span><span>{ctx.cashier}</span></div>}
      {c.show.dateTime && <div className="row"><span>{L('date')}</span><span><bdi>{fmtDateTime(order.paid_at ?? order.created_at)}</bdi></span></div>}
      {rule}
      {order.items.map((it) => (
        <div key={it.id} style={{ marginBottom: 3 }}>
          <div className="row" style={{ fontWeight: c.boldItems ? 800 : 600, fontSize: c.boldItems ? '1.08em' : undefined }}>
            <span>{it.qty} × {it.name}</span>
            {c.show.itemPrices && <span><bdi>{n2((it.unit_price + it.modifiers_total) * it.qty)}</bdi></span>}
          </div>
          {c.show.modifiers && it.modifiers.map((m) => <div key={m.id} className="sub">+ {m.name}</div>)}
          {c.show.notes && it.note && <div className="sub">* {it.note}</div>}
        </div>
      ))}
      {c.show.notes && order.notes && (<>{rule}<p><b>{L('notes')}:</b> {order.notes}</p></>)}
      {c.show.totals && (
        <>
          {rule}
          <div className="row"><span>{L('subtotal')}</span><span><bdi>{n2(order.subtotal)}</bdi></span></div>
          {order.discount > 0 && <div className="row"><span>{L('discount')}</span><span><bdi>-{n2(order.discount)}</bdi></span></div>}
          <div className="row big"><span>{L('total')} ({CUR})</span><span><bdi>{n2(order.total)}</bdi></span></div>
        </>
      )}
      {c.show.payment && order.payment_method && (
        <>
          <div className="row"><span>{L('payment')}</span><span>{order.payment_method === 'cash' ? 'كاش' : 'كارت'}</span></div>
          {order.payment_method === 'cash' && order.amount_tendered != null && <div className="row"><span>{L('tendered')}</span><span><bdi>{n2(order.amount_tendered)}</bdi></span></div>}
          {change != null && change >= 0 && <div className="row"><span>{L('change')}</span><span><bdi>{n2(change)}</bdi></span></div>}
        </>
      )}
      {footerLines.length > 0 && (<>{rule}{footerLines.map((l, i) => <p key={i} className={c.footerAlign === 'start' ? '' : 'center'}>{l}</p>)}</>)}
      {Array.from({ length: c.feed }).map((_, i) => <p key={i}>&nbsp;</p>)}
    </>
  );
}

/** Renders `copies` copies, each starting on a new page (cut). */
export function ReceiptCopies({ order, config, ctx }: { order: LocalOrder; config: ReceiptConfig; ctx?: ReceiptCtx }) {
  return <>{Array.from({ length: config.copies }).map((_, i) => <div key={i} className="copy"><ReceiptView order={order} config={config} ctx={ctx} /></div>)}</>;
}

export const fontPxFor = (c: ReceiptConfig) => c.fontPx;
