-- 016 — تحديد الفترات المحجوزة (نهاري / مسائي / ليلي) ومنع حجز نفس الفترة مرتين.
-- قبل كده الجدول كان بيخزّن «عدد الفترات» بس (periods) من غير ما نعرف أنهي فترة.
-- دلوقتي: slots text[] فيها أي مجموعة من {day, evening, night}. وعمود periods بيفضل موجود ومتزامن (= عدد الفترات)
-- علشان العقد والتقارير القديمة تفضل شغالة.
-- آمن لو اتشغّل مرتين. شغّله بعد 015.

-- 1) العمود + تعبئة الحجوزات القديمة
alter table public.hall_bookings add column if not exists slots text[];

-- الحجوزات الفعّالة في نفس اليوم بتتوزّع ورا بعض (الأقدم أول) علشان ما يحصلش تداخل في البيانات القديمة.
with ranked as (
  select id, periods,
         coalesce(sum(periods) over (partition by event_date order by created_at, id
                                     rows between unbounded preceding and 1 preceding), 0)::int as off
    from public.hall_bookings
   where status <> 'cancelled' and slots is null
)
update public.hall_bookings b
   set slots = (select array_agg(t.x order by t.o)
                  from unnest(array['day', 'evening', 'night']) with ordinality as t(x, o)
                 where t.o > least(r.off, 2) and t.o <= least(r.off, 2) + r.periods)
  from ranked r
 where b.id = r.id;

update public.hall_bookings
   set slots = case periods when 3 then array['day', 'evening', 'night'] when 2 then array['day', 'evening'] else array['day'] end
 where slots is null;

alter table public.hall_bookings alter column slots set default array['day'];
alter table public.hall_bookings alter column slots set not null;
alter table public.hall_bookings drop constraint if exists hall_bookings_slots_valid;
alter table public.hall_bookings add constraint hall_bookings_slots_valid
  check (slots <@ array['day', 'evening', 'night']::text[] and cardinality(slots) between 1 and 3);
create index if not exists hall_bookings_slots_idx on public.hall_bookings using gin (slots);

-- 2) hall_save_booking: نفس منطق 014 (بعد تعديل 015) + الفترات + منع التداخل
create or replace function public.hall_save_booking(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_date date := nullif(p->>'event_date', '')::date;
  v_old public.hall_bookings; v_q jsonb; v_paid numeric(12,2); l jsonb; v_pos smallint := 0;
  v_slots text[];
begin
  if not public.is_hall_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_date is null then raise exception 'event date required'; end if;
  if nullif(btrim(coalesce(p->>'customer_name', '')), '') is null then raise exception 'customer name required'; end if;

  if v_id is not null then
    select * into v_old from hall_bookings where id = v_id for update;
    if not found then raise exception 'booking not found'; end if;
    if v_old.status in ('completed', 'cancelled') then raise exception 'booking is closed'; end if;
  end if;

  -- الفترات المطلوبة (لو الـ client قديم ومبعتش slots: نحافظ على الفترات الحالية أو نوزّع حسب periods)
  if p ? 'slots' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_slots
      from jsonb_array_elements_text(case when jsonb_typeof(p->'slots') = 'array' then p->'slots' else '[]'::jsonb end) as x
     where x in ('day', 'evening', 'night');
  elsif v_id is not null then
    v_slots := v_old.slots;
  else
    v_slots := case least(greatest(coalesce(nullif(p->>'periods', '')::int, 1), 1), 3)
                 when 3 then array['day', 'evening', 'night'] when 2 then array['day', 'evening'] else array['day'] end;
  end if;
  if cardinality(v_slots) = 0 then raise exception 'slots required'; end if;

  -- قفل على اليوم نفسه: لو اتنين حفظوا في نفس اللحظة، التاني هيستنى ويلاقي الفترة اتحجزت.
  perform pg_advisory_xact_lock(hashtext('hall_slots:' || v_date::text));
  if exists (select 1 from hall_bookings
              where event_date = v_date and status <> 'cancelled' and id is distinct from v_id and slots && v_slots) then
    raise exception 'slot already booked';
  end if;

  v_q := public._hall_compute(p, v_id);
  v_paid := greatest(coalesce((p->>'paid_amount')::numeric, 0), 0);
  if v_paid > (v_q->>'total')::numeric then raise exception 'paid exceeds total'; end if;

  if v_id is null then
    insert into hall_bookings (slots, periods, event_date, customer_name, customer_phone, event_type, guests, rate_id, rate_name, hall_price,
                               dishes_total, extras_total, discount, total, paid_amount, notes, created_by)
    values (v_slots, cardinality(v_slots), v_date, btrim(p->>'customer_name'), nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
            nullif(btrim(coalesce(p->>'event_type', '')), ''), nullif(p->>'guests', '')::int,
            (v_q->>'rate_id')::uuid, v_q->>'rate_name', (v_q->>'hall_price')::numeric,
            (v_q->>'dishes_total')::numeric, (v_q->>'extras_total')::numeric, (v_q->>'discount')::numeric,
            (v_q->>'total')::numeric, v_paid, nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
    returning id into v_id;
  else
    update hall_bookings set
      slots = v_slots, periods = cardinality(v_slots), event_date = v_date, customer_name = btrim(p->>'customer_name'),
      customer_phone = nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
      event_type = nullif(btrim(coalesce(p->>'event_type', '')), ''), guests = nullif(p->>'guests', '')::int,
      rate_id = (v_q->>'rate_id')::uuid, rate_name = v_q->>'rate_name', hall_price = (v_q->>'hall_price')::numeric,
      dishes_total = (v_q->>'dishes_total')::numeric, extras_total = (v_q->>'extras_total')::numeric,
      discount = (v_q->>'discount')::numeric, total = (v_q->>'total')::numeric, paid_amount = v_paid,
      notes = nullif(btrim(coalesce(p->>'notes', '')), '')
    where id = v_id;
    delete from hall_booking_items where booking_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(v_q->'lines') loop
    v_pos := v_pos + 1;
    insert into hall_booking_items (booking_id, service_id, kind, name, unit_price, qty, position)
    values (v_id, (l->>'service_id')::uuid, (l->>'kind')::hall_service_kind, l->>'name',
            (l->>'unit_price')::numeric, (l->>'qty')::int, v_pos);
  end loop;
  return v_id;
end $$;
