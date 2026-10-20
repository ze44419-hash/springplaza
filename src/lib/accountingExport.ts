import * as XLSX from 'xlsx-js-style';
import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import { loadDistributions } from '@/lib/accounting';
import type { AccountingSummary, ProfitDistribution } from '@/lib/types';

/* ---------- ألوان وتنسيق ---------- */
const COL = {
  title: '0F3D2E', head: '1F6F54', hall: '6D3A8C', exp: 'B45309', partner: '1F4E79', sec: 'E7EFEA',
  good: 'C6EFCE', goodTx: '006100', bad: 'FFC7CE', badTx: '9C0006', total: 'FFF2CC', band: 'F6F8F7',
  cafeTint: 'DDEFE5', hallTint: 'EBDDF3', genTint: 'ECECEC', info: 'DDEBF7', nur: '3F7D20', nurTint: 'E3F1D5', admin: '7A1F3D', adminTint: 'F6DCE5',
};
const thin = { style: 'thin', color: { rgb: 'D0D7D3' } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const MONEY = '#,##0.00', PCT_N = '0.00"%"', PCT_F = '0.0%';

type S = Record<string, any>;
type Cell = { v: string | number; z?: string; s: S };
const base = (o: S = {}): S => ({ font: { name: 'Arial', sz: 11, ...(o.font ?? {}) }, border: BORDER, alignment: { vertical: 'center', ...(o.alignment ?? {}) }, ...(o.fill ? { fill: { patternType: 'solid', fgColor: { rgb: o.fill } } } : {}) });
const text = (v: string | number, o: { fill?: string; bold?: boolean; color?: string; center?: boolean } = {}): Cell =>
  ({ v, s: base({ fill: o.fill, font: { bold: o.bold, color: o.color ? { rgb: o.color } : undefined }, alignment: { horizontal: o.center ? 'center' : 'right', wrapText: true } }) });
const num = (v: number, z = MONEY, o: { fill?: string; bold?: boolean; color?: string } = {}): Cell =>
  ({ v, z, s: base({ fill: o.fill, font: { bold: o.bold, color: o.color ? { rgb: o.color } : undefined }, alignment: { horizontal: 'center' } }) });
const head = (v: string, fill: string): Cell => text(v, { fill, bold: true, color: 'FFFFFF', center: true });
const title = (v: string): Cell => ({ v, s: { font: { name: 'Arial', sz: 16, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: COL.title } }, alignment: { horizontal: 'center', vertical: 'center' } } });
const section = (v: string): Cell => text(v, { fill: COL.sec, bold: true, color: COL.head });
/** ربح/خسارة: أخضر لو موجب، أحمر لو سالب */
const profit = (v: number, z = MONEY, bold = false): Cell => num(v, z, { fill: v < 0 ? COL.bad : COL.good, color: v < 0 ? COL.badTx : COL.goodTx, bold });
const blank = (): Cell => ({ v: '', s: {} });

function makeSheet(rows: (Cell | null)[][], widths: number[], merges: XLSX.Range[] = [], heights: Record<number, number> = {}) {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => row.forEach((c, i) => {
    maxC = Math.max(maxC, i);
    if (!c) return;
    const cell: any = { v: c.v, t: typeof c.v === 'number' ? 'n' : 's', s: c.s };
    if (c.z) cell.z = c.z;
    ws[XLSX.utils.encode_cell({ r, c: i })] = cell;
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxC, widths.length - 1) } });
  ws['!cols'] = widths.map((wch) => ({ wch }));
  ws['!rows'] = rows.map((_, r) => ({ hpt: heights[r] ?? 22 }));
  if (merges.length) ws['!merges'] = merges;
  return ws;
}
/** عنوان مدموج بعرض الجدول */
const titleRow = (txt: string, cols: number): { row: Cell[]; merge: XLSX.Range } => ({
  row: [title(txt), ...Array.from({ length: cols - 1 }, () => title(''))],
  merge: { s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } },
});

const SCOPE: Record<string, string> = { cafe: 'الكافيه', hall: 'القاعة', general: 'عام' };
const SCOPE_TINT: Record<string, string> = { cafe: COL.cafeTint, hall: COL.hallTint, general: COL.genTint };
const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

const EXP_TYPE: Record<string, string> = { operational: 'تشغيلي', establishment: 'تأسيس', hospitality: 'ضيافة' };
const KIND: Record<string, string> = { employee: 'موظف', partner: 'شريك', admin: 'أدمن' };
const ADMIN_CAT = 'راتب الأدمن';
/** عنوان قسم مدموج داخل الشيت */
function sec(rows: (Cell | null)[][], merges: XLSX.Range[], label: string, cols: number) {
  rows.push([], [section(label), ...Array.from({ length: cols - 1 }, () => section(''))]);
  merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: cols - 1 } });
}

export function buildWorkbook(d: any, hist: ProfitDistribution[], from: string, to: string): XLSX.WorkBook {
  const NU = d.nursery, P = d.pnl, AS = d.admin_salary;
  // الأرقام الرسمية للربح/الشركاء بتيجي من السيرفر (الأساس الجديد: المشتل + حجز راتب الأدمن)
  const S = { ...(d.summary as AccountingSummary), net_profit: n(P.final_net), partners: P.partners } as AccountingSummary;
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const rev = n(S.total_revenue) + n(NU.revenue);
  const ofRev = (v: number) => (rev ? v / rev : 0);

  /* 1) الملخص المالي */
  {
    const t = titleRow('الملخص المالي — Spring Plaza', 4);
    const row = (label: string, v: number, o: { fill?: string; bold?: boolean; neg?: boolean; note?: string } = {}): Cell[] => [
      text(label, { fill: o.fill, bold: o.bold }),
      num(o.neg ? -v : v, MONEY, { fill: o.fill, bold: o.bold, color: o.neg ? COL.badTx : undefined }),
      num(ofRev(v), PCT_F, { fill: o.fill, bold: o.bold }), text(o.note ?? '', { fill: o.fill })];
    const nb = n(P.net_before_establishment), fin = n(P.final_net);
    const rows: (Cell | null)[][] = [
      t.row,
      [text('الفترة', { bold: true, fill: COL.info }), text(`${from}  ←  ${to}`, { fill: COL.info, center: true }), text('تاريخ الإصدار', { bold: true, fill: COL.info }), text(new Date().toLocaleString('ar-EG'), { fill: COL.info, center: true })],
      [],
      [head('البند', COL.head), head('القيمة', COL.head), head('% من الإيرادات', COL.head), head('ملاحظة', COL.head)],
      row('إيرادات الكافيه', n(S.cafe_revenue), { fill: COL.cafeTint, note: `${n(S.cafe_orders)} أوردر مدفوع` }),
      row('إيرادات القاعة', n(S.hall_revenue), { fill: COL.hallTint, note: `${n(S.hall_bookings)} حجز منتهي` }),
      row('مبيعات المشتل', n(NU.revenue), { fill: COL.nurTint, note: `${n(NU.sales_count)} عملية بيع` }),
      row('إجمالي الإيرادات', rev, { bold: true, fill: COL.total }),
      row('تكلفة البضاعة — الكافيه', n(S.cafe_cogs), { fill: COL.bad, neg: true }),
      row('تكلفة البضاعة — القاعة', n(S.hall_cogs), { fill: COL.bad, neg: true }),
      row('تكلفة البضاعة — المشتل', n(NU.cogs), { fill: COL.bad, neg: true }),
      row('إجمالي COGS', n(S.cogs_total) + n(NU.cogs), { bold: true, fill: COL.total, neg: true }),
      [text('مجمل الربح', { bold: true, fill: COL.info }), profit(n(P.gross), MONEY, true), num(ofRev(n(P.gross)), PCT_F, { fill: COL.info }), text('الإيرادات − COGS', { fill: COL.info })],
      row('مصروفات تشغيلية وضيافة (بدون راتب الأدمن)', n(P.opex), { fill: COL.bad, neg: true }),
      row('مصروفات المشتل', n(P.nursery_expenses), { fill: COL.bad, neg: true, note: 'شيت المشتل' }),
      [text('صافي الربح قبل مصاريف التأسيس', { bold: true, fill: COL.info }), profit(nb, MONEY, true), num(ofRev(nb), PCT_F, { bold: true, fill: COL.info }), text('وعاء راتب الأدمن', { fill: COL.info })],
      row(`راتب الأدمن المحجوز (${n(AS.percent)}%)`, n(P.admin_salary), { fill: COL.adminTint, bold: true, neg: true, note: 'تفاصيله في شيت «راتب الأدمن»' }),
      row('مصاريف التأسيس والتصميم', n(P.establishment), { fill: COL.bad, neg: true }),
      [text(fin < 0 ? 'صافي الخسارة النهائي' : 'صافي الربح النهائي', { bold: true, fill: fin < 0 ? COL.bad : COL.good, color: fin < 0 ? COL.badTx : COL.goodTx }), profit(fin, MONEY, true), num(ofRev(fin), PCT_F, { bold: true, fill: fin < 0 ? COL.bad : COL.good }), text('بعد راتب الأدمن والتأسيس', { fill: fin < 0 ? COL.bad : COL.good })],
    ];
    const merges = [t.merge];
    // المصروفات حسب التصنيف (بدون راتب الأدمن — له شيت مستقل)
    const byCat = new Map<string, number>();
    (d.expenses as any[]).filter((e) => e.category !== ADMIN_CAT).forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + n(e.amount)));
    const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]), catTotal = catRows.reduce((a, [, v]) => a + v, 0);
    sec(rows, merges, 'المصروفات حسب التصنيف (بدون راتب الأدمن)', 4);
    rows.push([head('التصنيف', COL.exp), head('المبلغ', COL.exp), head('% من المصروفات', COL.exp), head('', COL.exp)]);
    catRows.forEach(([c, v], i) => { const f = i % 2 ? COL.band : undefined; rows.push([text(c, { fill: f }), num(v, MONEY, { fill: f }), num(catTotal ? v / catTotal : 0, PCT_F, { fill: f }), text('', { fill: f })]); });
    // حصص الشركاء من الصافي النهائي
    if (S.partners?.length) {
      sec(rows, merges, 'حصص الشركاء من صافي الربح النهائي', 4);
      rows.push([head('الشريك', COL.partner), head('النسبة', COL.partner), head('الحصة', COL.partner), head('', COL.partner)]);
      S.partners.forEach((p, i) => { const f = i % 2 ? COL.band : undefined; rows.push([text(p.name, { fill: f, bold: true }), num(n(p.share_pct), PCT_N, { fill: f, bold: true }), profit(n(p.amount)), text('', { fill: f })]); });
    }
    const days = (S.daily ?? []).filter((x) => n(x.cafe) || n(x.hall) || n(x.expenses));
    if (days.length) {
      sec(rows, merges, 'الحركة اليومية', 4);
      rows.push([head('اليوم', COL.head), head('كافيه', COL.head), head('قاعة', COL.head), head('مصروفات', COL.head)]);
      days.forEach((x, i) => { const f = i % 2 ? COL.band : undefined; rows.push([text(x.day, { fill: f, center: true }), num(n(x.cafe), MONEY, { fill: f }), num(n(x.hall), MONEY, { fill: f }), num(n(x.expenses), MONEY, { fill: f })]); });
    }
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [44, 20, 20, 34], merges, { 0: 34 }), 'الملخص المالي');
  }

  /* 2) مبيعات الكافيه */
  {
    const items = (d.cafe as any[]).map((r) => ({ name: r.name as string, qty: n(r.qty), rev: n(r.revenue), cogs: n(r.cogs) }));
    const disc = n(d.cafe_discounts);
    const sumRev = items.reduce((a, r) => a + r.rev, 0) - disc;
    const sumCogs = items.reduce((a, r) => a + r.cogs, 0);
    const t = titleRow(`مبيعات الكافيه  (${from} ← ${to})`, 7);
    const rows: (Cell | null)[][] = [t.row, [head('الصنف', COL.head), head('الكمية', COL.head), head('الإيراد', COL.head), head('التكلفة (COGS)', COL.head), head('الربح', COL.head), head('هامش الربح', COL.head), head('% من المبيعات', COL.head)]];
    items.forEach((r, i) => {
      const f = i % 2 ? COL.band : undefined, p = r.rev - r.cogs;
      rows.push([text(r.name, { fill: f, bold: true }), num(r.qty, '#,##0', { fill: f }), num(r.rev, MONEY, { fill: f }), num(r.cogs, MONEY, { fill: f }), profit(p), num(r.rev ? p / r.rev : 0, PCT_F, { fill: f }), num(sumRev ? r.rev / sumRev : 0, PCT_F, { fill: f })]);
    });
    if (disc) rows.push([text('خصومات الأوردرات', { fill: COL.bad, color: COL.badTx }), text('', { fill: COL.bad }), num(-disc, MONEY, { fill: COL.bad, color: COL.badTx }), text('', { fill: COL.bad }), num(-disc, MONEY, { fill: COL.bad, color: COL.badTx }), text('', { fill: COL.bad }), text('', { fill: COL.bad })]);
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), num(items.reduce((a, r) => a + r.qty, 0), '#,##0', { bold: true, fill: COL.total }), num(r2(sumRev), MONEY, { bold: true, fill: COL.total }), num(r2(sumCogs), MONEY, { bold: true, fill: COL.total }), profit(r2(sumRev - sumCogs), MONEY, true), num(sumRev ? (sumRev - sumCogs) / sumRev : 0, PCT_F, { bold: true, fill: COL.total }), num(sumRev ? 1 : 0, PCT_F, { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [30, 10, 16, 16, 16, 14, 14], [t.merge], { 0: 34 }), 'مبيعات الكافيه');
  }

  /* 3) أرباح القاعة */
  {
    const hall = (d.hall as any[]).map((b) => ({ no: n(b.booking_no), date: b.event_date as string, cust: b.customer_name as string, type: (b.event_type ?? '') as string, rent: n(b.hall_price), dishes: n(b.dishes_total), extras: n(b.extras_total), disc: n(b.discount), total: n(b.total), cogs: n(b.cogs) }));
    const t = titleRow(`أرباح القاعة  (${from} ← ${to})`, 12);
    const rows: (Cell | null)[][] = [t.row, ['رقم الحجز', 'التاريخ', 'العميل', 'المناسبة', 'الإيجار', 'الأطباق', 'الخدمات', 'الخصم', 'الإجمالي', 'التكلفة (COGS)', 'الربح', 'هامش الربح'].map((h) => head(h, COL.hall))];
    hall.forEach((b, i) => {
      const f = i % 2 ? COL.band : undefined, p = b.total - b.cogs;
      rows.push([num(b.no, '0', { fill: f }), text(b.date, { fill: f, center: true }), text(b.cust, { fill: f, bold: true }), text(b.type, { fill: f }), num(b.rent, MONEY, { fill: f }), num(b.dishes, MONEY, { fill: f }), num(b.extras, MONEY, { fill: f }), num(b.disc, MONEY, { fill: f }), num(b.total, MONEY, { fill: f }), num(b.cogs, MONEY, { fill: f }), profit(p), num(b.total ? p / b.total : 0, PCT_F, { fill: f })]);
    });
    const sm = (k: 'rent' | 'dishes' | 'extras' | 'disc' | 'total' | 'cogs') => r2(hall.reduce((a, b) => a + b[k], 0));
    const tt = sm('total'), tc = sm('cogs');
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), text(`${hall.length} حجز`, { bold: true, fill: COL.total, center: true }), text('', { fill: COL.total }), text('', { fill: COL.total }), ...(['rent', 'dishes', 'extras', 'disc', 'total', 'cogs'] as const).map((k) => num(sm(k), MONEY, { bold: true, fill: COL.total })), profit(r2(tt - tc), MONEY, true), num(tt ? (tt - tc) / tt : 0, PCT_F, { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [11, 13, 24, 16, 13, 13, 13, 11, 14, 15, 14, 12], [t.merge], { 0: 34 }), 'أرباح القاعة');
  }

  /* 4) المشتل */
  {
    const C = 12, t = titleRow(`المشتل  (${from} ← ${to})`, C);
    const merges = [t.merge];
    const rows: (Cell | null)[][] = [t.row, ['المبيعات', 'التكلفة (COGS)', 'مجمل الربح', 'التوريد (مشتريات)', 'المصروفات', 'صافي المشتل'].map((h) => head(h, COL.nur)),
      [num(n(NU.revenue)), num(n(NU.cogs)), profit(n(NU.gross)), num(n(NU.purchases)), num(n(NU.expenses)), profit(n(NU.net), MONEY, true)]];
    sec(rows, merges, 'الأصناف: مبيعات وتكلفة ومخزون', C);
    rows.push(['الصنف', 'النوع', 'المخزون', 'سعر التكلفة', 'سعر البيع', 'المباع', 'الإيراد', 'COGS', 'الربح', 'الموَرَّد', 'قيمة التوريد', 'قيمة المخزون'].map((h) => head(h, COL.nur)));
    (NU.items as any[]).forEach((i, k) => {
      const f = k % 2 ? COL.band : undefined;
      rows.push([text(i.name, { fill: f, bold: true }), text(i.kind === 'plant' ? 'نبات' : 'مستلزم', { fill: f, center: true }), num(n(i.quantity), '#,##0.###', { fill: f }), num(n(i.cost_price), MONEY, { fill: f }), num(n(i.selling_price), MONEY, { fill: f }),
        num(n(i.sold_qty), '#,##0.###', { fill: f }), num(n(i.revenue), MONEY, { fill: f }), num(n(i.cogs), MONEY, { fill: f }), profit(n(i.revenue) - n(i.cogs)), num(n(i.purchased_qty), '#,##0.###', { fill: f }), num(n(i.purchases), MONEY, { fill: f }), num(n(i.stock_value), MONEY, { fill: f })]);
    });
    sec(rows, merges, 'موظفو المشتل', C);
    rows.push([head('الموظف', COL.nur), head('مبيعاته', COL.nur), head('عدد العمليات', COL.nur), head('رواتب/مصاريفه', COL.nur), ...Array.from({ length: C - 4 }, () => null)]);
    (NU.staff as any[]).forEach((m, k) => { const f = k % 2 ? COL.band : undefined; rows.push([text(m.name, { fill: f, bold: true }), num(n(m.sales), MONEY, { fill: f }), num(n(m.txns), '0', { fill: f }), num(n(m.expenses), MONEY, { fill: f })]); });
    sec(rows, merges, 'سجل الحركات (توريد / بيع)', C);
    rows.push(['التاريخ', 'النوع', 'الصنف', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'COGS', 'الموظف', 'ملاحظة'].map((h) => head(h, COL.nur)));
    (NU.txns as any[]).forEach((x) => { const f = x.txn_type === 'sale' ? COL.nurTint : COL.genTint;
      rows.push([text(x.txn_date, { fill: f, center: true }), text(x.txn_type === 'sale' ? 'بيع' : 'توريد', { fill: f, bold: true, center: true }), text(x.item, { fill: f }), num(n(x.qty), '#,##0.###', { fill: f }), num(n(x.unit_price), MONEY, { fill: f }), num(n(x.total), MONEY, { fill: f }), num(n(x.cogs), MONEY, { fill: f }), text(x.staff ?? '', { fill: f }), text(x.note ?? '', { fill: f })]); });
    sec(rows, merges, 'مصروفات المشتل', C);
    rows.push(['التاريخ', 'البند', 'البيان', 'الموظف', 'المبلغ'].map((h) => head(h, COL.exp)));
    (NU.expense_rows as any[]).forEach((e) => rows.push([text(e.expense_date, { center: true }), text(e.category), text(e.description ?? ''), text(e.staff ?? ''), num(n(e.amount))]));
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), text('', { fill: COL.total }), text('', { fill: COL.total }), text('', { fill: COL.total }), num(n(NU.expenses), MONEY, { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [26, 12, 22, 14, 14, 14, 14, 16, 14, 12, 14, 14], merges, { 0: 34 }), 'المشتل');
  }

  /* 5) الموظفون */
  {
    const st = d.staff as any[], t = titleRow(`الموظفون والرواتب  (${from} ← ${to})`, 9);
    const rows: (Cell | null)[][] = [t.row, ['الموظف', 'الوظيفة', 'الفرع / الجهة', 'نظام الراتب', 'الأساسي', 'السلف الحالية', 'خصومات الطلبات', 'مصروف في الفترة', 'عدد الطلبات'].map((h) => head(h, COL.partner))];
    st.forEach((m, k) => { const f = k % 2 ? COL.band : undefined;
      rows.push([text(m.name, { fill: f, bold: true }), text(KIND[m.kind] ?? m.kind, { fill: f, center: true }), text(m.nursery_assigned ? 'المشتل' : (m.branch ?? 'كل الفروع'), { fill: m.nursery_assigned ? COL.nurTint : f, center: true }),
        text(m.salary_type === 'daily' ? 'يومي' : 'شهري', { fill: f, center: true }), num(n(m.base_salary), MONEY, { fill: f }), num(n(m.advances), MONEY, { fill: f }), num(n(m.discounts), MONEY, { fill: f }), num(n(m.paid), MONEY, { fill: f }), num(n(m.orders), '0', { fill: f })]); });
    const sm = (k: string) => r2(st.reduce((a, m) => a + n(m[k]), 0));
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), text(`${st.length} موظف`, { bold: true, fill: COL.total, center: true }), text('', { fill: COL.total }), text('', { fill: COL.total }), num(sm('base_salary'), MONEY, { bold: true, fill: COL.total }), num(sm('advances'), MONEY, { bold: true, fill: COL.total }), num(sm('discounts'), MONEY, { bold: true, fill: COL.total }), num(sm('paid'), MONEY, { bold: true, fill: COL.total }), num(sm('orders'), '0', { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [24, 12, 18, 12, 14, 14, 16, 16, 12], [t.merge], { 0: 34 }), 'الموظفون');
  }

  /* 6) المصروفات (بدون راتب الأدمن — له شيت مستقل) */
  {
    const ex = (d.expenses as any[]).filter((e) => e.category !== ADMIN_CAT);
    const t = titleRow(`المصروفات  (${from} ← ${to})`, 7);
    const rows: (Cell | null)[][] = [t.row, ['التاريخ', 'النوع', 'الفرع', 'النطاق', 'التصنيف', 'البيان', 'المبلغ'].map((h) => head(h, COL.exp))];
    ex.forEach((e) => { const f = e.expense_type === 'establishment' ? COL.info : SCOPE_TINT[e.scope];
      rows.push([text(e.expense_date, { fill: f, center: true }), text(EXP_TYPE[e.expense_type] ?? '', { fill: f, bold: true, center: true }), text(e.branch ?? 'عام', { fill: f, center: true }), text(SCOPE[e.scope] ?? e.scope, { fill: f, center: true }), text(e.category, { fill: f }), text(e.description ?? '', { fill: f }), num(n(e.amount), MONEY, { fill: f })]); });
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), text(`${ex.length} مصروف`, { bold: true, fill: COL.total, center: true }), ...Array.from({ length: 4 }, () => text('', { fill: COL.total })), num(r2(ex.reduce((a, e) => a + n(e.amount), 0)), MONEY, { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [14, 12, 20, 12, 22, 34, 16], [t.merge], { 0: 34 }), 'المصروفات');
  }

  /* 7) راتب الأدمن — مستقل ومفصّل: الوعاء ← النسبة ← المستحق ← المدفوع ← المتبقي */
  {
    const t = titleRow(`راتب الأدمن  (${from} ← ${to})`, 3), merges = [t.merge];
    const nb = n(P.net_before_establishment), due = n(AS.amount), paid = n(AS.paid), left = r2(due - paid);
    const L = (label: string, v: Cell, note = '', f?: string): Cell[] => [text(label, { fill: f, bold: !!f }), v, text(note, { fill: f })];
    const rows: (Cell | null)[][] = [t.row, [head('بند الحساب', COL.admin), head('القيمة', COL.admin), head('ملاحظة', COL.admin)],
      L('إيرادات الكافيه + القاعة', num(n(S.total_revenue), MONEY, { fill: COL.cafeTint })),
      L('+ مبيعات المشتل', num(n(NU.revenue), MONEY, { fill: COL.nurTint })),
      L('− إجمالي COGS', num(-(n(S.cogs_total) + n(NU.cogs)), MONEY, { color: COL.badTx })),
      L('− مصروفات تشغيلية وضيافة (بدون راتب الأدمن)', num(-n(P.opex), MONEY, { color: COL.badTx })),
      L('− مصروفات المشتل', num(-n(P.nursery_expenses), MONEY, { color: COL.badTx })),
      L('= صافي الربح قبل مصاريف التأسيس (الوعاء)', profit(nb, MONEY, true), nb <= 0 ? 'الوعاء غير موجب → لا راتب' : '', COL.info),
      L('نسبة راتب الأدمن', num(n(AS.percent), PCT_N, { bold: true }), 'من إعدادات النظام'),
      L('راتب الأدمن المستحق', num(due, MONEY, { bold: true, fill: COL.adminTint }), 'محجوز من الأرباح قبل توزيع الشركاء', COL.adminTint),
      L('المدفوع فعليًا في الفترة', num(paid, MONEY)),
      L(left >= 0 ? 'المتبقي للصرف' : 'مدفوع زيادة', num(Math.abs(left), MONEY, { bold: true, fill: left > 0 ? COL.total : COL.good }), '', left > 0 ? COL.total : COL.good),
      L('مصاريف التأسيس (لا تدخل الوعاء)', num(n(P.establishment), MONEY), 'تُخصم بعد راتب الأدمن')];
    sec(rows, merges, 'سجل مدفوعات راتب الأدمن', 3);
    rows.push([head('التاريخ', COL.admin), head('البيان', COL.admin), head('المبلغ', COL.admin)]);
    (AS.payments as any[]).forEach((p) => rows.push([text(p.expense_date, { center: true }), text(p.description ?? ''), num(n(p.amount))]));
    rows.push([text('إجمالي المدفوع', { bold: true, fill: COL.total }), text('', { fill: COL.total }), num(paid, MONEY, { bold: true, fill: COL.total })]);
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [48, 22, 36], merges, { 0: 34 }), 'راتب الأدمن');
  }

  /* 5) توزيع أرباح الشركاء */
  {
    const net = n(S.net_profit);
    const t = titleRow('توزيع أرباح الشركاء', 4);
    const okShares = n(S.shares_total) === 100;
    const rows: (Cell | null)[][] = [
      t.row,
      [text('صافي الربح عن الفترة', { bold: true, fill: net < 0 ? COL.bad : COL.good }), profit(net, MONEY, true), text(`${from} ← ${to}`, { fill: COL.info, center: true }), text('', { fill: COL.info })],
      [],
      ['الشريك', 'النسبة', 'الحصة من الربح', 'حالة'].map((h) => head(h, COL.partner)),
    ];
    S.partners.forEach((p, i) => {
      const f = i % 2 ? COL.band : undefined;
      rows.push([text(p.name, { fill: f, bold: true }), num(n(p.share_pct), PCT_N, { fill: f, bold: true }), profit(n(p.amount)), text(n(p.amount) < 0 ? 'خسارة' : n(p.amount) === 0 ? '—' : 'ربح', { fill: f, center: true })]);
    });
    rows.push([text('الإجمالي', { bold: true, fill: COL.total }), num(n(S.shares_total), PCT_N, { bold: true, fill: okShares ? COL.total : COL.bad, color: okShares ? undefined : COL.badTx }), num(r2(S.partners.reduce((a, p) => a + n(p.amount), 0)), MONEY, { bold: true, fill: COL.total }), text(okShares ? 'النسب مكتملة 100%' : 'مجموع النسب ≠ 100%', { bold: true, fill: okShares ? COL.good : COL.bad, color: okShares ? COL.goodTx : COL.badTx, center: true })]);

    const mine = hist.filter((h) => h.period_from <= to && h.period_to >= from);
    const merges = [t.merge];
    if (mine.length) {
      rows.push([], [section('التوزيعات المعتمدة (لقطة ثابتة وقت الاعتماد)'), section(''), section(''), section('')]);
      merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 3 } });
      mine.forEach((h) => {
        rows.push([text(`${h.period_from} ← ${h.period_to}`, { fill: COL.info, bold: true }), text('صافي', { fill: COL.info, center: true }), num(n(h.net_profit), MONEY, { fill: COL.info, bold: true }), text(h.note ?? '', { fill: COL.info })]);
        h.profit_distribution_lines.forEach((l) => rows.push([text(l.partner_name), num(n(l.share_pct), PCT_N), num(n(l.amount)), text('')]));
      });
    }
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, [34, 16, 22, 28], merges, { 0: 34 }), 'توزيع أرباح الشركاء');
  }
  return wb;
}

/** زر "تصدير Excel": بيجيب كل بيانات الفترة وينزّل ملف منسّق بألوان (RTL). */
export async function exportAccountingXlsx(from: string, to: string): Promise<void> {
  const d = must(await createClient().rpc('accounting_export_v2', { p_from: from, p_to: to })) as any;
  let hist: ProfitDistribution[] = [];
  try { hist = await loadDistributions(); } catch { /* التوزيعات اختيارية في الملف */ }
  XLSX.writeFile(buildWorkbook(d, hist, from, to), `accounting_${from}_${to}.xlsx`);
}
