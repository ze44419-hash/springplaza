import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import type { NurseryItem, NurseryReportData } from '@/lib/types';

const sb = () => createClient();

export const nurseryReport = async (from: string, to: string) =>
  must(await sb().rpc('nursery_report', { p_from: from, p_to: to })) as unknown as NurseryReportData;

export const nurseryItems = async () =>
  must(await sb().from('nursery_inventory').select('*').order('kind').order('name')) as NurseryItem[];

/** توريد أو بيع — السيرفر بيقفل الصنف ويمنع البيع بالسالب ويحدّث التكلفة المرجّحة. */
export const nurseryRecord = async (a: { item: string; type: 'purchase' | 'sale'; qty: number; price?: number | null; staff?: string | null; note?: string; date?: string }) =>
  must(await sb().rpc('nursery_record', { p_item: a.item, p_type: a.type, p_qty: a.qty, p_price: a.price ?? null, p_staff: a.staff ?? null, p_note: a.note ?? null, p_date: a.date ?? null }));

export const nurseryStaff = async () =>
  must(await sb().from('staff').select('id,name').eq('is_active', true).eq('nursery_assigned', true).order('name')) as { id: string; name: string }[];
