# تحديث 013 — عامل مشتل • سيشن التصوير • الصلاحيات الديناميكية

## ترتيب التشغيل في Supabase (SQL Editor) — كل ملف في تشغيل منفصل
1. `supabase/migrations/013a_session_manager_role.sql`
2. `supabase/migrations/013b_sessions_permissions_nursery_worker.sql`

## الجديد
- **عامل مشتل**: عمود `staff.job_title` — اختياره بيعيّن الموظف للمشتل تلقائيًا، وراتبه بيروح لحسابات المشتل.
- **سيشن التصوير**: جدول `photo_sessions` + شاشة `/sessions` (التاريخ، الوقت، السعر، الدفعة المقدمة، الحالة).
- **الصلاحيات**: جدول `user_permissions` (مفاتيح: hall • sessions • accounting) + الدالتين `has_perm()` و`my_perms()`.
  الأدمن يسند الصلاحيات من «الحسابات ← الصلاحيات»، وبتتطبّق في قاعدة البيانات (RLS) وفي الـ middleware.
- دور جديد: `session_manager` (مسؤول السيشن).

بعد تغيير صلاحيات حساب، لازم المستخدم يسجّل خروج ودخول عشان الـ middleware يقرا الصلاحيات الجديدة.
