import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import type { AccountingSummary, ExpenseScope, ProfitDistribution } from '@/lib/types';

export const scopeLabel: Record<ExpenseScope, string> = { cafe: 'الكافيه', hall: 'القاعة', general: 'عام' };
export const scopeChip: Record<ExpenseScope, string> = {
  cafe: 'bg-fern-light text-fern-ink', hall: 'bg-blossom-light text-blossom-ink', general: 'bg-petal-100 text-bark-500',
};
/** Suggestions for the expense category field (free text — the accountant may type anything). */
export const EXPENSE_CATEGORIES = ['رواتب', 'إيجار', 'كهرباء ومياه', 'صيانة', 'تسويق', 'نظافة', 'مصروفات نثرية', 'أخرى'];

/** Net profit = (revenue − COGS) − operating expenses. Mirrors `_acc_totals` in SQL. */
export const netProfit = (revenue: number, cogs: number, expenses: number) => Math.round(((revenue - cogs) - expenses) * 100) / 100;

export async function getSummary(from: string, to: string): Promise<AccountingSummary> {
  return must(await createClient().rpc('accounting_summary', { p_from: from, p_to: to })) as unknown as AccountingSummary;
}
export async function distributeProfit(from: string, to: string, note?: string): Promise<string> {
  return must(await createClient().rpc('distribute_profit', { p_from: from, p_to: to, p_note: note ?? null })) as unknown as string;
}
export async function loadDistributions(): Promise<ProfitDistribution[]> {
  return must(await createClient().from('profit_distributions').select('*, profit_distribution_lines(*)')
    .order('period_to', { ascending: false }).limit(50)) as unknown as ProfitDistribution[];
}
