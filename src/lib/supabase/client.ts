import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser singleton — one auth listener and one realtime socket for the whole app. */
export function createClient() {
  if (!client) {
    client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }
  return client;
}
