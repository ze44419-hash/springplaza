-- =====================================================================
-- 014 — عقد القاعة + الخزنة + فلوس بره + فترات الحجز + الموردين/المشتريات/الأصول + التقارير
-- شغّله في Supabase → SQL Editor بعد 013b. إضافي بالكامل (create if not exists / add column if not exists) — ما فيهوش drop لجداول ولا مسح بيانات.
-- ملاحظة: الخزنة وفلوس بره بيبدأوا من لحظة التشغيل (مفيش backfill لحركات قديمة علشان ما نخترعش أرقام نقدية).
-- =====================================================================

-- ---------- 0) إعدادات عامة (بنود العقد) ----------
create table if not exists public.app_settings (
  key text primary key, value text not null default '', updated_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (public.is_hall_staff() or public.is_finance());
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
insert into public.app_settings (key, value) values
 ('contract_title', 'عقد حجز قاعة'),
 ('contract_terms', E'1) العربون المدفوع غير مسترد في حالة إلغاء الحجز من طرف العميل.\n2) يلتزم العميل بسداد المبلغ المتبقي قبل أو في يوم المناسبة.\n3) يتحمل العميل مسؤولية أي تلفيات تحدث بالقاعة أو محتوياتها.\n4) يلتزم العميل بمواعيد الحجز المتفق عليها، وأي تجاوز يُحاسب عليه بسعر الفترة الإضافية.\n5) يُمنع تجاوز الحد الأقصى لعدد الضيوف المتفق عليه.\n6) الإدارة غير مسؤولة عن المفقودات الشخصية.')
on conflict (key) do nothing;

-- ---------- 1) فترات الحجز (1 / 2 / 3) ----------
alter table public.hall_bookings add column if not exists periods smallint not null default 1 check (periods between 1 and 3);

-- hall_save_booking بعد إضافة periods (نفس منطق 006 بالحرف)
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
      insert into hall_bookings (periods, event_date, customer_name, customer_phone, event_type, guests, rate_id, rate_name, hall_price,
                                 dishes_total, extras_total, discount, total, paid_amount, notes, created_by)
      values (least(greatest(coalesce(nullif(p->>'periods','')::int, 1), 1), 3), v_date, btrim(p->>'customer_name'), nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
              nullif(btrim(coalesce(p->>'event_type', '')), ''), nullif(p->>'guests', '')::int,
              (v_q->>'rate_id')::uuid, v_q->>'rate_name', (v_q->>'hall_price')::numeric,
              (v_q->>'dishes_total')::numeric, (v_q->>'extras_total')::numeric, (v_q->>'discount')::numeric,
              (v_q->>'total')::numeric, v_paid, nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
      returning id into v_id;
    else
      update hall_bookings set
        periods = least(greatest(coalesce(nullif(p->>'periods','')::int, periods), 1), 3), event_date = v_date, customer_name = btrim(p->>'customer_name'),
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

-- ---------- 2) الخزنة ----------
create table if not exists public.treasury (
  id uuid primary key default gen_random_uuid(), name text not null default 'الخزنة الرئيسية',
  balance numeric(14,2) not null default 0, updated_at timestamptz not null default now()
);
insert into public.treasury (name) select 'الخزنة الرئيسية' where not exists (select 1 from public.treasury);

create table if not exists public.treasury_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no bigint generated always as identity,
  treasury_id uuid not null references public.treasury(id),
  direction text not null check (direction in ('in', 'out')),                -- تحصيل / صرف
  source text not null,                                                      -- booking | session | receivable | expense | purchase | supplier_payment | asset | manual
  amount numeric(14,2) not null check (amount > 0),
  balance_before numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  ref_type text, ref_id uuid, note text,
  user_id uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists treasury_txn_date_idx on public.treasury_transactions(created_at desc);

-- GUC تمنع تسجيل الخزنة مرتين لما التحصيل بيتم من receivable_pay
create or replace function public._treasury_post(p_dir text, p_amount numeric, p_source text, p_ref_type text, p_ref_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.treasury; v_after numeric;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  select * into t from treasury order by id limit 1 for update;
  v_after := case when p_dir = 'in' then t.balance + p_amount else t.balance - p_amount end;
  update treasury set balance = v_after, updated_at = now() where id = t.id;
  insert into treasury_transactions (treasury_id, direction, source, amount, balance_before, balance_after, ref_type, ref_id, note)
  values (t.id, p_dir, p_source, p_amount, t.balance, v_after, p_ref_type, p_ref_id, p_note);
end $$;

-- الحجوزات: أي تغيّر في المدفوع = حركة خزنة (زيادة = تحصيل، نقص = رد)
create or replace function public._trg_booking_treasury() returns trigger language plpgsql security definer set search_path = public as $$
declare d numeric := new.paid_amount - case when tg_op = 'INSERT' then 0 else old.paid_amount end;
begin
  if coalesce(current_setting('app.skip_treasury', true), '') = '1' or d = 0 then return new; end if;
  perform public._treasury_post(case when d > 0 then 'in' else 'out' end, abs(d), 'booking', 'hall_booking', new.id,
    'حجز قاعة #' || new.booking_no || ' — ' || new.customer_name);
  return new;
end $$;
drop trigger if exists hall_bookings_treasury on public.hall_bookings;
create trigger hall_bookings_treasury after insert or update of paid_amount on public.hall_bookings for each row execute function public._trg_booking_treasury();

create or replace function public._trg_session_treasury() returns trigger language plpgsql security definer set search_path = public as $$
declare d numeric := new.deposit - case when tg_op = 'INSERT' then 0 else old.deposit end;
begin
  if coalesce(current_setting('app.skip_treasury', true), '') = '1' or d = 0 then return new; end if;
  perform public._treasury_post(case when d > 0 then 'in' else 'out' end, abs(d), 'session', 'photo_session', new.id,
    'سيشن #' || new.session_no || ' — ' || new.customer_name);
  return new;
end $$;
drop trigger if exists photo_sessions_treasury on public.photo_sessions;
create trigger photo_sessions_treasury after insert or update of deposit on public.photo_sessions for each row execute function public._trg_session_treasury();

-- المصروفات = صرف من الخزنة
create or replace function public._trg_expense_treasury() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._treasury_post('out', new.amount, 'expense', 'expense', new.id, coalesce(new.category, '') || coalesce(' — ' || new.description, ''));
  return new;
end $$;
drop trigger if exists expenses_treasury on public.expenses;
create trigger expenses_treasury after insert on public.expenses for each row execute function public._trg_expense_treasury();

-- حركة يدوية (رصيد افتتاحي / إيداع / سحب)
create or replace function public.treasury_manual(p_dir text, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if p_dir not in ('in', 'out') or coalesce(p_amount, 0) <= 0 then raise exception 'invalid amount'; end if;
  perform public._treasury_post(p_dir, p_amount, 'manual', null, null, nullif(btrim(coalesce(p_note, '')), ''));
end $$;

-- ---------- 3) فلوس بره (المبالغ المعلّقة) ----------
create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('hall_booking', 'photo_session')),
  ref_id uuid not null,
  customer_name text not null, customer_phone text,
  title text,                                                       -- وصف مختصر (حجز #12 — 2026-11-20)
  amount numeric(14,2) not null check (amount > 0),                 -- المبلغ المتبقي وقت إتمام الحجز
  paid numeric(14,2) not null default 0 check (paid >= 0),
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz not null default now(),
  check (paid <= amount),
  unique (source, ref_id)
);
create table if not exists public.receivable_payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  note text, user_id uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists receivable_pay_idx on public.receivable_payments(receivable_id);

-- إتمام حجز القاعة: المتبقي (لو فيه) بيتسجّل فلوس بره بدل ما يتعتبر اتحصّل. (قبل كده كان بيتساوى المدفوع بالإجمالي تلقائيًا.)
create or replace function public.hall_set_booking_status(p_id uuid, p_status public.booking_status) returns void
language plpgsql security definer set search_path = public as $$
declare v public.hall_bookings;
begin
  if not public.is_hall_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v from hall_bookings where id = p_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v.status = p_status then return; end if;
  if not ((v.status = 'pending' and p_status in ('confirmed', 'cancelled'))
       or (v.status = 'confirmed' and p_status in ('completed', 'cancelled'))) then
    raise exception 'invalid booking transition';
  end if;
  update hall_bookings set status = p_status where id = p_id;
  if p_status = 'completed' and v.total > v.paid_amount then
    insert into receivables (source, ref_id, customer_name, customer_phone, title, amount)
    values ('hall_booking', v.id, v.customer_name, v.customer_phone, 'حجز قاعة #' || v.booking_no || ' — ' || v.event_date, v.total - v.paid_amount)
    on conflict (source, ref_id) do nothing;
  end if;
end $$;

-- إتمام سيشن: نفس الفكرة (السيشن بتتحدّث مباشرة من الواجهة فنستخدم trigger)
create or replace function public._trg_session_receivable() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.price > new.deposit then
    insert into receivables (source, ref_id, customer_name, customer_phone, title, amount)
    values ('photo_session', new.id, new.customer_name, new.customer_phone, 'سيشن #' || new.session_no || ' — ' || new.session_date, new.price - new.deposit)
    on conflict (source, ref_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists photo_sessions_receivable on public.photo_sessions;
create trigger photo_sessions_receivable after update of status on public.photo_sessions for each row execute function public._trg_session_receivable();

-- تحصيل: يحدّث الخزنة + حساب العميل (مدفوع الحجز/السيشن الأصلي) في نفس العملية
create or replace function public.receivable_pay(p_id uuid, p_amount numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.receivables;
begin
  if not (public.is_finance() or public.is_hall_staff() or public.has_perm('sessions')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into r from receivables where id = p_id for update;
  if not found then raise exception 'receivable not found'; end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > r.amount - r.paid then raise exception 'invalid amount'; end if;
  perform set_config('app.skip_treasury', '1', true);
  if r.source = 'hall_booking' then update hall_bookings set paid_amount = paid_amount + p_amount where id = r.ref_id;
  else update photo_sessions set deposit = deposit + p_amount where id = r.ref_id; end if;
  perform set_config('app.skip_treasury', '', true);
  update receivables set paid = paid + p_amount, status = case when paid + p_amount >= amount then 'settled' else 'open' end where id = r.id;
  insert into receivable_payments (receivable_id, amount, note) values (r.id, p_amount, nullif(btrim(coalesce(p_note, '')), ''));
  perform public._treasury_post('in', p_amount, 'receivable', 'receivable', r.id, coalesce(r.title, '') || ' — ' || r.customer_name);
end $$;

-- ---------- 4) الموردين + المشتريات + الأصول ----------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), name text not null unique, phone text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(), purchase_no bigint generated always as identity,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  purchase_date date not null default current_date,
  total numeric(14,2) not null check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),            -- المدفوع وقت الشراء (الباقي = مستحق للمورد)
  notes text, created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  check (paid <= total)
);
create index if not exists purchases_date_idx on public.purchases(purchase_date);
create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,   -- لو مربوط بخامة، الكمية بتدخل المخزن
  name text not null, qty numeric(14,3) not null check (qty > 0), unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_total numeric(14,2) generated always as (round(qty * unit_cost, 2)) stored
);
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.suppliers(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0), pay_date date not null default current_date, note text,
  user_id uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(), name text not null,
  category text not null default 'أجهزة',                              -- أجهزة / أثاث / معدات / أخرى
  purchase_date date not null default current_date,
  cost numeric(14,2) not null check (cost >= 0), salvage_value numeric(14,2) not null default 0 check (salvage_value >= 0),
  life_months int not null default 60 check (life_months > 0),
  status text not null default 'active' check (status in ('active', 'disposed')),
  location text, notes text, created_at timestamptz not null default now(),
  check (salvage_value <= cost)
);

-- حفظ فاتورة مشتريات: p = { supplier_id, purchase_date, paid, notes, items:[{ingredient_id?, name, qty, unit_cost}] }
create or replace function public.purchase_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total numeric := 0; v_paid numeric; it jsonb; v_name text; v_ing uuid;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then raise exception 'purchase has no items'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_total := v_total + round((it->>'qty')::numeric * (it->>'unit_cost')::numeric, 2);
  end loop;
  v_paid := least(greatest(coalesce((p->>'paid')::numeric, 0), 0), v_total);
  insert into purchases (supplier_id, purchase_date, total, paid, notes)
  values (nullif(p->>'supplier_id', '')::uuid, coalesce(nullif(p->>'purchase_date', '')::date, current_date), v_total, v_paid, nullif(btrim(coalesce(p->>'notes', '')), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_ing := nullif(it->>'ingredient_id', '')::uuid;
    select coalesce(nullif(btrim(it->>'name'), ''), (select name from ingredients where id = v_ing), 'صنف') into v_name;
    insert into purchase_items (purchase_id, ingredient_id, name, qty, unit_cost) values (v_id, v_ing, v_name, (it->>'qty')::numeric, (it->>'unit_cost')::numeric);
    if v_ing is not null then
      -- record_inventory_tx للأدمن فقط، فبنكتب الحركة مباشرة بنفس منطقها (مخزن رئيسي)
      update ingredients set stock_qty = stock_qty + (it->>'qty')::numeric where id = v_ing;
      perform public._wh_add(public._main_warehouse(), v_ing, (it->>'qty')::numeric);
      insert into inventory_transactions (ingredient_id, type, qty_change, note, created_by, warehouse_id)
      values (v_ing, 'purchase', (it->>'qty')::numeric, 'فاتورة مشتريات', auth.uid(), public._main_warehouse());
    end if;
  end loop;
  perform public._treasury_post('out', v_paid, 'purchase', 'purchase', v_id, 'مشتريات #' || (select purchase_no from purchases where id = v_id));
  return v_id;
end $$;

create or replace function public.supplier_pay(p_supplier uuid, p_amount numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_due numeric;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  select coalesce((select sum(total - paid) from purchases where supplier_id = p_supplier), 0)
       - coalesce((select sum(amount) from supplier_payments where supplier_id = p_supplier), 0) into v_due;
  if coalesce(p_amount, 0) <= 0 or p_amount > v_due then raise exception 'invalid amount'; end if;
  insert into supplier_payments (supplier_id, amount, note) values (p_supplier, p_amount, nullif(btrim(coalesce(p_note, '')), ''));
  perform public._treasury_post('out', p_amount, 'supplier_payment', 'supplier', p_supplier, coalesce(p_note, 'سداد مورد'));
end $$;

-- إضافة أصل (اختياري: الصرف من الخزنة)
create or replace function public.asset_add(p jsonb, p_from_treasury boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  insert into assets (name, category, purchase_date, cost, salvage_value, life_months, location, notes)
  values (btrim(p->>'name'), coalesce(nullif(p->>'category', ''), 'أخرى'), coalesce(nullif(p->>'purchase_date', '')::date, current_date),
          (p->>'cost')::numeric, coalesce(nullif(p->>'salvage_value', '')::numeric, 0), coalesce(nullif(p->>'life_months', '')::int, 60),
          nullif(btrim(coalesce(p->>'location', '')), ''), nullif(btrim(coalesce(p->>'notes', '')), '')) returning id into v_id;
  if p_from_treasury then perform public._treasury_post('out', (p->>'cost')::numeric, 'asset', 'asset', v_id, 'شراء أصل: ' || (p->>'name')); end if;
  return v_id;
end $$;

-- ---------- 5) التقارير (كلها RPC للأدمن/المحاسب) ----------
-- العملاء: تجميع بالموبايل (أو الاسم لو مفيش موبايل) من القاعة + السيشن
create or replace function public.report_customers(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.remaining desc, t.name) from (
    select max(name) as name, max(phone) as phone, count(*) as bookings, sum(total) as total, sum(paid) as paid, sum(total - paid) as remaining
    from (
      select customer_name as name, customer_phone as phone, coalesce(nullif(customer_phone, ''), customer_name) as k, total, paid_amount as paid
        from hall_bookings where status <> 'cancelled' and event_date between p_from and p_to
      union all
      select customer_name, customer_phone, coalesce(nullif(customer_phone, ''), customer_name), price, deposit
        from photo_sessions where status <> 'cancelled' and session_date between p_from and p_to) x
    group by k) t), '[]'::jsonb) end
$$;

-- الحجوزات الشاملة (قاعة + سيشن)
create or replace function public.report_bookings(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.date, t.no) from (
    select 'قاعة' as kind, booking_no as no, event_date as date, customer_name as name, customer_phone as phone, status::text as status,
           periods, total, paid_amount as paid, total - paid_amount as remaining
      from hall_bookings where event_date between p_from and p_to
    union all
    select 'سيشن', session_no, session_date, customer_name, customer_phone, status, null, price, deposit, price - deposit
      from photo_sessions where session_date between p_from and p_to) t), '[]'::jsonb) end
$$;

-- الحركة الجزئية: حجوزات مدفوعة جزئيًا + حركات التحصيل بتاعتها
create or replace function public.report_partial(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else jsonb_build_object(
    'open', coalesce((select jsonb_agg(t order by t.date) from (
      select 'قاعة' as kind, booking_no as no, event_date as date, customer_name as name, status::text as status, total, paid_amount as paid, total - paid_amount as remaining
        from hall_bookings where status <> 'cancelled' and paid_amount > 0 and paid_amount < total and event_date between p_from and p_to
      union all
      select 'سيشن', session_no, session_date, customer_name, status, price, deposit, price - deposit
        from photo_sessions where status <> 'cancelled' and deposit > 0 and deposit < price and session_date between p_from and p_to) t), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(m order by m.at) from (
      select created_at as at, source, direction, amount, balance_after, note
        from treasury_transactions where source in ('booking', 'session', 'receivable') and created_at::date between p_from and p_to) m), '[]'::jsonb)) end
$$;

-- الموردين: إجمالي التوريد / المدفوع / المستحق
create or replace function public.report_suppliers() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.due desc, t.name) from (
    select s.id, s.name, s.phone,
           coalesce((select sum(total) from purchases where supplier_id = s.id), 0) as supplied,
           coalesce((select sum(paid) from purchases where supplier_id = s.id), 0) + coalesce((select sum(amount) from supplier_payments where supplier_id = s.id), 0) as paid,
           coalesce((select sum(total - paid) from purchases where supplier_id = s.id), 0) - coalesce((select sum(amount) from supplier_payments where supplier_id = s.id), 0) as due,
           (select count(*) from purchases where supplier_id = s.id) as invoices
      from suppliers s) t), '[]'::jsonb) end
$$;

create or replace function public.report_purchases(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.date desc, t.no desc) from (
    select p.purchase_no as no, p.purchase_date as date, coalesce(s.name, '—') as supplier, p.total, p.paid, p.total - p.paid as due,
           (select string_agg(i.name || ' × ' || i.qty, '، ') from purchase_items i where i.purchase_id = p.id) as items
      from purchases p left join suppliers s on s.id = p.supplier_id where p.purchase_date between p_from and p_to) t), '[]'::jsonb) end
$$;

-- المخزون: الرصيد الحالي + الوارد/المنصرف في الفترة
create or replace function public.report_inventory(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.name) from (
    select i.name, i.unit::text as unit, i.stock_qty as qty, i.min_threshold as min,
           coalesce((select sum(qty_change) from inventory_transactions x where x.ingredient_id = i.id and x.qty_change > 0 and x.created_at::date between p_from and p_to), 0) as inflow,
           coalesce(-(select sum(qty_change) from inventory_transactions x where x.ingredient_id = i.id and x.qty_change < 0 and x.created_at::date between p_from and p_to), 0) as outflow
      from ingredients i) t), '[]'::jsonb) end
$$;

-- الأصول: إهلاك قسط ثابت شهري = (التكلفة − الخردة) ÷ العمر الافتراضي بالشهور
create or replace function public.report_assets() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_finance() then null else coalesce((select jsonb_agg(t order by t.purchase_date desc) from (
    select a.id, a.name, a.category, a.purchase_date, a.cost, a.salvage_value, a.life_months, a.status,
           round((a.cost - a.salvage_value) / a.life_months, 2) as monthly_dep,
           round(least(a.cost - a.salvage_value, (a.cost - a.salvage_value) / a.life_months *
                 greatest(0, (extract(year from age(current_date, a.purchase_date)) * 12 + extract(month from age(current_date, a.purchase_date)))::int)), 2) as accumulated,
           round(a.cost - least(a.cost - a.salvage_value, (a.cost - a.salvage_value) / a.life_months *
                 greatest(0, (extract(year from age(current_date, a.purchase_date)) * 12 + extract(month from age(current_date, a.purchase_date)))::int)), 2) as book_value
      from assets a) t), '[]'::jsonb) end
$$;

-- ---------- 6) الصلاحيات + RLS ----------
alter table public.treasury              enable row level security;
alter table public.treasury_transactions enable row level security;
alter table public.receivables           enable row level security;
alter table public.receivable_payments   enable row level security;
alter table public.suppliers             enable row level security;
alter table public.purchases             enable row level security;
alter table public.purchase_items        enable row level security;
alter table public.supplier_payments     enable row level security;
alter table public.assets                enable row level security;
drop policy if exists treasury_read on public.treasury;                   create policy treasury_read on public.treasury for select to authenticated using (public.is_finance());
drop policy if exists treasury_txn_read on public.treasury_transactions;  create policy treasury_txn_read on public.treasury_transactions for select to authenticated using (public.is_finance());
drop policy if exists receivables_read on public.receivables;             create policy receivables_read on public.receivables for select to authenticated using (public.is_finance() or public.is_hall_staff() or public.has_perm('sessions'));
drop policy if exists receivable_pay_read on public.receivable_payments;  create policy receivable_pay_read on public.receivable_payments for select to authenticated using (public.is_finance() or public.is_hall_staff() or public.has_perm('sessions'));
drop policy if exists suppliers_fin on public.suppliers;                  create policy suppliers_fin on public.suppliers for all to authenticated using (public.is_finance()) with check (public.is_finance());
drop policy if exists purchases_read on public.purchases;                 create policy purchases_read on public.purchases for select to authenticated using (public.is_finance());
drop policy if exists purchase_items_read on public.purchase_items;       create policy purchase_items_read on public.purchase_items for select to authenticated using (public.is_finance());
drop policy if exists supplier_pay_read on public.supplier_payments;      create policy supplier_pay_read on public.supplier_payments for select to authenticated using (public.is_finance());
drop policy if exists assets_fin on public.assets;                        create policy assets_fin on public.assets for all to authenticated using (public.is_finance()) with check (public.is_finance());

revoke all on function public.treasury_manual(text, numeric, text), public.receivable_pay(uuid, numeric, text), public.purchase_save(jsonb),
  public.supplier_pay(uuid, numeric, text), public.asset_add(jsonb, boolean), public.report_customers(date, date), public.report_bookings(date, date),
  public.report_partial(date, date), public.report_suppliers(), public.report_purchases(date, date), public.report_inventory(date, date), public.report_assets(),
  public.hall_save_booking(jsonb), public.hall_set_booking_status(uuid, public.booking_status) from public, anon;
revoke all on function public._treasury_post(text, numeric, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.treasury_manual(text, numeric, text), public.receivable_pay(uuid, numeric, text), public.purchase_save(jsonb),
  public.supplier_pay(uuid, numeric, text), public.asset_add(jsonb, boolean), public.report_customers(date, date), public.report_bookings(date, date),
  public.report_partial(date, date), public.report_suppliers(), public.report_purchases(date, date), public.report_inventory(date, date), public.report_assets(),
  public.hall_save_booking(jsonb), public.hall_set_booking_status(uuid, public.booking_status) to authenticated;

alter publication supabase_realtime add table public.receivables;
