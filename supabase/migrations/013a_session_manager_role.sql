-- 013a — دور جديد: مسؤول السيشن (session_manager). شغّله لوحده الأول، وبعده 013b في تشغيل منفصل.
alter type public.app_role add value if not exists 'session_manager';
