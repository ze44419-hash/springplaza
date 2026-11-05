'use client';
import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'sp-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#2E7358', dark: '#0C100E' };

const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Writes the theme to <html> (the single source of truth) and tells every subscribed component. */
function apply(next: Theme, animate: boolean) {
  const root = document.documentElement;
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-anim');
    window.setTimeout(() => root.classList.remove('theme-anim'), 350);
  }
  root.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  // follow the OS only while the user has not picked a theme explicitly
  const onSystem = () => { try { if (localStorage.getItem(THEME_KEY)) return; } catch { /* storage blocked */ } apply(mq.matches ? 'dark' : 'light', true); };
  // keep several open tabs (e.g. cashier + admin) in sync
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY && (e.newValue === 'dark' || e.newValue === 'light')) apply(e.newValue, false); };
  mq.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); mq.removeEventListener('change', onSystem); window.removeEventListener('storage', onStorage); };
}

export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, current, () => 'light');
  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: still switches for this visit */ }
    apply(t, true);
  }, []);
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), [setTheme]);
  return { theme, setTheme, toggle };
}
