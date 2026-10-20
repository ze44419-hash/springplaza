'use client';
import { useSyncExternalStore, type ReactNode } from 'react';

const noop = () => () => {};
/**
 * يمنع أخطاء Hydration في الشاشات المحمية (تواريخ/مناطق زمنية/IndexedDB بتختلف بين السيرفر والمتصفح).
 * بدون render إضافي: السيرفر والـ hydration الأول بيرجّعوا fallback، وبعدها المتصفح بيعرض المحتوى مرة واحدة.
 */
export default function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return <>{mounted ? children : fallback}</>;
}
