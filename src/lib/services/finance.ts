import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/helpers/util';

const sb = () => createClient();
export const rpc = async <T = any>(fn: string, args?: Record<string, unknown>) => must(await sb().rpc(fn, args)) as unknown as T;

export const srcLabel: Record<string, string> = {
  booking: 'عربون/دفعة حجز قاعة', session: 'دفعة سيشن', receivable: 'تحصيل فلوس بره', expense: 'مصروف', purchase: 'مشتريات',
  supplier_payment: 'سداد مورد', asset: 'شراء أصل', manual: 'حركة يدوية',
};
export interface Treasury { id: string; name: string; balance: number }
export interface TreasuryTxn { id: string; txn_no: number; direction: 'in' | 'out'; source: string; amount: number; balance_before: number; balance_after: number; note: string | null; created_at: string; profiles?: { full_name: string } | null }
export interface Receivable { id: string; source: 'hall_booking' | 'photo_session'; customer_name: string; customer_phone: string | null; title: string | null; amount: number; paid: number; status: 'open' | 'settled'; created_at: string }
export interface Supplier { id: string; name: string; phone: string | null; notes: string | null; is_active: boolean }

export const getTreasury = async () => must(await sb().from('treasury').select('*').limit(1).single()) as Treasury;
export const listTxns = async (from: string, to: string) => must(await sb().from('treasury_transactions')
  .select('*, profiles:user_id(full_name)').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59.999`).order('txn_no', { ascending: false }).limit(1000)) as unknown as TreasuryTxn[];
export const listReceivables = async () => must(await sb().from('receivables').select('*').order('status').order('created_at', { ascending: false })) as Receivable[];

// ---- بنود العقد ----
export const CONTRACT_KEYS = ['contract_title', 'contract_terms', 'contract_org', 'contract_footer'] as const;
export async function loadSettings(): Promise<Record<string, string>> {
  const rows = must(await sb().from('app_settings').select('key,value')) as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function saveSettings(v: Record<string, string>) {
  must(await sb().from('app_settings').upsert(Object.entries(v).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() })), { onConflict: 'key' }).select());
}

/** CSV (UTF-8 BOM so Excel shows Arabic correctly). */
export function downloadCsv(name: string, head: string[], rows: (string | number | null)[][]) {
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
