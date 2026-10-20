import type { Permission } from '@/lib/types';

/** الصلاحيات الإضافية اللي الأدمن يقدر يسندها لأي حساب (فوق صلاحيات الدور). */
export const PERMISSIONS: { key: Permission; label: string; hint: string }[] = [
  { key: 'hall', label: 'القاعة', hint: 'التقويم والحجوزات والأسعار' },
  { key: 'sessions', label: 'سيشن التصوير', hint: 'حجز وإدارة السيشن' },
  { key: 'accounting', label: 'المحاسبة والمشتل', hint: 'المصروفات والموظفين والمشتل والتقارير' },
];
