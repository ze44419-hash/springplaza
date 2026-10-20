import type { LocalOrder, OrderKind, OrderType, Role } from './types';

/** Arabic locale with Latin digits (0-9) — easier to read on receipts and in number inputs. */
export const LOCALE = 'ar-EG-u-nu-latn';
const CUR_LABEL = process.env.NEXT_PUBLIC_CURRENCY_LABEL || 'ج.م';
const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number | null | undefined) => `${nf.format(Number(n ?? 0))} ${CUR_LABEL}`;

/** "#1042" once synced, "محلي-3F9A" while the order only exists on this device. */
export const orderLabel = (o: Pick<LocalOrder, 'id' | 'order_no'>) =>
  o.order_no ? `#${o.order_no}` : `محلي-${o.id.slice(0, 4).toUpperCase()}`;

export const orderTypeLabel: Record<OrderType, string> = { dine_in: 'صالة', takeaway: 'تيك أواي', delivery: 'دليفري' };

/** The "waiter" role is called "كابتن" everywhere in the UI. */
export const roleLabel: Record<Role, string> = { admin: 'مدير', cashier: 'كاشير', waiter: 'كابتن', accountant: 'محاسب', hall_manager: 'مسؤول القاعة', cafe_manager: 'مدير كافيهات', session_manager: 'مسؤول السيشن' };

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'الآن';
  if (s < 3600) return `منذ ${Math.floor(s / 60)} دقيقة`;
  if (s < 86400) return `منذ ${Math.floor(s / 3600)} ساعة`;
  return new Date(iso).toLocaleDateString(LOCALE);
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Trim trailing zeros: 10.000 → "10", 2.5 → "2.5" */
export const qtyFmt = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** "طاولة 5" / "تيك أواي" / "دليفري" */
export const kindLabel = { employee: 'طلب شخصي', hospitality: 'ضيافة' } as const;

export const destText = (o: { order_type: OrderType; table_id: string | null; order_kind?: OrderKind }, tables: { id: string; label: string }[]) =>
  o.order_kind && o.order_kind !== 'standard' ? kindLabel[o.order_kind] :
  o.order_type === 'dine_in' ? `طاولة ${tables.find((t) => t.id === o.table_id)?.label ?? '؟'}` : orderTypeLabel[o.order_type];
