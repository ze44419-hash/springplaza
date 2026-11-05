-- 015 — السماح بأكتر من حجز في نفس اليوم (قبل كده: حجز واحد بس لكل يوم).
-- 1) شيل الـ unique index. 2) شيل فحص "date already booked" من hall_save_booking (آخر نسخة في 014)
--    من غير ما نعيد كتابة الدالة كلها: بنقرأ تعريفها الحالي ونعدّل الفحصين ونعيد تنفيذه.
-- آمن لو اتشغّل مرتين.

drop index if exists public.hall_one_booking_per_day;

do $$
declare
  d  text;
  d2 text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hall_save_booking';
  if d is null then raise exception 'hall_save_booking not found'; end if;

  -- (أ) فحص الوجود قبل الحفظ
  d2 := regexp_replace(d,
    'if exists \(select 1 from hall_bookings where event_date = v_date and status <> ''cancelled'' and id is distinct from v_id\) then\s+raise exception ''date already booked'';\s+end if;',
    '', 'g');
  -- (ب) معالج unique_violation كان بيحوّل أي تعارض لرسالة "اليوم محجوز" — نسيبه يرمي الخطأ الأصلي
  d2 := regexp_replace(d2,
    'exception when unique_violation then\s+raise exception ''date already booked'';',
    'exception when unique_violation then raise;', 'g');

  if d2 = d then
    if position('date already booked' in d) > 0 then
      raise exception 'could not patch hall_save_booking — فحص اليوم لسه موجود، عدّله يدويًا';
    end if;
  else
    execute d2;
  end if;
end $$;
