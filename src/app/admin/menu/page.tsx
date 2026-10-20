'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Crud from '@/components/Crud';
import { createClient } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import type { CafeTable, Category, Modifier, Product } from '@/lib/types';
import s from './menu.module.css';

const Active = ({ on }: { on: boolean }) => <span className={clsx('chip', on ? 'bg-fern-light text-fern-ink' : 'bg-petal-100 text-bark-400')}>{on ? 'شغّال' : 'مخفي'}</span>;

export default function MenuAdmin() {
  const [tab, setTab] = useState<'products' | 'categories' | 'modifiers' | 'tables'>('products');
  const [cats, setCats] = useState<Category[]>([]);
  const loadCats = () => createClient().from('categories').select('*').order('sort_order').then(({ data }) => setCats((data as Category[]) ?? []));
  useEffect(() => { void loadCats(); }, []);

  return (
    <div className={s.page}>
      <div className={s.tabs} role="tablist">
        {(['products', 'categories', 'modifiers', 'tables'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx(s.tab, tab === t && s.tabOn)}>{{ products: 'الأصناف', categories: 'الأقسام', modifiers: 'الإضافات', tables: 'الطاولات' }[t]}</button>
        ))}
      </div>

      {tab === 'products' && (
        <Crud<Product> table="products" title="الأصناف" noun="صنف" orderBy="sort_order"
          defaults={{ name: '', category_id: cats[0]?.id ?? '', price: '', cost_price: 0, image_url: null, is_available: true, sort_order: 0 }}
          fields={[
            { key: 'name', label: 'الاسم', type: 'text', required: true },
            { key: 'category_id', label: 'القسم', type: 'select', required: true, options: cats.map((c) => ({ value: c.id, label: c.name })) },
            { key: 'price', label: 'سعر البيع', type: 'number', required: true, step: '0.01' },
            { key: 'cost_price', label: 'التكلفة', type: 'number', required: true, step: '0.01', hint: 'تكلفة الوحدة — بتتسجّل على كل بيع وتدخل في COGS.' },
            { key: 'image_url', label: 'الصورة', type: 'image' },
            { key: 'sort_order', label: 'الترتيب', type: 'number', hint: 'الأرقام الأقل بتظهر الأول.' },
            { key: 'is_available', label: 'متاح للطلب', type: 'checkbox' },
          ]}
          columns={[
            { label: 'الصنف', render: (r) => (
              <span className={s.item}>
                {r.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.image_url} alt="" className={s.itemImg} />
                  : <span className={s.itemLetter}>{r.name[0]}</span>}
                <b>{r.name}</b>
              </span>) },
            { label: 'القسم', render: (r) => cats.find((c) => c.id === r.category_id)?.name ?? '—' },
            { label: 'السعر', render: (r) => money(r.price) },
            { label: 'التكلفة', render: (r) => money(r.cost_price) },
            { label: 'الحالة', render: (r) => <Active on={r.is_available} /> },
          ]} />
      )}
      {tab === 'categories' && (
        <Crud<Category> table="categories" title="الأقسام" noun="قسم" orderBy="sort_order" onChanged={loadCats}
          defaults={{ name: '', sort_order: cats.length + 1, is_active: true }}
          fields={[{ key: 'name', label: 'الاسم', type: 'text', required: true }, { key: 'sort_order', label: 'الترتيب', type: 'number' }, { key: 'is_active', label: 'يظهر في المنيو', type: 'checkbox' }]}
          columns={[{ label: 'الاسم', render: (r) => <b>{r.name}</b> }, { label: 'الترتيب', render: (r) => r.sort_order }, { label: 'الحالة', render: (r) => <Active on={r.is_active} /> }]} />
      )}
      {tab === 'modifiers' && (
        <Crud<Modifier> table="modifiers" title="الإضافات السريعة" noun="إضافة" orderBy="name"
          defaults={{ name: '', price_delta: 0, is_active: true }}
          fields={[{ key: 'name', label: 'الاسم', type: 'text', required: true }, { key: 'price_delta', label: 'سعر الإضافة', type: 'number', step: '0.01', hint: 'اكتب 0 للإضافات المجانية زي «بدون فوم».' }, { key: 'is_active', label: 'تظهر للكباتن', type: 'checkbox' }]}
          columns={[{ label: 'الاسم', render: (r) => <b>{r.name}</b> }, { label: 'الزيادة', render: (r) => (r.price_delta > 0 ? `+${money(r.price_delta)}` : 'مجانًا') }, { label: 'الحالة', render: (r) => <Active on={r.is_active} /> }]} />
      )}
      {tab === 'tables' && (
        <Crud<CafeTable> table="cafe_tables" title="الطاولات" noun="طاولة" orderBy="sort_order"
          defaults={{ label: '', sort_order: 0, is_active: true }}
          fields={[{ key: 'label', label: 'رقم / اسم الطاولة', type: 'text', required: true }, { key: 'sort_order', label: 'الترتيب', type: 'number' }, { key: 'is_active', label: 'مستخدمة', type: 'checkbox' }]}
          columns={[{ label: 'الاسم', render: (r) => <b>{r.label}</b> }, { label: 'الترتيب', render: (r) => r.sort_order }, { label: 'الحالة', render: (r) => <Active on={r.is_active} /> }]} />
      )}
    </div>
  );
}
