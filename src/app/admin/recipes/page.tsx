'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Empty, ErrorNote, Spinner } from '@/components/kit';
import { createClient } from '@/lib/supabase/client';
import { maxServings } from '@/lib/inventory';
import { qtyFmt } from '@/lib/format';
import { must } from '@/lib/util';
import type { Category, Ingredient, Product, RecipeLine } from '@/lib/types';
import s from './recipes.module.css';

interface Row { ingredient_id: string; qty: string }

/** Maps each product to the raw materials one unit consumes. pay_order() deducts exactly this on checkout. */
export default function RecipesAdmin() {
  const sb = createClient();
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeLine[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, p, i, r] = await Promise.all([
        sb.from('categories').select('*').order('sort_order'), sb.from('products').select('*').order('sort_order'),
        sb.from('ingredients').select('*').order('name'), sb.from('recipes').select('*'),
      ]);
      setCats(must(c) as Category[]); setProducts(must(p) as Product[]); setIngs(must(i) as Ingredient[]); setRecipes(must(r) as RecipeLine[]);
    } catch (e: any) { setErr(e.message); setProducts([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!sel) return setRows([]);
    setRows(recipes.filter((r) => r.product_id === sel).map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty_per_unit) })));
    setSaved(false); setErr(null);
  }, [sel, recipes]);

  const product = products?.find((p) => p.id === sel) ?? null;
  const unitOf = (id: string) => ings.find((i) => i.id === id)?.unit ?? '';
  const servings = useMemo(() => {
    const valid = rows.filter((r) => r.ingredient_id && Number(r.qty) > 0).map((r) => ({ product_id: sel!, ingredient_id: r.ingredient_id, qty_per_unit: Number(r.qty) }));
    return sel ? maxServings(valid, ings) : null;
  }, [rows, ings, sel]);

  async function save() {
    if (!sel) return;
    const clean = rows.filter((r) => r.ingredient_id);
    if (new Set(clean.map((r) => r.ingredient_id)).size !== clean.length) return setErr('كل خامة تظهر مرة واحدة بس.');
    if (clean.some((r) => !(Number(r.qty) > 0))) return setErr('كل كمية لازم تكون أكبر من صفر.');
    setBusy(true); setErr(null);
    try {
      const keep = clean.map((r) => r.ingredient_id);
      const existing = recipes.filter((r) => r.product_id === sel).map((r) => r.ingredient_id);
      const removed = existing.filter((id) => !keep.includes(id));
      if (removed.length) must(await sb.from('recipes').delete().eq('product_id', sel).in('ingredient_id', removed).select());
      if (clean.length) must(await sb.from('recipes').upsert(clean.map((r) => ({ product_id: sel, ingredient_id: r.ingredient_id, qty_per_unit: Number(r.qty) })), { onConflict: 'product_id,ingredient_id' }).select());
      await load(); setSaved(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (products === null) return <Spinner />;
  const hasRecipe = (id: string) => recipes.some((r) => r.product_id === id);

  return (
    <div className={s.layout}>
      <aside className={s.sidebar}>
        {cats.map((c) => (
          <div key={c.id} className={s.group}>
            <p className={s.groupTitle}>{c.name}</p>
            {products.filter((p) => p.category_id === c.id).map((p) => (
              <button key={p.id} onClick={() => setSel(p.id)} className={clsx(s.product, sel === p.id && s.productOn)}>
                {p.name}<span className={clsx(s.dot, hasRecipe(p.id) && s.dotHas)} title={hasRecipe(p.id) ? 'له وصفة' : 'من غير وصفة — المخزون مش بيتخصم'} />
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section>
        {!product ? <Empty title="اختار صنف" hint="النقطة الصفرا معناها صنف من غير وصفة: بيعه مش هيخصم أي مخزون." /> : (
          <div className={s.editor}>
            <div><h2 className={s.editorTitle}>{product.name}</h2><p className={s.sub}>الخامات اللي بتتستهلك في <b>1</b> وحدة.</p></div>
            {rows.map((r, i) => (
              <div key={i} className={s.row}>
                <select className={clsx("input", s.ing)} aria-label="الخامة" value={r.ingredient_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ingredient_id: e.target.value } : x)))}>
                  <option value="">اختار الخامة…</option>{ings.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input className={clsx("input", s.qty)} aria-label="الكمية" inputMode="decimal" placeholder="الكمية" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <span className={s.unit}>{unitOf(r.ingredient_id)}</span>
                <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" aria-label="احذف الخامة" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn-ghost btn-sm" onClick={() => setRows([...rows, { ingredient_id: '', qty: '' }])}><Plus size={16} /> أضف خامة</button>
            {servings !== null && <p className={s.info}>المخزون الحالي يكفي حوالي <b>{qtyFmt(servings)}</b> وحدة.</p>}
            <ErrorNote message={err} />
            {saved && <p className={s.ok}>اتحفظت الوصفة.</p>}
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} حفظ الوصفة</button>
          </div>
        )}
      </section>
    </div>
  );
}
