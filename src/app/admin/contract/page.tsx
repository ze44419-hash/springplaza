'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorNote, Spinner } from '@/components/ui/kit';
import { useNotify } from '@/components/layout/Providers';
import { loadSettings, saveSettings } from '@/lib/services/finance';
import { friendly } from '@/lib/helpers/util';

/** إعدادات عقد القاعة (أدمن فقط): العنوان + اسم الجهة + البنود الافتراضية + تذييل. بند في كل سطر. */
export default function ContractSettings() {
  const notify = useNotify();
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadSettings().then((d) => setV({ contract_title: '', contract_org: '', contract_terms: '', contract_footer: '', ...d })).catch((e) => { setErr(friendly(e.message)); setV({}); }); }, []);
  if (!v) return <Spinner />;
  const set = (k: string, x: string) => setV({ ...v, [k]: x });

  async function save() {
    setBusy(true); setErr(null);
    try { await saveSettings({ contract_title: v!.contract_title ?? '', contract_org: v!.contract_org ?? '', contract_terms: v!.contract_terms ?? '', contract_footer: v!.contract_footer ?? '' }); notify({ title: 'اتحفظت بنود العقد', tone: 'success' }); }
    catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800 }}>بنود وشروط عقد القاعة</h1>
      <div><label className="label" htmlFor="c-t">عنوان العقد</label><input id="c-t" className="input" value={v.contract_title ?? ''} onChange={(e) => set('contract_title', e.target.value)} /></div>
      <div><label className="label" htmlFor="c-o">اسم الجهة (يظهر أعلى العقد)</label><input id="c-o" className="input" value={v.contract_org ?? ''} onChange={(e) => set('contract_org', e.target.value)} placeholder="سبرينج بلازا" /></div>
      <div><label className="label" htmlFor="c-b">البنود والشروط الافتراضية (بند في كل سطر)</label><textarea id="c-b" className="input" rows={12} value={v.contract_terms ?? ''} onChange={(e) => set('contract_terms', e.target.value)} /></div>
      <div><label className="label" htmlFor="c-f">تذييل (عنوان / تليفون الإدارة)</label><input id="c-f" className="input" value={v.contract_footer ?? ''} onChange={(e) => set('contract_footer', e.target.value)} /></div>
      <ErrorNote message={err} />
      <button className="btn-primary" disabled={busy} onClick={save}>{busy && <Loader2 className="animate-spin" size={18} />} حفظ</button>
    </div>
  );
}
