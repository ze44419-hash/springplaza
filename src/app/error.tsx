'use client';
import { useEffect } from 'react';

/** Last-resort screen: a crash shows a clear message instead of an endless re-render loop. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const schema = /SchemaError|not indexed|VersionError|DatabaseClosed/i.test(`${error.name} ${error.message}`);

  async function wipeLocalDb() {
    // Cached menu/orders only — anything still waiting to sync is kept unless the user explicitly resets.
    if (!confirm('هيتمسح المنيو المحفوظ على الجهاز ويتحمل من جديد. الأوردرات اللي لسه ما اتزامنتش ممكن تضيع. تكمّل؟')) return;
    indexedDB.deleteDatabase('spring-plaza-cafe');
    location.reload();
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: 'center', display: 'grid', gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800 }}>حصلت مشكلة في الصفحة</h1>
        <p style={{ margin: 0, color: 'var(--bark-500)' }}>{schema ? 'بيانات الجهاز المحفوظة محتاجة تحديث.' : 'جرّب تعيد المحاولة. لو المشكلة فضلت، حدّث الصفحة.'}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={reset}>إعادة المحاولة</button>
          <button className="btn btn-ghost" onClick={() => location.reload()}>تحديث الصفحة</button>
          {schema && <button className="btn btn-ghost" onClick={wipeLocalDb}>مسح بيانات الجهاز المحلية</button>}
        </div>
      </div>
    </div>
  );
}
