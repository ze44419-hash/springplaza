import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { HOME, canAccess } from '@/lib/auth/access';
import type { Role } from '@/lib/types';


/** Session refresh + role-based route guard (rules: lib/auth/access.ts). Each role lands on its own home screen. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const path = request.nextUrl.pathname;
  const go = (to: string) => NextResponse.redirect(new URL(to, request.url));
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return path.startsWith('/login') ? response : go('/login');

  // FAST PATH: role + active flag live in the auth user's app_metadata (written by /api/admin/users), so no extra
  // database round-trip on every navigation. Accounts created before that (e.g. the bootstrap admin) fall back to one query.
  const meta = (user.app_metadata ?? {}) as { role?: string; active?: boolean; perms?: string[] };
  const perms = Array.isArray(meta.perms) ? meta.perms : [];   // extra permissions granted by the admin (written by /api/admin/users)
  let role = meta.role as Role | undefined;
  let active = meta.active;
  if (!role || !(role in HOME) || active === undefined) {
    const { data: profile } = await supabase.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
    role = profile?.role as Role | undefined; active = profile?.is_active;
  }
  if (!role || !active) {
    await supabase.auth.signOut();
    return go('/login?error=disabled');
  }

  if (path === '/' || path.startsWith('/login')) return go(HOME[role]);
  if (!canAccess(path, role, perms)) return go(HOME[role]);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|api/).*)'],
};
