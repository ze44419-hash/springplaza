import type { Permission, Role } from '@/lib/types';

/** Landing screen of every role. */
export const HOME: Record<Role, string> = {
  admin: '/admin', cashier: '/cashier', waiter: '/waiter', accountant: '/accounting',
  hall_manager: '/hall', cafe_manager: '/branch', session_manager: '/sessions',
};

/**
 * Single source of truth for "who may open which area" — used by the middleware (server-side guard)
 * and by the navigation bars (so people never see links they cannot open).
 *
 * - `roles`: roles allowed in. Admin is listed explicitly everywhere he is allowed.
 * - `perm` : optional extra permission (table user_permissions) that lets other roles in as well.
 * - Rules are matched top-down by path prefix: put the MOST SPECIFIC prefix first.
 *
 * Money screens (/accounting/*: treasury, receivables, suppliers, purchases, inventory, assets, reports…) are admin + accountant ONLY
 * — no extra permission can open them. The hall manager is limited to bookings + contract printing.
 */
export interface AccessRule { prefix: string; roles: readonly Role[]; perm?: Permission }
export const ACCESS_RULES: readonly AccessRule[] = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/hall/pricing', roles: ['admin'] },
  { prefix: '/hall', roles: ['admin', 'hall_manager'], perm: 'hall' },
  { prefix: '/sessions', roles: ['admin', 'accountant', 'hall_manager', 'session_manager'], perm: 'sessions' },
  { prefix: '/branch', roles: ['admin', 'cafe_manager'] },
  { prefix: '/accounting', roles: ['admin', 'accountant'] },
  { prefix: '/cashier', roles: ['admin', 'cashier'] },
  { prefix: '/waiter', roles: ['admin', 'waiter'] },
];

export const ruleFor = (path: string) => ACCESS_RULES.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));

export function canAccess(path: string, role: Role, perms: readonly string[] = []): boolean {
  const rule = ruleFor(path);
  if (!rule) return true;
  return rule.roles.includes(role) || (!!rule.perm && perms.includes(rule.perm));
}
