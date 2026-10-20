'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { addDays, startOfDay, toInputDate } from '@/lib/util';
import s from './PeriodPicker.module.css';

export interface Period { from: string; to: string }   // YYYY-MM-DD, both ends inclusive
type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'النهارده'], ['week', 'الأسبوع ده'], ['month', 'الشهر ده'], ['lastMonth', 'الشهر اللي فات'], ['year', 'السنة دي'], ['custom', 'فترة مخصصة']];

export function rangeFor(p: Preset, custom: Period): Period {
  const today = startOfDay(new Date());
  switch (p) {
    case 'today': return { from: toInputDate(today), to: toInputDate(today) };
    case 'week': { const sat = addDays(today, -((today.getDay() + 1) % 7)); return { from: toInputDate(sat), to: toInputDate(today) }; }
    case 'month': return { from: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toInputDate(today) };
    case 'lastMonth': return { from: toInputDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: toInputDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case 'year': return { from: toInputDate(new Date(today.getFullYear(), 0, 1)), to: toInputDate(today) };
    default: return custom;
  }
}

/** Period selector for the accounting screens. Calls `onChange` with an inclusive date range (only when it is valid). */
export default function PeriodPicker({ onChange, initial = 'month' }: { onChange: (p: Period) => void; initial?: Preset }) {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState<Period>({ from: toInputDate(new Date()), to: toInputDate(new Date()) });
  const range = rangeFor(preset, custom);
  const invalid = !range.from || !range.to || range.from > range.to;

  useEffect(() => { if (!invalid) onChange(range); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={s.bar}>
      {PRESETS.map(([k, l]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => setPreset(k)} className={clsx(s.preset, preset === k && s.on)}>{l}</button>)}
      {preset === 'custom' && (
        <span className={s.dates}>
          <input aria-label="من" type="date" className={`input ${s.date}`} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input aria-label="إلى" type="date" className={`input ${s.date}`} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </span>
      )}
      {invalid && <span className={s.bad} role="alert">اختار فترة صحيحة.</span>}
    </div>
  );
}
