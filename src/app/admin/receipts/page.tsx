'use client';
import { useEffect, useMemo, useState } from 'react';
import { Copy, ImagePlus, Loader2, Printer, RotateCcw, Save } from 'lucide-react';
import clsx from 'clsx';
import { paperStyle, usePrint } from '@/components/Print';
import ReceiptView, { fontPxFor, ReceiptCopies } from '@/components/ReceiptView';
import { ErrorNote, Spinner } from '@/components/kit';
import { useProfile } from '@/hooks/useProfile';
import { getMeta, setMeta } from '@/lib/db';
import { DEFAULT_CONFIG, KIND_LABEL, LABEL_DEFAULTS, LIMITS, mergeConfig, type LabelKey, type ReceiptConfig, type ReceiptKind } from '@/lib/receipt';
import { createClient } from '@/lib/supabase/client';
import { uuid } from '@/lib/format';
import { friendly, shrinkImage } from '@/lib/util';
import type { LocalOrder } from '@/lib/types';
import s from './receipts.module.css';

const KINDS: ReceiptKind[] = ['cashier_slip', 'customer_bill'];
const SHOW_LABELS: Record<keyof ReceiptConfig['show'], string> = {
  dateTime: 'التاريخ والوقت', orderNo: 'رقم الأوردر', type: 'نوع الأوردر (صالة / تيك أواي)', table: 'رقم الطاولة', captain: 'اسم الكابتن', cashier: 'اسم الكاشير',
  itemPrices: 'سعر كل صنف', modifiers: 'الإضافات (سكر زيادة…)', notes: 'الملاحظات', totals: 'المجموع والخصم والإجمالي', payment: 'طريقة الدفع والباقي',
};

const LABEL_FIELDS: [LabelKey, string][] = [
  ['orderNo', 'رقم الأوردر'], ['type', 'النوع'], ['table', 'الطاولة'], ['captain', 'الكابتن'], ['cashier', 'الكاشير'], ['date', 'التاريخ'],
  ['subtotal', 'المجموع'], ['discount', 'الخصم'], ['total', 'الإجمالي'], ['payment', 'طريقة الدفع'], ['tendered', 'المدفوع'], ['change', 'الباقي'], ['notes', 'الملاحظات'],
];

/** Number box you can type freely in (clearing it, typing "7" on the way to "72"…); the value is clamped to [min, max] on blur. */
function NumField({ id, value, onChange, min, max, step = 1, unit }: { id: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; unit?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (parseFloat(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} dir="ltr" className="input" type="number" inputMode="decimal" min={min} max={max} step={step} value={text}
        style={unit ? { paddingInlineEnd: 48 } : undefined}
        onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        onBlur={() => { const n = parseFloat(text); const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value; onChange(v); setText(String(v)); }} />
      {unit && <span style={{ position: 'absolute', insetBlock: 0, insetInlineEnd: 14, display: 'grid', placeItems: 'center', color: 'var(--bark-400)', fontSize: '.85rem', pointerEvents: 'none' }}>{unit}</span>}
    </div>
  );
}

const KIOSK_CMD = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir="%LOCALAPPDATA%\\SpringPlazaPrint" --app=http://localhost:3000/cashier';

/** Sample order used by the preview and the test print. */
const SAMPLE: LocalOrder = {
  id: 'sample', order_no: 1042, order_type: 'dine_in', table_id: 't', waiter_id: 'w', status: 'completed', notes: 'من غير ثلج للطلب كله',
  subtotal: 175, discount: 5, total: 170, payment_method: 'cash', amount_tendered: 200, paid_at: new Date().toISOString(),
  shift_id: null, cashier_id: 'c', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  items: [
    { id: '1', order_id: 's', product_id: 'p1', name: 'قهوة تركي', unit_price: 40, qty: 2, modifiers: [{ id: 'm1', name: 'سكر زيادة', price_delta: 0 }], modifiers_total: 0, note: null, position: 1 },
    { id: '2', order_id: 's', product_id: 'p2', name: 'لاتيه', unit_price: 65, qty: 1, modifiers: [{ id: 'm2', name: 'شوت زيادة', price_delta: 15 }], modifiers_total: 15, note: 'سخن جدًا', position: 2 },
  ],
};
const SAMPLE_CTX = { tableLabel: '5', captain: 'أحمد', cashier: 'منى' };

export default function ReceiptDesigner() {
  const { profile } = useProfile();
  const { print, portal } = usePrint();
  const [kind, setKind] = useState<ReceiptKind>('cashier_slip');
  const [cfgs, setCfgs] = useState<Record<ReceiptKind, ReceiptConfig> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await createClient().from('receipt_templates').select('kind,config');
      if (error) { setErr(friendly(error.message)); }
      const by = Object.fromEntries((data ?? []).map((r: any) => [r.kind, r.config]));
      setCfgs({ cashier_slip: mergeConfig('cashier_slip', by.cashier_slip), customer_bill: mergeConfig('customer_bill', by.customer_bill) });
    })();
  }, []);

  const cfg = cfgs?.[kind];
  const set = (patch: Partial<ReceiptConfig>) => { setSaved(false); setCfgs((c) => c && { ...c, [kind]: { ...c[kind], ...patch } }); };
  const setShow = (k: keyof ReceiptConfig['show'], v: boolean) => cfg && set({ show: { ...cfg.show, [k]: v } });

  const preview = useMemo(() => cfg && (
    <div className="paper" style={paperStyle(cfg.paperWidth, cfg.fontPx, cfg.sideMargin)}>
      <ReceiptView order={SAMPLE} config={cfg} ctx={SAMPLE_CTX} />
    </div>
  ), [cfg]);
  // wide rolls are shrunk on screen only, so the preview always fits its column (printing is unaffected)
  const zoom = cfg ? Math.min(1, 330 / (cfg.paperWidth * 3.78)) : 1;

  async function save() {
    if (!cfg || !cfgs) return;
    setBusy(true); setErr(null); setSaved(false);
    try {
      const { error } = await createClient().from('receipt_templates').upsert({ kind, config: cfg, updated_by: profile?.id ?? null, updated_at: new Date().toISOString() });
      if (error) throw new Error(friendly(error.message));
      const cache = (await getMeta<Record<string, unknown>>('receiptTemplates')) ?? {};
      await setMeta('receiptTemplates', { ...cache, [kind]: cfg });
      setSaved(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function uploadLogo(file: File) {
    setBusy(true); setErr(null);
    try {
      const sb = createClient();
      const blob = await shrinkImage(file, 400);
      const path = `receipt-logo-${uuid()}.webp`;
      const up = await sb.storage.from('product-images').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' });
      if (up.error) throw new Error(up.error.message);
      set({ logoUrl: sb.storage.from('product-images').getPublicUrl(path).data.publicUrl });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!cfg) return <Spinner />;

  return (
    <div className={s.page}>
      <div>
        <h1 className="font-display text-3xl font-bold" style={{ margin: 0 }}>تصميم الإيصالات</h1>
        <p className={s.intro}>غيّر شكل ومحتوى الإيصال وشوف النتيجة فورًا. التعديلات بتوصل لكل أجهزة الكاشير أول ما تتحفظ.</p>
      </div>

      <div className={s.kinds} role="tablist">
        {KINDS.map((k) => <button key={k} role="tab" aria-selected={kind === k} className={clsx(s.kind, kind === k && s.kindOn)} onClick={() => { setKind(k); setSaved(false); }}>{KIND_LABEL[k]}</button>)}
      </div>
      <p className={s.intro}>
        {kind === 'cashier_slip' ? 'بتتطبع تلقائيًا عند الكاشير أول ما الكابتن يبعت أوردر جديد.' : 'الفاتورة اللي بتتطبع للعميل عند الدفع أو لما الكاشير يطلب طباعة الحساب.'}
      </p>

      <div className={s.split}>
        <div className={s.form}>
          <section className={s.group}>
            <h2 className={s.groupTitle}>الترويسة</h2>
            <div className={s.two}>
              <div><label className="label" htmlFor="r-title">اسم الكافيه</label><input id="r-title" className="input" value={cfg.title} onChange={(e) => set({ title: e.target.value })} /></div>
              <div><label className="label" htmlFor="r-head">العنوان تحت الاسم</label><input id="r-head" className="input" value={cfg.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="فاتورة / أوردر جديد" /></div>
              <div><label className="label" htmlFor="r-sub">سطر إضافي (العنوان / شعار)</label><input id="r-sub" className="input" value={cfg.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></div>
              <div><label className="label" htmlFor="r-phone">رقم التليفون</label><input id="r-phone" dir="ltr" className="input" value={cfg.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
            </div>
            <div className={s.logoRow}>
              {cfg.logoUrl /* eslint-disable-next-line @next/next/no-img-element */ ? <img className={s.logoThumb} src={cfg.logoUrl} alt="" /> : null}
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}><ImagePlus size={16} /> {cfg.logoUrl ? 'غيّر الشعار' : 'ارفع شعار'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>
              {cfg.logoUrl && <button className="btn btn-ghost btn-sm" onClick={() => set({ logoUrl: '' })}>إزالة</button>}
            </div>
            <div><span className="label">محاذاة الترويسة</span>
              <div className={s.seg}>{(['center', 'start'] as const).map((a) => <button key={a} className={clsx(s.segBtn, cfg.headerAlign === a && s.segOn)} onClick={() => set({ headerAlign: a })}>{a === 'center' ? 'في النص' : 'على اليمين'}</button>)}</div></div>
          </section>

          <section className={s.group}>
            <h2 className={s.groupTitle}>الورق والمقاسات</h2>
            <p className={s.intro} style={{ fontSize: '.9rem' }}>اكتب أي رقم تحتاجه. المقاسات بالمليمتر للورق وبالبكسل للخط.</p>
            <div className={s.two}>
              <div><label className="label" htmlFor="r-paper">عرض رول الورق</label><NumField id="r-paper" value={cfg.paperWidth} onChange={(n) => set({ paperWidth: n })} min={LIMITS.paperWidth[0]} max={LIMITS.paperWidth[1]} unit="مم" />
                <div className={s.seg} style={{ marginTop: 8 }}>{[58, 72, 80, 100].map((w) => <button key={w} className={clsx(s.segBtn, cfg.paperWidth === w && s.segOn)} onClick={() => set({ paperWidth: w })}>{w}</button>)}</div></div>
              <div><label className="label" htmlFor="r-margin">الهامش الجانبي</label><NumField id="r-margin" value={cfg.sideMargin} onChange={(n) => set({ sideMargin: n })} min={LIMITS.sideMargin[0]} max={LIMITS.sideMargin[1]} step={0.5} unit="مم" /></div>
              <div><label className="label" htmlFor="r-font">حجم الخط</label><NumField id="r-font" value={cfg.fontPx} onChange={(n) => set({ fontPx: n })} min={LIMITS.fontPx[0]} max={LIMITS.fontPx[1]} unit="px" /></div>
              <div><label className="label" htmlFor="r-tfont">حجم اسم الكافيه</label><NumField id="r-tfont" value={cfg.titlePx} onChange={(n) => set({ titlePx: n })} min={LIMITS.titlePx[0]} max={LIMITS.titlePx[1]} unit="px" /></div>
              {cfg.logoUrl && <div><label className="label" htmlFor="r-logo">عرض الشعار</label><NumField id="r-logo" value={cfg.logoWidth} onChange={(n) => set({ logoWidth: n })} min={LIMITS.logoWidth[0]} max={LIMITS.logoWidth[1]} unit="%" /></div>}
            </div>
            <div><span className="label">محاذاة نص التذييل</span>
              <div className={s.seg}>{(['center', 'start'] as const).map((a) => <button key={a} className={clsx(s.segBtn, cfg.footerAlign === a && s.segOn)} onClick={() => set({ footerAlign: a })}>{a === 'center' ? 'في النص' : 'على اليمين'}</button>)}</div></div>
            <div><span className="label">شكل الفاصل</span>
              <div className={s.seg}>{([['dashed', 'متقطع'], ['solid', 'خط'], ['double', 'مزدوج'], ['none', 'بدون']] as const).map(([v, l]) => <button key={v} className={clsx(s.segBtn, cfg.divider === v && s.segOn)} onClick={() => set({ divider: v })}>{l}</button>)}</div></div>
            <label className={s.check}><input type="checkbox" checked={cfg.boldItems} onChange={(e) => set({ boldItems: e.target.checked })} /> أسماء الأصناف بخط عريض وكبير</label>
          </section>

          <section className={s.group}>
            <h2 className={s.groupTitle}>اللي يظهر في الإيصال</h2>
            <div className={s.checks}>
              {(Object.keys(SHOW_LABELS) as (keyof ReceiptConfig['show'])[]).map((k) => (
                <label key={k} className={s.check}><input type="checkbox" checked={cfg.show[k]} onChange={(e) => setShow(k, e.target.checked)} /> {SHOW_LABELS[k]}</label>
              ))}
            </div>
          </section>

          <section className={s.group}>
            <h2 className={s.groupTitle}>الكلمات المطبوعة</h2>
            <p className={s.intro} style={{ fontSize: '.9rem' }}>غيّر أي كلمة في الإيصال. سيبها فاضية عشان ترجع للكلمة الأصلية.</p>
            <div className={s.two}>
              {LABEL_FIELDS.map(([k, name]) => (
                <div key={k}><label className="label" htmlFor={`lb-${k}`}>{name}</label>
                  <input id={`lb-${k}`} className="input" value={cfg.labels[k] ?? ''} placeholder={LABEL_DEFAULTS[k]} onChange={(e) => set({ labels: { ...cfg.labels, [k]: e.target.value } })} /></div>
              ))}
            </div>
          </section>

          <section className={s.group}>
            <h2 className={s.groupTitle}>التذييل والطباعة</h2>
            <div><label className="label" htmlFor="r-foot">نص أسفل الإيصال (كل سطر في سطر)</label>
              <textarea id="r-foot" className={clsx('input', s.textarea)} value={cfg.footer} onChange={(e) => set({ footer: e.target.value })} /></div>
            <div className={s.two}>
              <div><label className="label" htmlFor="r-copies">عدد النسخ</label><NumField id="r-copies" value={cfg.copies} onChange={(n) => set({ copies: Math.round(n) })} min={LIMITS.copies[0]} max={LIMITS.copies[1]} /></div>
              <div><label className="label" htmlFor="r-feed">سطور فاضية قبل القص</label><NumField id="r-feed" value={cfg.feed} onChange={(n) => set({ feed: Math.round(n) })} min={LIMITS.feed[0]} max={LIMITS.feed[1]} /></div>
            </div>
          </section>

          <ErrorNote message={err} />
          {saved && <p className={s.saved}>اتحفظ التصميم ✔ — هيتطبق على كل الأجهزة.</p>}
          <div className={s.actions}>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} حفظ التصميم</button>
            <button className="btn btn-ghost" onClick={() => { set(DEFAULT_CONFIG[kind]); }}><RotateCcw size={18} /> رجّع الافتراضي</button>
          </div>
        </div>

        <aside className={s.previewCol} aria-label="معاينة">
          <div className={s.previewHead}><h2 className={s.previewTitle}>معاينة مباشرة</h2><span className={s.intro}>{cfg.paperWidth} مم</span></div>
          <div className={s.desk}><div className={s.paperSheet} style={{ zoom }}>{preview}</div></div>
          <button className="btn btn-accent" onClick={() => void print(<ReceiptCopies order={SAMPLE} config={cfg} ctx={SAMPLE_CTX} />, cfg.paperWidth, fontPxFor(cfg), cfg.sideMargin)}><Printer size={18} /> اطبع نسخة تجريبية</button>

          <section className={s.group}>
            <h2 className={s.groupTitle}>الطباعة التلقائية بدون نافذة</h2>
            <p className={s.intro} style={{ fontSize: '.9rem' }}>المتصفح بيفتح نافذة «Print» لأي طباعة، ومفيش كود يقدر يتخطاها. الحل إن الكاشير يتفتح بوضع الطباعة الصامتة:</p>
            <ol className={s.intro} style={{ fontSize: '.9rem', paddingInlineStart: 20, margin: 0 }}>
              <li>خلّي طابعة الإيصالات هي الطابعة الافتراضية في ويندوز.</li>
              <li>افتح الكاشير من الملف <b>start-cashier-printing.bat</b> (الموجود في فولدر المشروع)، أو شغّل الأمر ده.</li>
            </ol>
            <code dir="ltr" className={s.code}>{KIOSK_CMD}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(KIOSK_CMD)}><Copy size={16} /> انسخ الأمر</button>
          </section>
        </aside>
      </div>
      {portal}
    </div>
  );
}
