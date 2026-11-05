import { NextResponse } from 'next/server';
import { createAdminClient, createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Verifies the caller is an active admin (via their session cookie). */
async function requireAdmin() {
  const sb = createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
  return p?.role === 'admin' && p.is_active ? user : null;
}

const ROLES = ['admin', 'cashier', 'waiter', 'accountant', 'hall_manager', 'cafe_manager', 'session_manager'];
const PERMS = ['hall', 'sessions', 'accounting'];

/** Replaces the user's extra permissions (table + auth metadata read by the middleware). */
async function setPermissions(admin: ReturnType<typeof createAdminClient>, id: string, perms: string[]) {
  const clean = Array.from(new Set(perms.filter((x) => PERMS.includes(x))));
  const del = await admin.from('user_permissions').delete().eq('user_id', id);
  if (del.error) return del.error.message;
  if (clean.length) {
    const ins = await admin.from('user_permissions').insert(clean.map((permission) => ({ user_id: id, permission })));
    if (ins.error) return ins.error.message;
  }
  return null;
}
async function currentPerms(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin.from('user_permissions').select('permission').eq('user_id', id);
  return (data ?? []).map((r: { permission: string }) => r.permission);
}

/** POST { email, password, full_name, role } → creates the auth user + profile. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'غير مسموح' }, { status: 403 });
  const { email, password, full_name, role, permissions } = await req.json().catch(() => ({}));
  if (!email || !full_name || !ROLES.includes(role)) return NextResponse.json({ error: 'الاسم والإيميل والدور مطلوبين.' }, { status: 400 });
  if (typeof password !== 'string' || password.length < 8) return NextResponse.json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل.' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) return NextResponse.json({ error: error?.message ?? 'تعذّر إنشاء الحساب' }, { status: 400 });

  const { error: pErr } = await admin.from('profiles').insert({ id: data.user.id, full_name, role });
  let perms: string[] = [];
  if (!pErr && Array.isArray(permissions) && permissions.length) { await setPermissions(admin, data.user.id, permissions); perms = await currentPerms(admin, data.user.id); }
  if (!pErr) await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role, active: true, perms } }); // read by middleware (no DB hit)
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id); // roll back so we never leave an account without a profile
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  return NextResponse.json({ id: data.user.id });
}

/**
 * PATCH { id, password? , role? , is_active? }
 * Role / active changes are written to the profile AND to the auth user's app_metadata (+ a sign-in ban when disabled),
 * so the middleware can trust the session without querying the database.
 */
export async function PATCH(req: Request) {
  const caller = await requireAdmin();
  if (!caller) return NextResponse.json({ error: 'غير مسموح' }, { status: 403 });
  const { id, password, role, is_active, permissions } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'بيانات ناقصة.' }, { status: 400 });
  const admin = createAdminClient();

  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 8) return NextResponse.json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل.' }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (role !== undefined || is_active !== undefined) {
    if (role !== undefined && !ROLES.includes(role)) return NextResponse.json({ error: 'دور غير صحيح.' }, { status: 400 });
    if (id === caller.id) return NextResponse.json({ error: 'مينفعش تغيّر دورك أو تعطّل حسابك بنفسك.' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (role !== undefined) patch.role = role;
    if (is_active !== undefined) patch.is_active = !!is_active;
    const { data: prof, error } = await admin.from('profiles').update(patch).eq('id', id).select('role,is_active').single();
    if (error || !prof) return NextResponse.json({ error: error?.message ?? 'الحساب مش موجود' }, { status: 400 });
    const { error: aErr } = await admin.auth.admin.updateUserById(id, {
      app_metadata: { role: prof.role, active: prof.is_active, perms: await currentPerms(admin, id) },
      ban_duration: prof.is_active ? 'none' : '876000h',
    });
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 400 });
  }

  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) return NextResponse.json({ error: 'صلاحيات غير صحيحة.' }, { status: 400 });
    const e = await setPermissions(admin, id, permissions);
    if (e) return NextResponse.json({ error: e }, { status: 400 });
    const { data: prof } = await admin.from('profiles').select('role,is_active').eq('id', id).single();
    if (prof) await admin.auth.admin.updateUserById(id, { app_metadata: { role: prof.role, active: prof.is_active, perms: await currentPerms(admin, id) } });
  }
  return NextResponse.json({ ok: true });
}
