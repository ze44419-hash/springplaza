'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErrorNote, Spinner } from '@/components/ui/kit';
import PrintDocument from '@/components/print/PrintDocument';
import '@/styles/contract.css';
import { loadSettings } from '@/lib/services/finance';
import { loadBookingFull, slotsText } from '@/lib/services/hall';
import { LOCALE, money } from '@/lib/helpers/format';
import { friendly } from '@/lib/helpers/util';
import type { HallBooking } from '@/lib/types';

/** عقد حجز القاعة — A4. كل البيانات من الحجز نفسه + البنود الافتراضية من الإعدادات. */
export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<HallBooking | null>(null);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { Promise.all([loadBookingFull(id), loadSettings().catch(() => ({}))]).then(([x, c]) => { setB(x); setCfg(c as Record<string, string>); }).catch((e) => setErr(friendly(e.message))); }, [id]);

  if (err) return <ErrorNote message={err} />;
  if (!b) return <Spinner />;
  const day = new Date(`${b.event_date}T00:00:00`).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const terms = (cfg.contract_terms ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const remaining = Math.max(0, b.total - b.paid_amount);
  const items = b.hall_booking_items ?? [];

  return (
    <PrintDocument title={`عقد حجز ${b.booking_no} - ${b.customer_name}`}>
      <div className="contract">
        {cfg.contract_org && <p className="org">{cfg.contract_org}</p>}
        <h1>{cfg.contract_title || 'عقد حجز قاعة'}</h1>
        <p className="meta">رقم الحجز: <b>{b.booking_no}</b> — تاريخ التحرير: {new Date().toLocaleDateString(LOCALE)}</p>

        <h2>بيانات العميل</h2>
        <div className="grid"><div>الاسم: <b>{b.customer_name}</b></div><div>الموبايل: <b dir="ltr">{b.customer_phone ?? '—'}</b></div></div>

        <h2>بيانات الحجز</h2>
        <div className="grid">
          <div>تاريخ المناسبة: <b>{day}</b></div><div>نوع المناسبة: <b>{b.event_type ?? '—'}</b></div>
          <div>القاعة / الإيجار: <b>{b.rate_name}</b></div><div>الفترات: <b>{slotsText(b)}</b></div>
          <div>عدد الضيوف: <b>{b.guests ?? '—'}</b></div>
        </div>

        <h2>البيان المالي</h2>
        <table>
          <thead><tr className="shade"><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>
            <tr><td>{b.rate_name}</td><td>1</td><td>{money(b.hall_price)}</td><td>{money(b.hall_price)}</td></tr>
            {items.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.qty}</td><td>{money(i.unit_price)}</td><td>{money(i.line_total)}</td></tr>)}
            {b.discount > 0 && <tr><td colSpan={3}>خصم</td><td>-{money(b.discount)}</td></tr>}
            <tr className="tot shade"><td colSpan={3}>المبلغ الإجمالي</td><td>{money(b.total)}</td></tr>
            <tr><td colSpan={3}>العربون المدفوع</td><td>{money(b.paid_amount)}</td></tr>
            <tr className="tot shade"><td colSpan={3}>المبلغ المتبقي</td><td>{money(remaining)}</td></tr>
          </tbody>
        </table>

        {terms.length > 0 && (<><h2>الشروط والأحكام</h2><div className="terms">{terms.map((t, i) => <p key={i}>{t}</p>)}</div></>)}
        {b.notes && (<><h2>ملاحظات</h2><p style={{ margin: 0 }}>{b.notes}</p></>)}

        <div className="sign"><div>توقيع الطرف الأول (الإدارة)</div><div>توقيع الطرف الثاني (العميل)</div></div>
        {cfg.contract_footer && <p className="foot">{cfg.contract_footer}</p>}
      </div>
    </PrintDocument>
  );
}
