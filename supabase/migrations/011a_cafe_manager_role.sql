-- 011a — دور جديد: مدير كافيهات (cafe_manager). شغّله لوحده الأول، وبعده 011b في تشغيل منفصل.
-- (عام vs محدد: مدير بدون تعيينات = عام على كل فروع نوعه، ومعاه تعيينات = محصور على فروعه فقط — جدول user_assignments)
alter type public.app_role add value if not exists 'cafe_manager';
