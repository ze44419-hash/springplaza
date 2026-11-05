-- =====================================================================
-- 006 — إدارة القاعة والحجوزات + المحاسبة وتوزيع أرباح الشركاء
-- شغّله في Supabase → SQL Editor بعد 001…005. آمن على بيانات موجودة (لا يعدّل أي جدول قديم).
--
-- الصلاحيات:
--   admin        : كل حاجة (القاعة + المحاسبة + الكافيه)
--   hall_manager : القاعة بالكامل (حجوزات، أسعار، أطباق، خدمات) — مفيش وصول للمحاسبة ولا لأوردرات الكافيه
--   accountant   : المحاسبة بالكامل (مصروفات، شركاء، توزيع أرباح، تقارير) + قراءة فقط للحجوزات والأسعار
--
-- ملاحظة محاسبية: إيراد القاعة = إجمالي الحجوزات بحالة «تم» (completed) حسب تاريخ المناسبة.
--                 إيراد الكافيه = الأوردرات المدفوعة حسب وقت الدفع (بتوقيت القاهرة).
-- =====================================================================

-- ---------- ثوابت ودوال مساعدة ----------
-- المنطقة الزمنية اللي بتتحسب بيها "أيام" التقارير. غيّرها هنا فقط لو الفرع في بلد تانية.
create or replace function public._biz_tz() returns text language sql immutable as $$ select 'Africa/Cairo'::text $$;

create or replace function public.is_hall_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'hall_manager'), false)
$$;

create or replace function public.is_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'accountant'), false)
$$;

create type public.hall_service_kind as enum ('dish', 'extra');                       -- طبق / خدمة إضافية
create type public.booking_status    as enum ('pending', 'confirmed', 'completed', 'cancelled');
create type public.expense_scope     as enum ('cafe', 'hall', 'general');

-- =====================================================================
-- 1) القاعة: الأسعار (إيجار + أطباق + خدمات)
-- =====================================================================
-- أسعار إيجار القاعة (مثال: "إيجار ليلة كاملة" ، "إيجار نهاري"). الأدمن/مسؤول القاعة يضيف ويعدّل بحرية.
create table public.hall_rates (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null unique,
  price       numeric(12,2) not null check (price >= 0),
  is_active   boolean not null default true,
  sort_order  int     not null default 0,
  created_at  timestamptz not null default now()
);

-- الأطباق والوجبات (kind = 'dish') + الشوك والخدمات الإضافية (kind = 'extra': ديكور، إضاءة، DJ، أدوات …)
create table public.hall_services (
  id          uuid primary key default gen_random_uuid(),
  kind        public.hall_service_kind not null,
  name        text    not null,
  price       numeric(12,2) not null check (price >= 0),
  unit_label  text,                                    -- "فرد" / "طبق" / "خدمة" … (للعرض فقط)
  is_active   boolean not null default true,
  sort_order  int     not null default 0,
  created_at  timestamptz not null default now(),
  unique (kind, name)
);

-- =====================================================================
-- 2) القاعة: الحجوزات
-- =====================================================================
create table public.hall_bookings (
  id             uuid primary key default gen_random_uuid(),
  booking_no     bigint generated always as identity,
  event_date     date not null,
  status         public.booking_status not null default 'pending',
  customer_name  text not null,
  customer_phone text,
  event_type     text,                                  -- فرح، عيد ميلاد، خطوبة، اجتماع …
  guests         int check (guests is null or guests >= 0),
  -- لقطة الأسعار وقت الحجز: تعديل الأسعار لاحقًا لا يغيّر حجز اتسجّل قبل كده
  rate_id        uuid references public.hall_rates(id) on delete set null,
  rate_name      text not null,
  hall_price     numeric(12,2) not null check (hall_price >= 0),
  dishes_total   numeric(12,2) not null default 0,
  extras_total   numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  total          numeric(12,2) not null default 0,
  paid_amount    numeric(12,2) not null default 0 check (paid_amount >= 0),   -- عربون / المدفوع لحد دلوقتي
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (paid_amount <= total)
);
-- منع تعارض الحجوزات على مستوى قاعدة البيانات: حجز واحد فعّال لكل يوم (الملغي بيفضّي اليوم).
create unique index hall_one_booking_per_day on public.hall_bookings(event_date) where status <> 'cancelled';
create index hall_bookings_status_idx on public.hall_bookings(status, event_date);
create trigger hall_bookings_touch before update on public.hall_bookings
  for each row execute function public.touch_updated_at();

create table public.hall_booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.hall_bookings(id) on delete cascade,
  service_id  uuid references public.hall_services(id) on delete set null,
  kind        public.hall_service_kind not null,
  name        text not null,                            -- لقطة
  unit_price  numeric(12,2) not null check (unit_price >= 0),   -- لقطة
  qty         int  not null check (qty > 0),
  line_total  numeric(12,2) generated always as (unit_price * qty) stored,
  position    smallint not null default 0
);
create index hall_booking_items_booking_idx on public.hall_booking_items(booking_id);

-- =====================================================================
-- 3) المحاسبة: مصروفات + شركاء + توزيع الأرباح
-- =====================================================================
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_date  date not null default ((now() at time zone public._biz_tz())::date),
  scope         public.expense_scope not null default 'general',   -- كافيه / قاعة / عام
  category      text not null,                                     -- رواتب، إيجار، كهرباء، مشتريات …
  description   text,
  amount        numeric(12,2) not null check (amount > 0),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index expenses_date_idx on public.expenses(expense_date);

create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  share_pct   numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- مجموع نسب الشركاء النشطين لازم يساوي 100% وقت اعتماد التوزيع (بتتأكد منه distribute_profit).

-- كل توزيع معتمد = لقطة ثابتة (الأرقام والنِّسب وقت الاعتماد) علشان التعديل بعد كده ما يغيّرش التاريخ.
create table public.profit_distributions (
  id              uuid primary key default gen_random_uuid(),
  period_from     date not null,
  period_to       date not null,
  cafe_revenue    numeric(14,2) not null,
  hall_revenue    numeric(14,2) not null,
  expenses_total  numeric(14,2) not null,
  net_profit      numeric(14,2) not null,
  note            text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (period_from <= period_to)
);
create table public.profit_distribution_lines (
  id               uuid primary key default gen_random_uuid(),
  distribution_id  uuid not null references public.profit_distributions(id) on delete cascade,
  partner_id       uuid references public.partners(id) on delete set null,
  partner_name     text not null,
  share_pct        numeric(5,2) not null,
  amount           numeric(14,2) not null
);
create index profit_lines_dist_idx on public.profit_distribution_lines(distribution_id);

-- =====================================================================
-- 4) حماية أوردرات الكافيه من الدورين الجدد
--    (create_order / set_order_status بتقبل أي دور نشط، فنقفلها بـ trigger بدل ما نعيد كتابة الدوال)
-- =====================================================================
create or replace function public._block_non_cafe_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.current_app_role() in ('accountant', 'hall_manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists orders_block_non_cafe on public.orders;
create trigger orders_block_non_cafe before insert or update or delete on public.orders
  for each row execute function public._block_non_cafe_roles();

-- =====================================================================
-- 5) حاسبة الحجز (المصدر الوحيد للحقيقة — السيرفر بيعيد الحساب دايمًا)
--    p = { rate_id, discount, items:[{service_id, qty}] }
--    p_booking: لو بنعدّل حجز موجود، الأسعار المتسجّلة فيه (إيجار + أصناف) بتفضل زي ما هي،
--               وأي صنف/إيجار جديد بس بيتسعّر بالسعر الحالي.
-- =====================================================================
create or replace function public._hall_compute(p jsonb, p_booking uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate_id uuid := nullif(p->>'rate_id', '')::uuid;
  v_rate public.hall_rates; v_old public.hall_bookings;
  v_hall numeric(12,2); v_rate_name text;
  r record; v_svc public.hall_services; v_it public.hall_booking_items;
  v_price numeric(12,2); v_name text; v_kind public.hall_service_kind;
  v_lines jsonb := '[]'::jsonb; v_dishes numeric(12,2) := 0; v_extras numeric(12,2) := 0;
  v_subtotal numeric(12,2); v_discount numeric(12,2);
begin
  if v_rate_id is null then raise exception 'hall rate required'; end if;
  if p_booking is not null then select * into v_old from hall_bookings where id = p_booking; end if;

  if v_old.id is not null and v_old.rate_id = v_rate_id then
    v_hall := v_old.hall_price; v_rate_name := v_old.rate_name;               -- سعر متجمّد
  else
    select * into v_rate from hall_rates where id = v_rate_id and is_active;
    if not found then raise exception 'hall rate not found'; end if;
    v_hall := v_rate.price; v_rate_name := v_rate.name;
  end if;

  for r in
    select sid, sum(q)::int as qty from (
      select (e->>'service_id')::uuid as sid, greatest(coalesce((e->>'qty')::int, 0), 0) as q
        from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) e) x
     group by sid having sum(q) > 0
  loop
    v_it := null;
    if v_old.id is not null then
      select * into v_it from hall_booking_items where booking_id = v_old.id and service_id = r.sid limit 1;
    end if;
    if v_it.id is not null then
      v_price := v_it.unit_price; v_name := v_it.name; v_kind := v_it.kind;   -- سعر متجمّد
    else
      select * into v_svc from hall_services where id = r.sid and is_active;
      if not found then raise exception 'service unavailable'; end if;
      v_price := v_svc.price; v_name := v_svc.name; v_kind := v_svc.kind;
    end if;
    v_lines := v_lines || jsonb_build_object('service_id', r.sid, 'kind', v_kind, 'name', v_name,
                 'unit_price', v_price, 'qty', r.qty, 'line_total', v_price * r.qty);
    if v_kind = 'dish' then v_dishes := v_dishes + v_price * r.qty; else v_extras := v_extras + v_price * r.qty; end if;
  end loop;

  v_subtotal := v_hall + v_dishes + v_extras;
  v_discount := least(greatest(coalesce((p->>'discount')::numeric, 0), 0), v_subtotal);
  return jsonb_build_object('rate_id', v_rate_id, 'rate_name', v_rate_name, 'hall_price', v_hall,
    'dishes_total', v_dishes, 'extras_total', v_extras, 'subtotal', v_subtotal,
    'discount', v_discount, 'total', v_subtotal - v_discount, 'lines', v_lines);
end $$;

-- عرض سعر بدون حفظ (معاينة من السيرفر)
create or replace function public.hall_quote(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hall_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  return public._hall_compute(p, nullif(p->>'id', '')::uuid);
end $$;

-- إنشاء/تعديل حجز. p = { id?, event_date, customer_name, customer_phone, event_type, guests, rate_id,
--                       items:[{service_id, qty}], discount, paid_amount, notes }
create or replace function public.hall_save_booking(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_date date := nullif(p->>'event_date', '')::date;
  v_old public.hall_bookings; v_q jsonb; v_paid numeric(12,2); l jsonb; v_pos smallint := 0;
begin
  if not public.is_hall_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_date is null then raise exception 'event date required'; end if;
  if nullif(btrim(coalesce(p->>'customer_name', '')), '') is null then raise exception 'customer name required'; end if;

  if v_id is not null then
    select * into v_old from hall_bookings where id = v_id for update;
    if not found then raise exception 'booking not found'; end if;
    if v_old.status in ('completed', 'cancelled') then raise exception 'booking is closed'; end if;
  end if;

  if exists (select 1 from hall_bookings where event_date = v_date and status <> 'cancelled' and id is distinct from v_id) then
    raise exception 'date already booked';
  end if;

  v_q := public._hall_compute(p, v_id);
  v_paid := greatest(coalesce((p->>'paid_amount')::numeric, 0), 0);
  if v_paid > (v_q->>'total')::numeric then raise exception 'paid exceeds total'; end if;

  begin
    if v_id is null then
      insert into hall_bookings (event_date, customer_name, customer_phone, event_type, guests, rate_id, rate_name, hall_price,
                                 dishes_total, extras_total, discount, total, paid_amount, notes, created_by)
      values (v_date, btrim(p->>'customer_name'), nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
              nullif(btrim(coalesce(p->>'event_type', '')), ''), nullif(p->>'guests', '')::int,
              (v_q->>'rate_id')::uuid, v_q->>'rate_name', (v_q->>'hall_price')::numeric,
              (v_q->>'dishes_total')::numeric, (v_q->>'extras_total')::numeric, (v_q->>'discount')::numeric,
              (v_q->>'total')::numeric, v_paid, nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
      returning id into v_id;
    else
      update hall_bookings set
        event_date = v_date, customer_name = btrim(p->>'customer_name'),
        customer_phone = nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
        event_type = nullif(btrim(coalesce(p->>'event_type', '')), ''), guests = nullif(p->>'guests', '')::int,
        rate_id = (v_q->>'rate_id')::uuid, rate_name = v_q->>'rate_name', hall_price = (v_q->>'hall_price')::numeric,
        dishes_total = (v_q->>'dishes_total')::numeric, extras_total = (v_q->>'extras_total')::numeric,
        discount = (v_q->>'discount')::numeric, total = (v_q->>'total')::numeric, paid_amount = v_paid,
        notes = nullif(btrim(coalesce(p->>'notes', '')), '')
      where id = v_id;
      delete from hall_booking_items where booking_id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'date already booked';
  end;

  for l in select * from jsonb_array_elements(v_q->'lines') loop
    v_pos := v_pos + 1;
    insert into hall_booking_items (booking_id, service_id, kind, name, unit_price, qty, position)
    values (v_id, (l->>'service_id')::uuid, (l->>'kind')::hall_service_kind, l->>'name',
            (l->>'unit_price')::numeric, (l->>'qty')::int, v_pos);
  end loop;
  return v_id;
end $$;

-- تغيير حالة الحجز: pending → confirmed | cancelled ، confirmed → completed | cancelled
-- «completed» = المناسبة اتعملت واتحصّل المبلغ كله → بيتسجّل إيراد وبيتساوى المدفوع بالإجمالي.
create or replace function public.hall_set_booking_status(p_id uuid, p_status public.booking_status) returns void
language plpgsql security definer set search_path = public as $$
declare v public.hall_bookings;
begin
  if not public.is_hall_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v from hall_bookings where id = p_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v.status = p_status then return; end if;                                   -- idempotent
  if not ((v.status = 'pending'   and p_status in ('confirmed', 'cancelled'))
       or (v.status = 'confirmed' and p_status in ('completed', 'cancelled'))) then
    raise exception 'invalid booking transition';
  end if;
  update hall_bookings set status = p_status,
         paid_amount = case when p_status = 'completed' then total else paid_amount end
   where id = p_id;
end $$;

-- =====================================================================
-- 6) المحاسبة: ملخص الفترة + توزيع الأرباح
-- =====================================================================
-- أرقام الفترة الأساسية (تواريخ شاملة الطرفين، بتوقيت العمل).
create or replace function public._acc_totals(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public._biz_tz();
  v_ts_from timestamptz := p_from::timestamp at time zone v_tz;
  v_ts_to   timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_cafe numeric(14,2); v_cafe_n int; v_hall numeric(14,2); v_hall_n int; v_exp numeric(14,2);
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid period'; end if;
  select coalesce(sum(total), 0), count(*) into v_cafe, v_cafe_n from orders
   where status = 'completed' and paid_at >= v_ts_from and paid_at < v_ts_to;
  select coalesce(sum(total), 0), count(*) into v_hall, v_hall_n from hall_bookings
   where status = 'completed' and event_date between p_from and p_to;
  select coalesce(sum(amount), 0) into v_exp from expenses where expense_date between p_from and p_to;
  return jsonb_build_object('cafe_revenue', v_cafe, 'cafe_orders', v_cafe_n, 'hall_revenue', v_hall, 'hall_bookings', v_hall_n,
    'total_revenue', v_cafe + v_hall, 'expenses_total', v_exp,
    'net_profit', v_cafe + v_hall - v_exp);                       -- صافي الربح = (كافيه + قاعة) − مصروفات
end $$;

-- حصص الشركاء النشطين من صافي ربح معيّن. آخر شريك بياخد فرق التقريب علشان المجموع يساوي الصافي بالضبط.
-- strict = true → يرفض لو مفيش شركاء أو مجموع النسب ≠ 100.
create or replace function public._partner_shares(p_net numeric, p_strict boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sum numeric; v_n int; i int := 0; r record; v_amt numeric; v_assigned numeric := 0; v_out jsonb := '[]'::jsonb;
begin
  select coalesce(sum(share_pct), 0), count(*) into v_sum, v_n from partners where is_active;
  if p_strict and v_n = 0 then raise exception 'no active partners'; end if;
  if p_strict and v_sum <> 100 then raise exception 'partner shares must total 100'; end if;
  for r in select * from partners where is_active order by share_pct desc, name loop
    i := i + 1;
    if i = v_n and v_sum = 100 then v_amt := round(p_net - v_assigned, 2);
    else v_amt := round(p_net * r.share_pct / 100, 2); v_assigned := v_assigned + v_amt; end if;
    v_out := v_out || jsonb_build_object('partner_id', r.id, 'name', r.name, 'share_pct', r.share_pct, 'amount', v_amt);
  end loop;
  return v_out;
end $$;

-- شاشة المحاسب: ملخص كامل لأي فترة (حد أقصى 366 يوم)
create or replace function public.accounting_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public._biz_tz(); v_tot jsonb; v_net numeric; v_sum numeric; v_n int;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if p_to - p_from > 366 then raise exception 'period too long'; end if;
  v_tot := public._acc_totals(p_from, p_to);
  v_net := (v_tot->>'net_profit')::numeric;
  select coalesce(sum(share_pct), 0), count(*) into v_sum, v_n from partners where is_active;

  return v_tot || jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'expenses_by_category', (select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb) from (
        select category, sum(amount) as total from expenses where expense_date between p_from and p_to group by category) t),
    'expenses_by_scope', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select scope, sum(amount) as total from expenses where expense_date between p_from and p_to group by scope) t),
    'daily', (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) from (
        select g.day,
               coalesce((select sum(o.total) from orders o where o.status = 'completed'
                          and (o.paid_at at time zone v_tz)::date = g.day), 0) as cafe,
               coalesce((select sum(b.total) from hall_bookings b where b.status = 'completed' and b.event_date = g.day), 0) as hall,
               coalesce((select sum(e.amount) from expenses e where e.expense_date = g.day), 0) as expenses
          from generate_series(p_from, p_to, interval '1 day') as gs(day_ts)
          cross join lateral (select gs.day_ts::date as day) g) d),
    'partners', public._partner_shares(v_net, false),
    'shares_total', v_sum,
    'active_partners', v_n);
end $$;

-- اعتماد توزيع الأرباح لفترة وحفظه كلقطة ثابتة. يرفض: فترة بتتقاطع مع توزيع سابق (منع الصرف المزدوج)،
-- صافي ربح غير موجب، أو نسب شركاء ≠ 100%.
create or replace function public.distribute_profit(p_from date, p_to date, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tot jsonb; v_net numeric; v_id uuid; l jsonb;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  v_tot := public._acc_totals(p_from, p_to);
  v_net := (v_tot->>'net_profit')::numeric;
  if v_net <= 0 then raise exception 'net profit is not positive'; end if;
  if exists (select 1 from profit_distributions where daterange(period_from, period_to, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'period overlaps an existing distribution';
  end if;

  insert into profit_distributions (period_from, period_to, cafe_revenue, hall_revenue, expenses_total, net_profit, note, created_by)
  values (p_from, p_to, (v_tot->>'cafe_revenue')::numeric, (v_tot->>'hall_revenue')::numeric,
          (v_tot->>'expenses_total')::numeric, v_net, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  for l in select * from jsonb_array_elements(public._partner_shares(v_net, true)) loop
    insert into profit_distribution_lines (distribution_id, partner_id, partner_name, share_pct, amount)
    values (v_id, (l->>'partner_id')::uuid, l->>'name', (l->>'share_pct')::numeric, (l->>'amount')::numeric);
  end loop;
  return v_id;
end $$;

-- ---------- صلاحيات التنفيذ ----------
revoke all on function public.hall_quote(jsonb)                                from public, anon;
revoke all on function public.hall_save_booking(jsonb)                         from public, anon;
revoke all on function public.hall_set_booking_status(uuid, public.booking_status) from public, anon;
revoke all on function public.accounting_summary(date, date)                   from public, anon;
revoke all on function public.distribute_profit(date, date, text)              from public, anon;
revoke all on function public._hall_compute(jsonb, uuid)                       from public, anon, authenticated;
revoke all on function public._acc_totals(date, date)                          from public, anon, authenticated;
revoke all on function public._partner_shares(numeric, boolean)                from public, anon, authenticated;
grant execute on function public.hall_quote(jsonb)                                to authenticated;
grant execute on function public.hall_save_booking(jsonb)                         to authenticated;
grant execute on function public.hall_set_booking_status(uuid, public.booking_status) to authenticated;
grant execute on function public.accounting_summary(date, date)                   to authenticated;
grant execute on function public.distribute_profit(date, date, text)              to authenticated;

-- =====================================================================
-- 7) ROW LEVEL SECURITY
-- =====================================================================
alter table public.hall_rates                enable row level security;
alter table public.hall_services             enable row level security;
alter table public.hall_bookings             enable row level security;
alter table public.hall_booking_items        enable row level security;
alter table public.expenses                  enable row level security;
alter table public.partners                  enable row level security;
alter table public.profit_distributions      enable row level security;
alter table public.profit_distribution_lines enable row level security;

-- الأسعار: مسؤول القاعة/الأدمن يقرأ ويكتب • المحاسب قراءة فقط
create policy hall_rates_read  on public.hall_rates    for select to authenticated using (public.current_app_role() in ('admin', 'hall_manager', 'accountant'));
create policy hall_rates_write on public.hall_rates    for all    to authenticated using (public.is_hall_staff()) with check (public.is_hall_staff());
create policy hall_services_read  on public.hall_services for select to authenticated using (public.current_app_role() in ('admin', 'hall_manager', 'accountant'));
create policy hall_services_write on public.hall_services for all    to authenticated using (public.is_hall_staff()) with check (public.is_hall_staff());

-- الحجوزات: قراءة للثلاثة • الكتابة عن طريق الدوال فقط (مفيش INSERT/UPDATE مباشر)
create policy hall_bookings_read      on public.hall_bookings      for select to authenticated using (public.current_app_role() in ('admin', 'hall_manager', 'accountant'));
create policy hall_booking_items_read on public.hall_booking_items for select to authenticated using (public.current_app_role() in ('admin', 'hall_manager', 'accountant'));

-- المحاسبة: الأدمن + المحاسب فقط
create policy expenses_finance on public.expenses for all to authenticated using (public.is_finance()) with check (public.is_finance());
create policy partners_finance on public.partners for all to authenticated using (public.is_finance()) with check (public.is_finance());
create policy profit_dist_read       on public.profit_distributions      for select to authenticated using (public.is_finance());
create policy profit_dist_lines_read on public.profit_distribution_lines for select to authenticated using (public.is_finance());
-- (التوزيعات بتتسجّل عن طريق distribute_profit فقط)

-- التقويم real-time (اختياري): يخلي أكتر من جهاز يشوفوا الحجز الجديد فورًا
alter table public.hall_bookings replica identity full;
alter publication supabase_realtime add table public.hall_bookings;
