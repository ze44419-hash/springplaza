import { db, getMeta, setMeta } from './db';
import { createClient } from './supabase/client';

/** Refresh the offline copy of menu data. Called on load and whenever connectivity returns. */
export async function cacheCatalog(force = false): Promise<boolean> {
  try {
    // Throttle: every page mount used to refetch the whole menu. Once a minute is plenty.
    const last = (await getMeta<number>('catalogAt')) ?? 0;
    if (!force && Date.now() - last < 60_000) return true;
    const sb = createClient();
    const [c, p, m, t] = await Promise.all([
      sb.from('categories').select('*').eq('is_active', true).order('sort_order'),
      sb.from('products').select('id,category_id,name,price,image_url,is_available,sort_order').order('sort_order'),
      sb.from('modifiers').select('*').eq('is_active', true).order('name'),
      sb.from('cafe_tables').select('*').eq('is_active', true).order('sort_order'),
    ]);
    if (c.error || p.error || m.error || t.error) return false;
    await db.transaction('rw', db.categories, db.products, db.modifiers, db.cafeTables, async () => {
      await Promise.all([db.categories.clear(), db.products.clear(), db.modifiers.clear(), db.cafeTables.clear()]);
      await Promise.all([
        db.categories.bulkPut(c.data as any[]), db.products.bulkPut(p.data as any[]),
        db.modifiers.bulkPut(m.data as any[]), db.cafeTables.bulkPut(t.data as any[]),
      ]);
    });
    await setMeta('catalogAt', Date.now());
    return true;
  } catch {
    return false; // offline — keep whatever is cached
  }
}
