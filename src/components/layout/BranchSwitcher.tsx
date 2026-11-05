'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Branch, Profile } from '@/lib/types';

/** تبديل الفرع الحالي (كافيه/قاعة) للأدمن والمحاسب والمدير اللي ليهم أكتر من فرع. الأوردرات/الحجوزات الجديدة بتتسجل عليه. */
export default function BranchSwitcher({ profile }: { profile: Profile }) {
  const [list, setList] = useState<Branch[]>([]);
  const [cur, setCur] = useState<Record<string, string>>({});
  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const [b, c, h] = await Promise.all([sb.from('my_branches').select('*').order('name'), sb.rpc('my_branch_id', { p_type: 'cafe' }), sb.rpc('my_branch_id', { p_type: 'hall' })]);
      setList((b.data ?? []) as Branch[]); setCur({ cafe: String(c.data ?? ''), hall: String(h.data ?? '') });
    })();
  }, [profile.id]);
  const pick = async (id: string) => { await createClient().rpc('set_active_branch', { p_branch: id }); window.location.reload(); };
  const sel = (type: 'cafe' | 'hall', label: string) => {
    const opts = list.filter((b) => b.type === type);
    if (opts.length < 2) return null;
    return (
      <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.85rem', fontWeight: 600 }}>{label}
        <select className="input" style={{ minHeight: 36, padding: '4px 8px' }} value={cur[type]} onChange={(e) => pick(e.target.value)}>
          {opts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>);
  };
  const a = sel('cafe', 'الكافيه'), b = sel('hall', 'القاعة');
  if (!a && !b) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 16px 0', maxWidth: 1152, margin: '0 auto' }}>{a}{b}</div>;
}
