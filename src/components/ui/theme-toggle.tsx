'use client';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import s from './theme-toggle.module.css';

/**
 * Night-mode switch (shadcn location: components/ui/theme-toggle.tsx).
 * variant "solid" = app header button, "glass" = translucent button for the login screen.
 */
export function ThemeToggle({ variant = 'solid', className }: { variant?: 'solid' | 'glass'; className?: string }) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'تفعيل المود النهاري' : 'تفعيل المود الليلي';
  return (
    <button type="button" onClick={toggle} className={cn(s.btn, variant === 'glass' ? s.glass : s.solid, className)} aria-label={label} title={label}>
      <Sun size={21} className={s.sun} aria-hidden="true" />
      <Moon size={20} className={s.moon} aria-hidden="true" />
    </button>
  );
}

export default ThemeToggle;
