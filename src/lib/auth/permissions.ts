import type { Permission } from '@/lib/types';

/** الصلاحيات الإضافية اللي الأدمن يقدر يسندها لأي حساب (فوق صلاحيات الدور).
 *  شاشات المحاسبة والخزنة مقفولة على الأدمن والمحاسب فقط (lib/auth/access.ts) فمفيش صلاحية إضافية ليها. */
export const PERMISSIONS: { key: Permission; label: string; hint: string }[] = [
  { key: 'hall', label: 'القاعة', hint: 'التقويم والحجوزات والأسعار' },
  { key: 'sessions', label: 'سيشن التصوير', hint: 'حجز وإدارة السيشن' },
];
