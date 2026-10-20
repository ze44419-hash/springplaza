'use client';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import Crud from '@/components/Crud';
import { createClient } from '@/lib/supabase/client';
import type { Partner } from '@/lib/types';
import s from './partners.module.css';

/** Partners and their percentages. Profit is only distributed when the active shares total exactly 100%. */
export default function PartnersPage() {
  const [total, setTotal] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    const { data } = await createClient().from('partners').select('share_pct').eq('is_active', true);
    setTotal(Math.round(((data ?? []) as { share_pct: number }[]).reduce((a, r) => a + Number(r.share_pct), 0) * 100) / 100);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const ok = total === 100;
  return (
    <div className={s.page}>
      <h1 className={s.title}>الشركاء ونسب الأرباح</h1>
      {total !== null && (
        <div className={clsx(s.meter, ok ? s.meterOk : s.meterBad)} aria-live="polite">
          <div className={s.meterTop}><span>مجموع نسب الشركاء النشطين</span><span className={clsx('num', s.meterValue)}>{total}%</span></div>
          <div className={s.track}><div className={clsx(s.fill, !ok && s.fillBad)} style={{ width: `${Math.min(100, total)}%` }} /></div>
          <p className={s.msg}>{ok ? 'تمام — تقدر تعتمد توزيع الأرباح.' : total > 100 ? `زيادة ${Math.round((total - 100) * 100) / 100}% — قلّل نسبة شريك أو أكتر.` : `ناقص ${Math.round((100 - total) * 100) / 100}% — لازم يكتمل 100% قبل اعتماد التوزيع.`}</p>
        </div>
      )}
      <Crud<Partner> table="partners" title="الشركاء" noun="شريك" orderBy="share_pct" onChanged={() => void refresh()}
        fields={[
          { key: 'name', label: 'اسم الشريك', type: 'text', required: true },
          { key: 'share_pct', label: 'النسبة %', type: 'number', step: '0.01', required: true, hint: 'من 0.01 إلى 100.' },
          { key: 'is_active', label: 'شريك نشط (يدخل في التوزيع)', type: 'checkbox' },
        ]}
        defaults={{ name: '', share_pct: '', is_active: true }}
        columns={[
          { label: 'الشريك', render: (r) => <b>{r.name}</b> },
          { label: 'النسبة', render: (r) => <span className="num font-bold">{r.share_pct}%</span> },
          { label: 'الحالة', render: (r) => <span className={`chip ${r.is_active ? 'bg-fern-light text-fern-ink' : 'bg-petal-100 text-bark-500'}`}>{r.is_active ? 'نشط' : 'متوقف'}</span> },
        ]} />
    </div>
  );
}
