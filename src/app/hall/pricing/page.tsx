'use client';
import Crud, { type FieldDef } from '@/components/Crud';
import { money } from '@/lib/format';
import type { HallRate, HallService } from '@/lib/types';
import s from './pricing.module.css';

const ACTIVE = { key: 'is_active', label: 'متاح للحجز', type: 'checkbox' } as const;
const ORDER = { key: 'sort_order', label: 'الترتيب', type: 'number', step: '1', hint: 'الأصغر يظهر الأول.' } as const;

const RATE_FIELDS: FieldDef[] = [
  { key: 'name', label: 'اسم الإيجار', type: 'text', required: true, hint: 'مثال: إيجار مناسبة مسائية' },
  { key: 'price', label: 'السعر', type: 'number', required: true },
  ORDER, ACTIVE,
];
const dishFields = (noun: string): FieldDef[] => [
  { key: 'name', label: `اسم ${noun}`, type: 'text', required: true },
  { key: 'price', label: 'سعر البيع', type: 'number', required: true },
  { key: 'cost_price', label: 'التكلفة', type: 'number', required: true, hint: 'تكلفة الوحدة على القاعة (تدخل في COGS).' },
  { key: 'unit_label', label: 'الوحدة', type: 'text', hint: 'مثال: فرد / طبق / خدمة (للعرض فقط).' },
  ORDER, ACTIVE,
];

const activeChip = (on: boolean) => <span className={`chip ${on ? 'bg-fern-light text-fern-ink' : 'bg-petal-100 text-bark-500'}`}>{on ? 'متاح' : 'متوقف'}</span>;

/** Flexible price panel: hall rent options, dishes and extras (cutlery, decor, lighting, DJ …). */
export default function HallPricing() {
  return (
    <div className={s.page}>
      <h1 className={s.title}>الأسعار والخدمات</h1>
      <p className={s.note}>أي تعديل هنا يسري على الحجوزات <b>الجديدة</b> فقط. الحجوزات المسجّلة قبل كده بتحتفظ بأسعارها وقت الحجز.</p>

      <Crud<HallRate> table="hall_rates" title="أسعار إيجار القاعة" noun="سعر إيجار" fields={RATE_FIELDS} orderBy="sort_order"
        defaults={{ name: '', price: 0, sort_order: 0, is_active: true }}
        columns={[{ label: 'الاسم', render: (r) => <b>{r.name}</b> }, { label: 'السعر', render: (r) => <span className="num">{money(r.price)}</span> }, { label: 'الحالة', render: (r) => activeChip(r.is_active) }]} />

      <Crud<HallService> table="hall_services" title="الأطباق والوجبات" noun="طبق" fields={dishFields('الطبق')} orderBy="sort_order" filter={{ kind: 'dish' }}
        defaults={{ name: '', price: 0, cost_price: 0, unit_label: 'فرد', sort_order: 0, is_active: true }}
        columns={[{ label: 'الطبق', render: (r) => <b>{r.name}</b> }, { label: 'السعر', render: (r) => <span className="num">{money(r.price)}{r.unit_label ? ` / ${r.unit_label}` : ''}</span> }, { label: 'الحالة', render: (r) => activeChip(r.is_active) }]} />

      <Crud<HallService> table="hall_services" title="الشوك والخدمات الإضافية" noun="خدمة" fields={dishFields('الخدمة')} orderBy="sort_order" filter={{ kind: 'extra' }}
        defaults={{ name: '', price: 0, cost_price: 0, unit_label: 'خدمة', sort_order: 0, is_active: true }}
        columns={[{ label: 'الخدمة', render: (r) => <b>{r.name}</b> }, { label: 'السعر', render: (r) => <span className="num">{money(r.price)}{r.unit_label ? ` / ${r.unit_label}` : ''}</span> }, { label: 'الحالة', render: (r) => activeChip(r.is_active) }]} />
    </div>
  );
}
