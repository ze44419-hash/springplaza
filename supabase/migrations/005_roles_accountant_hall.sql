-- =====================================================================
-- 005 — دورين جدد: محاسب (accountant) + مسؤول القاعة (hall_manager)
-- شغّل الملف ده لوحده الأول، وبعد ما ينجح شغّل 006 في تشغيل منفصل.
-- (PostgreSQL ما بيسمحش تستخدم قيمة enum جديدة في نفس المعاملة اللي أضافتها.)
-- =====================================================================
alter type public.app_role add value if not exists 'accountant';
alter type public.app_role add value if not exists 'hall_manager';
