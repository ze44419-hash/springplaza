'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import PeriodPicker, { type Period } from '@/components/tables/PeriodPicker';
import { ErrorNote, Spinner } from '@/components/ui/kit';
import ReportTable, { type Col } from '@/components/tables/ReportTable';
import { rpc, srcLabel } from '@/lib/services/finance';
import { friendly } from '@/lib/helpers/util';
import s from '../finance.module.css';

type R = Record<string, any>;
const bk: Record<string, string> = { pending: 'مبدئي', confirmed: 'مؤكد', completed: 'تم', cancelled: 'ملغي' };
const TABS: { id: string; label: string; fn: string; dated: boolean; cols: Col<R>[] }[] = [
  { id: 'customers', label: 'العملاء', fn: 'report_customers', dated: true, cols: [
    { key: 'name', label: 'العميل' }, { key: 'phone', label: 'الموبايل' }, { key: 'bookings', label: 'عدد الحجوزات' },
    { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'paid', label: 'إجمالي المدفوع', kind: 'money' }, { key: 'remaining', label: 'المتبقي', kind: 'money' }] },
  { id: 'bookings', label: 'الحجوزات الشامل', fn: 'report_bookings', dated: true, cols: [
    { key: 'kind', label: 'النوع' }, { key: 'no', label: '#' }, { key: 'date', label: 'التاريخ' }, { key: 'name', label: 'العميل' },
    { key: 'status', label: 'الحالة', get: (r) => bk[r.status] ?? r.status }, { key: 'periods', label: 'الفترات' },
    { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'paid', label: 'المدفوع', kind: 'money' }, { key: 'remaining', label: 'المتبقي', kind: 'money' }] },
  { id: 'partial', label: 'الحركة الجزئية', fn: 'report_partial', dated: true, cols: [] },
  { id: 'suppliers', label: 'الموردين', fn: 'report_suppliers', dated: false, cols: [
    { key: 'name', label: 'المورد' }, { key: 'phone', label: 'الموبايل' }, { key: 'invoices', label: 'الفواتير' },
    { key: 'supplied', label: 'التوريدات', kind: 'money' }, { key: 'paid', label: 'المدفوع', kind: 'money' }, { key: 'due', label: 'المستحق', kind: 'money' }] },
  { id: 'purchases', label: 'المشتريات', fn: 'report_purchases', dated: true, cols: [
    { key: 'no', label: '#' }, { key: 'date', label: 'التاريخ' }, { key: 'supplier', label: 'المورد' }, { key: 'items', label: 'الأصناف' },
    { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'paid', label: 'المدفوع', kind: 'money' }, { key: 'due', label: 'الآجل', kind: 'money' }] },
  { id: 'inventory', label: 'المخزون', fn: 'report_inventory', dated: true, cols: [
    { key: 'name', label: 'الخامة' }, { key: 'unit', label: 'الوحدة' }, { key: 'qty', label: 'الرصيد', kind: 'qty' }, { key: 'min', label: 'حد التنبيه', kind: 'qty' },
    { key: 'inflow', label: 'وارد الفترة', kind: 'qty' }, { key: 'outflow', label: 'منصرف الفترة', kind: 'qty' }] },
  { id: 'assets', label: 'الأصول', fn: 'report_assets', dated: false, cols: [
    { key: 'name', label: 'الأصل' }, { key: 'category', label: 'التصنيف' }, { key: 'purchase_date', label: 'تاريخ الشراء' },
    { key: 'cost', label: 'التكلفة', kind: 'money' }, { key: 'monthly_dep', label: 'إهلاك شهري', kind: 'money' },
    { key: 'accumulated', label: 'مجمع الإهلاك', kind: 'money' }, { key: 'book_value', label: 'القيمة الدفترية', kind: 'money' }] },
];
const PARTIAL_OPEN: Col<R>[] = [
  { key: 'kind', label: 'النوع' }, { key: 'no', label: '#' }, { key: 'date', label: 'التاريخ' }, { key: 'name', label: 'العميل' },
  { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'paid', label: 'المدفوع', kind: 'money' }, { key: 'remaining', label: 'المتبقي', kind: 'money' }];
const PARTIAL_MOV: Col<R>[] = [
  { key: 'at', label: 'الوقت', get: (r) => String(r.at).slice(0, 16).replace('T', ' ') }, { key: 'source', label: 'النوع', get: (r) => srcLabel[r.source] ?? r.source },
  { key: 'amount', label: 'المبلغ', kind: 'money' }, { key: 'balance_after', label: 'رصيد الخزنة بعد', kind: 'money' }, { key: 'note', label: 'ملاحظات' }];

export default function ReportsPage() {
  const [tab, setTab] = useState(TABS[0]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!period) return;
    setData(null); setErr(null);
    rpc(tab.fn, tab.dated ? { p_from: period.from, p_to: period.to } : undefined)
      .then((d) => setData(d ?? (tab.id === 'partial' ? { open: [], movements: [] } : [])))
      .catch((e) => { setErr(friendly(e.message)); setData(tab.id === 'partial' ? { open: [], movements: [] } : []); });
  }, [tab, period]);

  return (
    <div className={s.page}>
      <h1 className={s.title}>التقارير</h1>
      <div className={clsx(s.tabs, s.noPrint)}>{TABS.map((t) => <button key={t.id} className={clsx('btn-sm', t.id === tab.id ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab(t)}>{t.label}</button>)}</div>
      <div className={s.noPrint}><PeriodPicker onChange={setPeriod} /></div>
      <ErrorNote message={err} />
      {data === null ? <Spinner /> : tab.id === 'partial' ? (
        <>
          <h2 className={s.k}>حجوزات مدفوعة جزئيًا</h2><ReportTable name="partial-open" cols={PARTIAL_OPEN} rows={data.open ?? []} />
          <h2 className={s.k}>حركات التحصيل</h2><ReportTable name="partial-movements" cols={PARTIAL_MOV} rows={data.movements ?? []} totals={false} />
        </>
      ) : <ReportTable name={`report-${tab.id}`} cols={tab.cols} rows={data} />}
    </div>
  );
}
