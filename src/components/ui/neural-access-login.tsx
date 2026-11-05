'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import s from './mercury.module.css';

/** Fixed layout → identical on server and client (no random values, so no hydration mismatch). */
const BLOBS = [
  { size: 260, left: 14, top: 18, delay: -3, dur: 22, k: 12 },
  { size: 190, left: 72, top: 12, delay: -11, dur: 27, k: 20 },
  { size: 320, left: 58, top: 62, delay: -6, dur: 30, k: 8 },
  { size: 170, left: 20, top: 70, delay: -15, dur: 19, k: 26 },
  { size: 230, left: 84, top: 78, delay: -9, dur: 25, k: 16 },
];

/**
 * Mercury liquid backdrop. Wrap any content (here: the login form) as children.
 * shadcn location: components/ui/neural-access-login.tsx — needs `cn` from lib/utils only if you extend it.
 */
export function MercuryStage({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {      // one style write per frame, transform-only
        stage.current?.style.setProperty('--mx', String(e.clientX / window.innerWidth));
        stage.current?.style.setProperty('--my', String(e.clientY / window.innerHeight));
      });
    };
    const vis = () => wrap.current?.classList.toggle(s.paused, document.hidden);
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('visibilitychange', vis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', vis); };
  }, []);

  return (
    <div className={s.wrapper} ref={wrap}>
      <svg className={s.svgHidden} aria-hidden="true">
        <defs>
          <filter id="spring-gooey">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <div className={s.stage} ref={stage} aria-hidden="true">
        {BLOBS.map((b, i) => (
          <div key={i} className={s.drift} style={{ width: b.size, height: b.size, left: `${b.left}%`, top: `${b.top}%`, ['--k' as string]: b.k }}>
            <div className={s.blob} style={{ animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }} />
          </div>
        ))}
      </div>
      <div className={s.content}>{children}</div>
    </div>
  );
}

export default MercuryStage;
