# تحديث 017 — أداء

شغّل `supabase/migrations/017_performance.sql` بعد 016 (آمن لو اتشغّل مرتين).

## اتعمل
- `orders.ts` → `refreshOrders`: transaction واحدة + `bulkPut` بدل ~800 await.
- `sync.ts`: pull واحد لكل أوردر بعد ما الطابور يخلص بدل pull بعد كل عملية.
- 017 SQL: فهرس `hall_bookings(event_date)` الجزئي، حذف فهرس GIN على slots، فهرس `stock_withdrawal_items(ingredient_id)`، و`_restore_order_stock` مجمّعة لكل خامة.
- `accountingExport.ts`: `xlsx-js-style` بيتحمّل وقت الضغط على التصدير بس.
- `shift.ts`: `summarizeShift` بمرور واحد.
- `useCatalog.ts`: `orderBy('sort_order')` على الفهارس.
- `useOrdersRealtime.ts`: الويتر بيشترك في أوردراته بس (`waiter_id` filter).
- `hall/page.tsx`: debounce 300ms لإعادة تحميل الحجوزات.
- `sw.js`: إصدار للكاش + تنظيف القديم + حد 100 صورة.
- `layout.tsx`: شيل `maximumScale`.

## ما اتلمسش (قرار منك)
middleware `getUser()`، `select('*')`، تصغير الصور 240px، الخطوط، pagination للمستحقات/الجلسات، قنوات realtime المشتركة، admin/users، `<TimeAgo>`.
