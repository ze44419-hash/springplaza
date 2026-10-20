'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, ErrorNote, Modal, Spinner } from './kit';
import { createClient } from '@/lib/supabase/client';
import { must, shrinkImage } from '@/lib/util';
import s from './Crud.module.css';
import { uuid } from '@/lib/format';

export interface FieldDef {
  key: string; label: string; type: 'text' | 'number' | 'select' | 'checkbox' | 'image';
  options?: { value: string; label: string }[]; step?: string; required?: boolean; hint?: string; createOnly?: boolean;
}
export interface Column<T> { label: string; render: (row: T) => ReactNode }

/**
 * Generic admin list + add/edit/delete dialog for a Supabase table (admin RLS applies).
 * Used for products, categories, modifiers, tables and ingredients.
 */
export default function Crud<T extends { id: string }>(p: {
  table: string; title: string; noun: string; fields: FieldDef[]; columns: Column<T>[];
  defaults: Record<string, unknown>; orderBy: string; select?: string;
  rowActions?: (row: T, reload: () => void) => ReactNode; onChanged?: () => void; canDelete?: boolean;
  /** Equality filter applied when loading AND merged into new rows (e.g. { kind: 'dish' } to split one table into sections). */
  filter?: Record<string, string>;
}) {
  const sb = createClient();
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; values: Record<string, any> } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      let q: any = sb.from(p.table).select(p.select ?? '*');
      for (const [k, v] of Object.entries(p.filter ?? {})) q = q.eq(k, v);
      setRows(must(await q.order(p.orderBy)) as unknown as T[]); setError(null);
    }
    catch (e: any) { setError(e.message); setRows([]); }
  }, [p.table, p.orderBy, p.select, JSON.stringify(p.filter ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of p.fields) {
        if (f.createOnly && editing.id) continue;
        let v = editing.values[f.key];
        if (f.type === 'number') v = v === '' || v == null ? null : Number(v);
        if (f.type === 'text' || f.type === 'select') v = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
        if (f.required && (v === null || v === undefined || Number.isNaN(v))) throw new Error(`${f.label} مطلوب.`);
        payload[f.key] = v;
      }
      if (editing.id) must(await sb.from(p.table).update(payload).eq('id', editing.id).select());
      else must(await sb.from(p.table).insert({ ...payload, ...(p.filter ?? {}) }).select());
      setEditing(null); await load(); p.onChanged?.();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(row: T) {
    if (!confirm(`تحذف ${p.noun}؟`)) return;
    try { must(await sb.from(p.table).delete().eq('id', row.id).select()); await load(); p.onChanged?.(); }
    catch (e: any) { setError(e.message); }
  }

  async function upload(file: File, key: string) {
    setBusy(true); setError(null);
    try {
      const blob = await shrinkImage(file);
      const path = `${uuid()}.webp`;
      const { error: err } = await sb.storage.from('product-images').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' });
      if (err) throw new Error(err.message);
      const { data } = sb.storage.from('product-images').getPublicUrl(path);
      setEditing((e) => e && { ...e, values: { ...e.values, [key]: data.publicUrl } });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section>
      <div className={s.head}>
        <h2 className={s.title}>{p.title}</h2>
        <button className="btn-primary btn-sm" onClick={() => { setError(null); setEditing({ id: null, values: { ...p.defaults } }); }}><Plus size={18} /> إضافة {p.noun}</button>
      </div>
      {!editing && <div className={s.err}><ErrorNote message={error} /></div>}
      {rows === null ? <Spinner /> : rows.length === 0 ? <Empty title={`مفيش ${p.noun} لسه`} hint={`ضيف أول ${p.noun}.`} /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr>{p.columns.map((c) => <th key={c.label} className="th">{c.label}</th>)}<th className="th" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {p.columns.map((c) => <td key={c.label} className="td">{c.render(r)}</td>)}
                  <td className="td"><div className={s.cellActions}>
                    {p.rowActions?.(r, load)}
                    <button className="btn-ghost btn-sm" aria-label={`تعديل ${p.noun}`} onClick={() => { setError(null); setEditing({ id: r.id, values: { ...(r as any) } }); }}><Pencil size={16} /></button>
                    {p.canDelete !== false && <button className="btn-ghost btn-sm text-red-700 dark:text-red-300" aria-label={`حذف ${p.noun}`} onClick={() => remove(r)}><Trash2 size={16} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? 'تعديل' : 'إضافة'} ${p.noun}`}>
        {editing && (
          <div className={s.form}>
            {p.fields.filter((f) => !(f.createOnly && editing.id)).map((f) => {
              const v = editing.values[f.key];
              const set = (val: unknown) => setEditing({ ...editing, values: { ...editing.values, [f.key]: val } });
              const id = `f-${f.key}`;
              if (f.type === 'checkbox') return (
                <label key={f.key} className={s.check}><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} /> {f.label}</label>
              );
              if (f.type === 'image') return (
                <div key={f.key}><span className="label">{f.label}</span>
                  <div className={s.imageRow}>
                    {v ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={v} alt="" className={s.imageThumb} /> : <span className={s.imageEmpty}><ImagePlus /></span>}
                    <label className={`btn-ghost btn-sm ${s.upload}`}>{busy ? <Loader2 className="animate-spin" size={16} /> : <ImagePlus size={16} />} رفع
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], f.key)} /></label>
                    {v && <button className="btn-ghost btn-sm" onClick={() => set(null)}>إزالة</button>}
                  </div></div>
              );
              return (
                <div key={f.key}><label className="label" htmlFor={id}>{f.label}</label>
                  {f.type === 'select'
                    ? <select id={id} className="input" value={v ?? ''} onChange={(e) => set(e.target.value)}>{!f.required && <option value="">—</option>}{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : <input id={id} className="input" type={f.type === 'number' ? 'number' : 'text'} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} inputMode={f.type === 'number' ? 'decimal' : undefined} value={v ?? ''} onChange={(e) => set(e.target.value)} />}
                  {f.hint && <p className={s.hint}>{f.hint}</p>}
                </div>
              );
            })}
            <ErrorNote message={error} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ {p.noun}</button>
          </div>
        )}
      </Modal>
    </section>
  );
}
