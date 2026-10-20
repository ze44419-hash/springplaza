-- =====================================================================
-- 009 — طلبات شخصية للموظفين + طلبات ضيافة
-- شغّله بعد 001…008. إضافات فقط + استبدال pay_order (نفس المنطق + حارس واحد).
-- ملاحظة: orders.order_type موجود أصلًا (dine_in/takeaway/delivery) ومبني عليه الشاشات،
--         فنوع الطلب الجديد اسمه orders.order_kind ('standard' | 'employee' | 'hospitality').
-- =====================================================================

-- 1) نوع الطلب -----------------------------------------------------------
do $$ begin create type public.order_kind as enum ('standard', 'employee', 'hospitality');
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists order_kind public.order_kind not null default 'standard';
create index if not exists orders_kind_idx on public.orders(order_kind) where order_kind <> 'standard';

-- 2) الطلبات الشخصية للموظفين -------------------------------------------
create table if not exists public.employee_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders(id) on delete cascade,
  employee_id   uuid not null references public.profiles(id),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  amount        numeric(10,2) not null check (amount >= 0),
  summary       text,                                   -- "قهوة ×2، شاي ×1" (الموظف مبيقدرش يقرا الأوردر نفسه)
  requested_by  uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  settled_at    timestamptz                             -- اتخصم فعليًا من مستحقاته
);
create index if not exists employee_requests_emp_idx on public.employee_requests(employee_id, status);

-- 3) طلبات الضيافة --------------------------------------------------------
create table if not exists public.hospitality_requests (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null unique references public.orders(id) on delete cascade,
  approved_by_admin  boolean,                           -- null = مستني الأدمن · true = اتوافق · false = اترفض
  amount             numeric(10,2) not null check (amount >= 0),
  notes              text,
  expense_id         uuid references public.expenses(id) on delete set null,
  requested_by       uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by         uuid references public.profiles(id)
);

-- 4) إنشاء طلب خاص (نفس create_order + النوع) — ذري وآمن للإعادة (offline outbox)
--    p = payload create_order + { order_kind, employee_id?, notes? }
create or replace function public.create_special_order(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := (p->>'id')::uuid;
  v_kind public.order_kind := coalesce(nullif(p->>'order_kind', ''), 'standard')::public.order_kind;
  v_emp  uuid := nullif(p->>'employee_id', '')::uuid;
  v_total numeric(10,2); v_sum text;
begin
  if current_app_role() not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from orders where id = v_id) then return v_id; end if;
  if v_kind = 'employee' and not exists (select 1 from profiles where id = v_emp and is_active and role in ('waiter', 'cashier')) then
    raise exception 'employee not found';
  end if;

  perform public.create_order(p || jsonb_build_object('order_type', 'takeaway', 'table_id', null));
  update orders set order_kind = v_kind where id = v_id returning total into v_total;
  select string_agg(name || ' ×' || qty, '، ' order by position) into v_sum from order_items where order_id = v_id;

  if v_kind = 'employee' then
    insert into employee_requests (order_id, employee_id, amount, summary) values (v_id, v_emp, v_total, v_sum);
  elsif v_kind = 'hospitality' then
    insert into hospitality_requests (order_id, amount, notes) values (v_id, v_total, nullif(p->>'notes', ''));
  end if;
  return v_id;
end $$;

-- 5) قرار الموظف: قبول → الأوردر يتقفل + المبلغ يتحسب عليه + المخزون يتخصم | رفض → الأوردر يتلغي
--    مفيش paid_at/shift_id → مبيدخلش في درج الكاشير (عجز/زيادة) ولا كاش/كارت.
create or replace function public.decide_employee_request(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.employee_requests; o public.orders;
begin
  select * into r from employee_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.employee_id <> auth.uid() then raise exception 'not authorized' using errcode = '42501'; end if;
  if r.status <> 'pending' then return; end if;                       -- idempotent

  select * into o from orders where id = r.order_id for update;
  if o.status = 'cancelled' or not p_approve then
    update employee_requests set status = 'rejected', decided_at = now() where id = p_id;
    update orders set status = 'cancelled' where id = o.id and status <> 'cancelled';
    return;
  end if;

  update employee_requests set status = 'approved', decided_at = now() where id = p_id;
  update orders set status = 'completed', paid_at = now() where id = o.id;
  perform public._deduct_order_stock(o.id, 'طلب شخصي · أوردر #' || o.order_no);
end $$;

-- 6) قرار الأدمن على الضيافة: موافقة → مصروف "ضيافة" + خصم المخزون | رفض → الأوردر يتلغي
--    الأوردر بيتقفل بدون paid_at → مبيتحسبش إيراد ولا COGS (المصروف هو اللي بيظهر في المحاسبة).
create or replace function public.decide_hospitality_request(p_id uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hospitality_requests; o public.orders; v_exp uuid;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from hospitality_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.approved_by_admin is not null then return; end if;              -- idempotent
  select * into o from orders where id = r.order_id for update;

  if o.status = 'cancelled' or not p_approve then
    update hospitality_requests set approved_by_admin = false, decided_at = now(), decided_by = auth.uid(),
           notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
    update orders set status = 'cancelled' where id = o.id and status <> 'cancelled';
    return;
  end if;

  if r.amount > 0 then
    insert into expenses (scope, category, description, amount)
    values ('cafe', 'ضيافة', 'ضيافة · أوردر #' || o.order_no || coalesce(' · ' || nullif(coalesce(nullif(p_notes, ''), r.notes), ''), ''), r.amount)
    returning id into v_exp;
  end if;
  update hospitality_requests set approved_by_admin = true, decided_at = now(), decided_by = auth.uid(), expense_id = v_exp,
         notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
  update orders set status = 'completed' where id = o.id;              -- paid_at يفضل null عمدًا
  perform public._deduct_order_stock(o.id, 'ضيافة · أوردر #' || o.order_no);
end $$;

-- 7) لو الكاشير/الأدمن لغى الأوردر وهو لسه مستني قرار → الطلب يتقفل لوحده
create or replace function public._special_order_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.order_kind <> 'standard' then
    update employee_requests   set status = 'rejected', decided_at = now()            where order_id = new.id and status = 'pending';
    update hospitality_requests set approved_by_admin = false, decided_at = now()     where order_id = new.id and approved_by_admin is null;
  end if;
  return new;
end $$;
drop trigger if exists orders_special_cancelled on public.orders;
create trigger orders_special_cancelled after update of status on public.orders
  for each row execute function public._special_order_cancelled();

-- 8) pay_order: نفس 004 + منع الدفع على الطلبات الخاصة (بتتقفل بالموافقة بس)
create or replace function public.pay_order(
  p_id uuid, p_method pay_method, p_tendered numeric default null, p_discount numeric default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := current_app_role();
  v_order public.orders; v_shift uuid;
begin
  if v_role not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;

  select * into v_order from orders where id = p_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.order_kind <> 'standard' then raise exception 'special orders are settled by approval, not payment'; end if;
  if v_order.paid_at is not null then return; end if;
  if v_order.status = 'cancelled' then raise exception 'order is cancelled'; end if;

  select id into v_shift from shifts where cashier_id = auth.uid() and status = 'open';
  if v_shift is null and v_role = 'cashier' then raise exception 'open a shift before taking payments'; end if;

  update orders set
    discount        = least(greatest(coalesce(p_discount, 0), 0), v_order.subtotal),
    total           = v_order.subtotal - least(greatest(coalesce(p_discount, 0), 0), v_order.subtotal),
    payment_method  = p_method, amount_tendered = p_tendered,
    paid_at         = now(), status = 'completed', shift_id = v_shift, cashier_id = auth.uid()
  where id = p_id;

  perform public._deduct_order_stock(p_id);
end $$;

-- 9) مستحقات الموظفين المخصومة (للأدمن) + تسوية بعد الخصم من المرتب
create or replace view public.employee_dues with (security_invoker = true) as
  select e.employee_id, p.full_name, count(*)::int as orders, sum(e.amount) as due
    from public.employee_requests e join public.profiles p on p.id = e.employee_id
   where e.status = 'approved' and e.settled_at is null
   group by e.employee_id, p.full_name;

create or replace function public.settle_employee_dues(p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  update employee_requests set settled_at = now() where employee_id = p_employee and status = 'approved' and settled_at is null;
end $$;

-- 10) الصلاحيات و RLS و Realtime
revoke all on function public.create_special_order(jsonb)                  from public, anon;
revoke all on function public.decide_employee_request(uuid, boolean)       from public, anon;
revoke all on function public.decide_hospitality_request(uuid, boolean, text) from public, anon;
revoke all on function public.settle_employee_dues(uuid)                   from public, anon;
grant execute on function public.create_special_order(jsonb)                  to authenticated;
grant execute on function public.decide_employee_request(uuid, boolean)       to authenticated;
grant execute on function public.decide_hospitality_request(uuid, boolean, text) to authenticated;
grant execute on function public.settle_employee_dues(uuid)                   to authenticated;

alter table public.employee_requests   enable row level security;
alter table public.hospitality_requests enable row level security;
-- القراءة بس (الكتابة كلها عن طريق الدوال أعلاه)
create policy employee_requests_read on public.employee_requests for select to authenticated
  using (employee_id = auth.uid() or public.current_app_role() in ('admin', 'cashier'));
create policy hospitality_requests_read on public.hospitality_requests for select to authenticated
  using (public.current_app_role() in ('admin', 'cashier'));

alter table public.employee_requests replica identity full;
alter publication supabase_realtime add table public.employee_requests, public.hospitality_requests;
