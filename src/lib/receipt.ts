'use client';
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from './db';
import { createClient } from './supabase/client';

export type ReceiptKind = 'cashier_slip' | 'customer_bill';

/** Everything the admin can change about a printed receipt. Stored as JSON in `receipt_templates.config`. */
export interface ReceiptConfig {
  headline: string;            // big line under the header: "أوردر جديد" / "فاتورة"
  title: string;               // cafe name
  subtitle: string;            // address / slogan
  phone: string;
  logoUrl: string;             // optional, printed in black & white above the title
  headerAlign: 'center' | 'start';
  paperWidth: number;          // roll width in mm — any number, typed by the admin (e.g. 58, 72, 80, 100)
  sideMargin: number;          // blank space left/right inside the roll, mm
  fontPx: number;              // body text size in px
  titlePx: number;             // cafe-name size in px
  logoWidth: number;           // logo width, % of the printable width
  footerAlign: 'center' | 'start';
  labels: Partial<Record<LabelKey, string>>;  // custom wording for the rows (empty = default wording)
  fontSize?: 'sm' | 'md' | 'lg'; // legacy (older saved designs) — converted to fontPx on load
  boldItems: boolean;
  divider: 'dashed' | 'solid' | 'double' | 'none';
  show: {
    dateTime: boolean; orderNo: boolean; type: boolean; table: boolean; captain: boolean; cashier: boolean;
    itemPrices: boolean; modifiers: boolean; notes: boolean; totals: boolean; payment: boolean;
  };
  footer: string;              // free text, one line per row
  copies: number;              // 1–10
  feed: number;                // blank lines after the receipt (room for the cutter)
}

export const LABEL_DEFAULTS = {
  orderNo: 'رقم الأوردر', type: 'النوع', table: 'الطاولة', captain: 'الكابتن', cashier: 'الكاشير', date: 'التاريخ',
  subtotal: 'المجموع', discount: 'الخصم', total: 'الإجمالي', payment: 'طريقة الدفع', tendered: 'المدفوع', change: 'الباقي', notes: 'ملاحظة',
} as const;
export type LabelKey = keyof typeof LABEL_DEFAULTS;

const COMMON = {
  title: 'سبرينج بلازا كافيه', subtitle: '', phone: '', logoUrl: '', headerAlign: 'center' as const,
  paperWidth: 80, sideMargin: 4, fontPx: 13, titlePx: 18, logoWidth: 70, footerAlign: 'center' as const, labels: {},
  divider: 'dashed' as const, copies: 1, feed: 2,
};

export const DEFAULT_CONFIG: Record<ReceiptKind, ReceiptConfig> = {
  cashier_slip: {
    ...COMMON, headline: 'أوردر جديد', boldItems: true, footer: '',
    show: { dateTime: true, orderNo: true, type: true, table: true, captain: true, cashier: false, itemPrices: false, modifiers: true, notes: true, totals: false, payment: false },
  },
  customer_bill: {
    ...COMMON, headline: 'فاتورة', boldItems: false, footer: 'شكرًا لزيارتكم!\nنتمنى نشوفكم قريب',
    show: { dateTime: true, orderNo: true, type: true, table: true, captain: false, cashier: true, itemPrices: true, modifiers: true, notes: false, totals: true, payment: true },
  },
};

export const KIND_LABEL: Record<ReceiptKind, string> = { cashier_slip: 'إيصال الكاشير (تذكرة الأوردر)', customer_bill: 'حساب العميل (الفاتورة)' };

export const FONT_PX = { sm: 11, md: 13, lg: 15 } as const;

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? Math.min(max, Math.max(min, n)) : fallback;
};
/** Limits that keep a typed number printable (a 3 mm roll or a 900 px font would only produce garbage). */
export const LIMITS = { paperWidth: [30, 210], sideMargin: [0, 20], fontPx: [8, 32], titlePx: [10, 48], logoWidth: [10, 100], copies: [1, 10], feed: [0, 30] } as const;

/** Merge a stored (possibly partial / older) config over the defaults so new fields never break old data. */
export function mergeConfig(kind: ReceiptKind, stored: Partial<ReceiptConfig> | undefined | null): ReceiptConfig {
  const d = DEFAULT_CONFIG[kind];
  const c = stored ?? {};
  const fontPx = clamp(c.fontPx ?? (c.fontSize ? FONT_PX[c.fontSize] : undefined), ...LIMITS.fontPx, d.fontPx);
  return {
    ...d, ...c, show: { ...d.show, ...(c.show ?? {}) }, labels: { ...(c.labels ?? {}) },
    paperWidth: clamp(c.paperWidth, ...LIMITS.paperWidth, d.paperWidth),
    sideMargin: clamp(c.sideMargin, ...LIMITS.sideMargin, d.sideMargin),
    fontPx, titlePx: clamp(c.titlePx ?? fontPx + 5, ...LIMITS.titlePx, d.titlePx),
    logoWidth: clamp(c.logoWidth, ...LIMITS.logoWidth, d.logoWidth),
    copies: Math.round(clamp(c.copies, ...LIMITS.copies, d.copies)), feed: Math.round(clamp(c.feed, ...LIMITS.feed, d.feed)),
  };
}

const META_KEY = 'receiptTemplates';

/**
 * Receipt designs, served from IndexedDB (so printing works offline) and refreshed from Supabase on mount
 * and whenever the connection returns.
 */
let tplAt = 0; let staffAt = 0;   // module-level throttle: at most one fetch per 60 s per tab

export function useReceiptTemplates() {
  useEffect(() => {
    const load = async (e?: Event) => {
      if (!e && Date.now() - tplAt < 60_000) return;
      tplAt = Date.now();
      try {
        const { data, error } = await createClient().from('receipt_templates').select('kind,config');
        if (!error && data) await setMeta(META_KEY, Object.fromEntries(data.map((r: any) => [r.kind, r.config])));
      } catch { /* offline — keep cache */ }
    };
    void load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, []);

  const stored = useLiveQuery(() => getMeta<Record<string, Partial<ReceiptConfig>>>(META_KEY), [], undefined);
  return {
    cashier_slip: mergeConfig('cashier_slip', stored?.cashier_slip),
    customer_bill: mergeConfig('customer_bill', stored?.customer_bill),
  } as Record<ReceiptKind, ReceiptConfig>;
}

/** Staff id → name (cashiers may read profiles). Cached so the captain's name prints even offline. */
export function useStaffNames() {
  useEffect(() => {
    (async () => {
      if (Date.now() - staffAt < 60_000) return;
      staffAt = Date.now();
      try {
        const { data, error } = await createClient().from('profiles').select('id,full_name');
        if (!error && data) await setMeta('staff', Object.fromEntries(data.map((p: any) => [p.id, p.full_name])));
      } catch { /* offline */ }
    })();
  }, []);
  return useLiveQuery(async () => (await db.meta.get('staff'))?.value as Record<string, string> | undefined, [], undefined) ?? {};
}
