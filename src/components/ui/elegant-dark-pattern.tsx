import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import s from './elegant-dark-pattern.module.css';

interface DarkGradientBgProps {
  children?: ReactNode;
  className?: string;
}

/** Horizontal fade masks that give each streak its own rhythm (values from the original design). */
const STREAK_MASKS = [
  'linear-gradient(90deg, transparent 0%, #000 20%, transparent 36%, #000 55%, rgba(0,0,0,.13) 67%, #000 78%, transparent 97%)',
  'linear-gradient(90deg, transparent 11%, #000 25%, rgba(0,0,0,.55) 41%, rgba(0,0,0,.13) 67%, #000 78%, transparent 97%)',
  'linear-gradient(90deg, transparent 9%, #000 20%, rgba(0,0,0,.55) 28%, rgba(0,0,0,.424) 40%, #000 48%, rgba(0,0,0,.267) 54%, rgba(0,0,0,.13) 78%, #000 88%, transparent 97%)',
  'linear-gradient(90deg, transparent 0%, #000 17%, rgba(0,0,0,.55) 26%, #000 35%, transparent 47%, rgba(0,0,0,.13) 69%, #000 79%, transparent 97%)',
  'linear-gradient(90deg, transparent 0%, #000 20%, rgba(0,0,0,.55) 27%, #000 42%, transparent 48%, rgba(0,0,0,.13) 67%, #000 74%, #000 82%, rgba(0,0,0,.47) 88%, transparent 97%)',
];

/**
 * Theme-aware gradient background (shadcn location: components/ui/elegant-dark-pattern.tsx).
 * Server-safe (no hooks). Colours follow <html data-theme>.
 */
export function DarkGradientBg({ children, className }: DarkGradientBgProps) {
  return (
    <div className={cn(s.root, className)}>
      <div className={cn(s.layer, s.base)} aria-hidden="true">
        {STREAK_MASKS.map((m, i) => <div key={i} className={s.streak} style={{ ['--m' as string]: m } as CSSProperties} />)}
      </div>
      <div className={cn(s.layer, s.grain)} aria-hidden="true" />
      <div className={cn(s.layer, s.dots)} aria-hidden="true" />
      <div className={cn(s.layer, s.glow)} aria-hidden="true" />
      <div className={s.content}>{children}</div>
    </div>
  );
}

export default DarkGradientBg;
