'use client';
import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { discardFailed, retryFailed } from '@/lib/sync';

/** Connectivity + sync-queue indicator shown in every header. */
export default function StatusPill() {
  const { online, pending, failed } = useSyncStatus();
  return (
    <div className="flex items-center gap-2">
      {failed > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/50 px-3 py-1 text-xs font-bold text-red-700 dark:text-red-300">
          {failed} فشلت
          <button className="underline" onClick={() => void retryFailed()}>إعادة</button>
          <button className="underline" onClick={() => { if (confirm('تتجاهل التغييرات اللي فشلت؟ مش هتتبعت.')) void discardFailed(); }}>تجاهل</button>
        </span>
      )}
      <span className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold', online ? 'bg-fern-light text-fern-ink' : 'bg-sun-light text-sun-ink')}
        title={online ? 'متصل' : 'مفيش إنترنت — التغييرات بتتحفظ على الجهاز'}>
        {!online ? <CloudOff size={14} /> : pending > 0 ? <RefreshCw size={14} className="animate-spin" /> : <Wifi size={14} />}
        {!online ? 'بدون إنترنت' : pending > 0 ? 'جاري المزامنة' : 'متصل'}
        {pending > 0 && <span className="rounded-full bg-surface/70 px-1.5">{pending}</span>}
      </span>
    </div>
  );
}
