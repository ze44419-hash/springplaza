import type { Ingredient, InvTxType, RecipeLine, WithdrawalItem } from './types';
import { createClient } from './supabase/client';

/**
 * Pure recipe-deduction maths — the same rule pay_order() applies in SQL:
 *   consumption[ingredient] = Σ (item.qty × recipe.qty_per_unit)
 * Used client-side for previews (e.g. "how many servings can we still make?") and unit-testable on its own.
 * The authoritative deduction happens atomically in the database when an order is paid.
 */
export function computeDeductions(
  items: { product_id: string; qty: number }[],
  recipes: RecipeLine[],
): Map<string, number> {
  const byProduct = new Map<string, RecipeLine[]>();
  for (const r of recipes) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);

  const out = new Map<string, number>();
  for (const it of items) {
    for (const r of byProduct.get(it.product_id) ?? []) {
      out.set(r.ingredient_id, (out.get(r.ingredient_id) ?? 0) + it.qty * Number(r.qty_per_unit));
    }
  }
  return out;
}

/** How many units of a product the current stock can still produce (limited by the scarcest ingredient). */
export function maxServings(productRecipe: RecipeLine[], ingredients: Ingredient[]): number | null {
  if (productRecipe.length === 0) return null; // no recipe → not tracked
  const stock = new Map(ingredients.map((i) => [i.id, Number(i.stock_qty)]));
  return Math.max(0, Math.floor(Math.min(...productRecipe.map((r) => (stock.get(r.ingredient_id) ?? 0) / Number(r.qty_per_unit)))));
}

export const isLowStock = (i: Ingredient) => Number(i.stock_qty) <= Number(i.min_threshold);

/** Manual stock movement (purchase, supplier return, adjustment, waste) on one warehouse — atomic via RPC, admin only. */
export async function recordInventoryTx(ingredientId: string, type: Exclude<InvTxType, 'sale'>, qty: number, note?: string, warehouseId?: string) {
  const { error } = await createClient().rpc('record_inventory_tx', {
    p_ingredient: ingredientId, p_type: type, p_qty: qty, p_note: note || null, p_warehouse: warehouseId ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Move stock between two warehouses (admin). The ingredient's total does not change. */
export async function transferStock(from: string, to: string, ingredientId: string, qty: number, note?: string) {
  const { error } = await createClient().rpc('transfer_stock', {
    p_from: from, p_to: to, p_ingredient: ingredientId, p_qty: qty, p_note: note || null,
  });
  if (error) throw new Error(error.message);
}

/** Cashier/admin takes ingredients out of a warehouse for the barista. Records who took what. */
export async function createWithdrawal(warehouseId: string, items: { ingredient_id: string; qty: number }[], note?: string) {
  const { error } = await createClient().rpc('create_withdrawal', { p_warehouse: warehouseId, p_items: items, p_note: note || null });
  if (error) throw new Error(error.message);
}

/** Record what came back to the warehouse; `close` ends the withdrawal and logs anything unaccounted for as a shortfall. */
export async function settleWithdrawal(id: string, returns: { item_id: string; qty: number }[], close: boolean) {
  const { error } = await createClient().rpc('settle_withdrawal', { p_id: id, p_returns: returns, p_close: close });
  if (error) throw new Error(error.message);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** What is still with the barista from this withdrawal line. */
export const remainingOf = (i: WithdrawalItem) => r3(Number(i.qty_out) - Number(i.qty_returned) - Number(i.qty_used) - Number(i.qty_variance));

/** Admin edits an order (items, notes, type/table, status, discount, payment). Paid orders re-do their stock deduction. */
export async function adminEditOrder(payload: Record<string, unknown>) {
  const { error } = await createClient().rpc('admin_edit_order', { p: payload });
  if (error) throw new Error(error.message);
}
