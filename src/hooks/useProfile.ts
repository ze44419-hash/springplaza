'use client';
import { useEffect, useState } from 'react';
import { getMeta, setMeta } from '@/lib/db';
import { createClient } from '@/lib/supabase/client';
import type { Profile } from '@/lib/types';

/** Current user's profile. Cached in IndexedDB so screens still open with the network down. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await getMeta<Profile>('profile');
      if (cached && alive) setProfile(cached);
      try {
        const sb = createClient();
        const { data: { session } } = await sb.auth.getSession();   // reads local storage — works offline
        if (session) {
          const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
          if (data && alive) { setProfile(data as Profile); await setMeta('profile', data); }
        }
      } catch { /* offline: keep cached */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return { profile, loading };
}
