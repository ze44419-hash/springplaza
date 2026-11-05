-- =====================================================================
-- 010 — الموظفون (بدون حساب دخول) + خصم الموظفين + الرواتب والسلف
-- شغّله بعد 009. بيستبدل منطق 009 (الموظف = profile) بجدول staff.
-- ملاحظة: orders.order_type موجود أصلًا → نوع الطلب هو orders.order_kind (من 009).
-- =====================================================================

-- 1) الموظفون + السلف + الإعدادات ------------------------------------------
create table if not exists public.staff (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kind         text not null default 'employee' check (kind in ('employee', 'partner', 'admin')),
  salary_type  text not null default 'monthly' check (salary_type in ('monthly', 'daily')),
  base_salary  numeric(12,2) not null default 0 check (base_salary >= 0),   -- شهري أو يومي حسب النوع
  advances     numeric(12,2) not null default 0 check (advances >= 0),      -- السلف الحالية (بتتصفّر عند صرف الراتب)
  is_active    boolean not null default true,
  profile_id   uuid unique references public.profiles(id) on delete set null,   -- اختياري: لو عنده حساب دخول
  partner_id   uuid unique references public.partners(id) on delete set null,
  created_at   timestamptz not null default now()
);
create table if not exists public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0), note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.system_settings (
  id boolean primary key default true check (id),                           -- صف واحد بس
  employee_discount_percent numeric(5,2) not null default 0 check (employee_discount_percent between 0 and 100)
);
insert into public.system_settings (id) values (true) on conflict do nothing;

-- الأدمن والشركاء وأصحاب الحسابات يظهروا تلقائيًا كأسماء في القائمة
create or replace function public.sync_staff() returns void
language sql security definer set search_path = public as $$
  insert into staff (name, kind, profile_id)
    select full_name, case when role = 'admin' then 'admin' else 'employee' end, id
      from profiles where role in ('admin', 'waiter', 'cashier') on conflict (profile_id) do nothing;
  insert into staff (name, kind, partner_id) select name, 'partner', id from partners where is_active on conflict (partner_id) do nothing;
$$;
create or replace function public._sync_staff_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.sync_staff(); return null; end $$;
drop trigger if exists profiles_sync_staff on public.profiles;
create trigger profiles_sync_staff after insert on public.profiles for each statement execute function public._sync_staff_trg();
drop trigger if exists partners_sync_staff on public.partners;
create trigger partners_sync_staff after insert on public.partners for each statement execute function public._sync_staff_trg();
select public.sync_staff();

-- 2) orders + employee_requests ------------------------------------------------
alter table public.orders add column if not exists staff_id uuid references public.staff(id);
alter table public.orders add column if not exists discount_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists approval_status text not null default 'not_required'
  check (approval_status in ('not_required', 'pending', 'approved', 'rejected'));

alter table public.employee_requests alter column employee_id drop not null;      -- legacy (009)
alter table public.employee_requests add column if not exists staff_id uuid references public.staff(id);
alter table public.employee_requests add column if not exists staff_name text;
alter table public.employee_requests add column if not exists proxy boolean not null default false;   -- الموظف مالوش حساب → حد يأكد بدله
alter table public.employee_requests add column if not exists gross numeric(10,2) not null default 0;
alter table public.employee_requests add column if not exists discount_amount numeric(10,2) not null default 0;
create index if not exists employee_requests_staff_idx on public.employee_requests(staff_id, status);

-- ترحيل بيانات 009
update public.employee_requests e set staff_id = s.id, staff_name = s.name from public.staff s where s.profile_id = e.employee_id and e.staff_id is null;
update public.orders o set staff_id = e.staff_id, approval_status = e.status from public.employee_requests e where e.order_id = o.id;
update public.orders o set approval_status = case when h.approved_by_admin is null then 'pending' when h.approved_by_admin then 'approved' else 'rejected' end
  from public.hospitality_requests h where h.order_id = o.id;

create or replace function public.my_staff_id() returns uuid language sql stable security definer set search_path = public as
$$ select id from staff where profile_id = auth.uid() $$;

-- 3) إنشاء الطلب الخاص (كاشير / كابتن / أدمن) — الخصم بيتحسب هنا من إعداد الأدمن
create or replace function public.create_special_order(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_kind public.order_kind := coalesce(nullif(p->>'order_kind', ''), 'standard')::public.order_kind;
  v_staff uuid := nullif(p->>'staff_id', '')::uuid;
  s public.staff; v_pct numeric := 0; v_sub numeric(10,2); v_disc numeric(10,2) := 0; v_net numeric(10,2); v_sum text;
begin
  if current_app_role() not in ('cashier', 'waiter', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from orders where id = v_id) then return v_id; end if;
  if v_kind = 'employee' then
    select * into s from staff where id = v_staff and is_active;
    if not found then raise exception 'employee not found'; end if;
    select employee_discount_percent into v_pct from system_settings;
  end if;

  perform public.create_order(p || jsonb_build_object('order_type', 'takeaway', 'table_id', null));
  select subtotal into v_sub from orders where id = v_id;
  if v_kind = 'employee' then v_disc := round(v_sub * coalesce(v_pct, 0) / 100, 2); end if;
  v_net := v_sub - v_disc;
  update orders set order_kind = v_kind, staff_id = case when v_kind = 'employee' then v_staff end,
         discount = v_disc, discount_amount = v_disc, total = v_net,
         approval_status = case when v_kind = 'standard' then 'not_required' else 'pending' end
   where id = v_id;
  select string_agg(name || ' ×' || qty, '، ' order by position) into v_sum from order_items where order_id = v_id;

  if v_kind = 'employee' then
    insert into employee_requests (order_id, staff_id, staff_name, proxy, gross, discount_amount, amount, summary)
    values (v_id, v_staff, s.name, s.profile_id is null, v_sub, v_disc, v_net, v_sum);
  elsif v_kind = 'hospitality' then
    insert into hospitality_requests (order_id, amount, notes) values (v_id, v_sub, nullif(p->>'notes', ''));
  end if;
  return v_id;
end $$;

-- 4) موافقة الموظف: صاحب الحساب بنفسه، أو (لو مالوش حساب) اللي طلب/الكاشير/الأدمن بدله
create or replace function public.decide_employee_request(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.employee_requests; o public.orders; s public.staff;
begin
  select * into r from employee_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  select * into s from staff where id = r.staff_id;
  if not ((s.profile_id is not null and s.profile_id = auth.uid())
       or (s.profile_id is null and (current_app_role() in ('cashier', 'admin') or r.requested_by = auth.uid()))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status <> 'pending' then return; end if;

  select * into o from orders where id = r.order_id for update;
  if o.status = 'cancelled' or not p_approve then
    update employee_requests set status = 'rejected', decided_at = now() where id = p_id;
    update orders set status = 'cancelled', approval_status = 'rejected' where id = o.id;
    return;
  end if;
  update employee_requests set status = 'approved', decided_at = now() where id = p_id;
  update orders set status = 'completed', paid_at = now(), approval_status = 'approved' where id = o.id;   -- مفيش shift_id → برّه الدرج
  perform public._deduct_order_stock(o.id, 'طلب شخصي · أوردر #' || o.order_no);
end $$;

create or replace function public.decide_hospitality_request(p_id uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hospitality_requests; o public.orders; v_exp uuid;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from hospitality_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.approved_by_admin is not null then return; end if;
  select * into o from orders where id = r.order_id for update;

  if o.status = 'cancelled' or not p_approve then
    update hospitality_requests set approved_by_admin = false, decided_at = now(), decided_by = auth.uid(), notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
    update orders set status = 'cancelled', approval_status = 'rejected' where id = o.id;
    return;
  end if;
  if r.amount > 0 then
    insert into expenses (scope, category, description, amount)
    values ('cafe', 'ضيافة', 'ضيافة · أوردر #' || o.order_no || coalesce(' · ' || nullif(coalesce(nullif(p_notes, ''), r.notes), ''), ''), r.amount)
    returning id into v_exp;
  end if;
  update hospitality_requests set approved_by_admin = true, decided_at = now(), decided_by = auth.uid(), expense_id = v_exp, notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
  update orders set status = 'completed', approval_status = 'approved' where id = o.id;   -- paid_at null عمدًا: مش إيراد
  perform public._deduct_order_stock(o.id, 'ضيافة · أوردر #' || o.order_no);
end $$;

create or replace function public._special_order_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.order_kind <> 'standard' then
    update employee_requests    set status = 'rejected', decided_at = now()        where order_id = new.id and status = 'pending';
    update hospitality_requests set approved_by_admin = false, decided_at = now() where order_id = new.id and approved_by_admin is null;
    update orders set approval_status = 'rejected' where id = new.id and approval_status = 'pending';
  end if;
  return new;
end $$;

-- 5) السلف + صرف الراتب (أدمن/محاسب)
create or replace function public.add_staff_advance(p_staff uuid, p_amount numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_app_role() not in ('admin', 'accountant') then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'invalid amount'; end if;
  update staff set advances = advances + p_amount where id = p_staff;
  if not found then raise exception 'staff not found'; end if;
  insert into staff_advances (staff_id, amount, note) values (p_staff, p_amount, nullif(p_note, ''));
end $$;

-- p_gross = إجمالي الراتب المستحق (شهري، أو يومي × أيام) → بيتسجل مصروف "رواتب"؛
-- الصافي المدفوع = p_gross − السلف − الطلبات الشخصية. وبعدها السلف والخصومات بتتسوّى.
create or replace function public.pay_staff_salary(p_staff uuid, p_gross numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  if current_app_role() not in ('admin', 'accountant') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into s from staff where id = p_staff for update;
  if not found then raise exception 'staff not found'; end if;
  if coalesce(p_gross, 0) > 0 then
    insert into expenses (scope, category, description, amount) values ('general', 'رواتب', 'راتب · ' || s.name, p_gross);
  end if;
  update employee_requests set settled_at = now() where staff_id = p_staff and status = 'approved' and settled_at is null;
  update staff set advances = 0 where id = p_staff;
end $$;

-- 6) Views
drop view if exists public.employee_dues;
create view public.employee_dues with (security_invoker = true) as
  select staff_id, sum(amount) as due, count(*)::int as orders
    from public.employee_requests where status = 'approved' and settled_at is null group by staff_id;

create or replace view public.staff_payroll with (security_invoker = true) as
  select s.id, s.name, s.kind, s.salary_type, s.base_salary, s.advances, s.is_active,
         coalesce(d.due, 0) as discounts, coalesce(d.orders, 0) as orders
    from public.staff s left join public.employee_dues d on d.staff_id = s.id;

-- أسماء بس (من غير رواتب) لقائمة الطلب عند الكاشير/الكابتن
create or replace view public.staff_names as
  select id, name, kind from public.staff where is_active and public.current_app_role() is not null;

drop function if exists public.settle_employee_dues(uuid);

-- 7) صلاحيات + RLS
revoke all on function public.create_special_order(jsonb), public.add_staff_advance(uuid, numeric, text), public.pay_staff_salary(uuid, numeric),
  public.my_staff_id(), public.sync_staff() from public, anon;
grant execute on function public.create_special_order(jsonb), public.add_staff_advance(uuid, numeric, text), public.pay_staff_salary(uuid, numeric),
  public.my_staff_id() to authenticated;
revoke all on public.staff_names from anon; grant select on public.staff_names to authenticated;

alter table public.staff enable row level security;
alter table public.staff_advances enable row level security;
alter table public.system_settings enable row level security;
create policy staff_read on public.staff for select to authenticated using (public.current_app_role() in ('admin', 'accountant'));
create policy staff_admin on public.staff for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy staff_advances_read on public.staff_advances for select to authenticated using (public.current_app_role() in ('admin', 'accountant'));
create policy settings_read on public.system_settings for select to authenticated using (public.current_app_role() is not null);
create policy settings_admin on public.system_settings for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists employee_requests_read on public.employee_requests;
create policy employee_requests_read on public.employee_requests for select to authenticated
  using (staff_id = public.my_staff_id() or requested_by = auth.uid() or public.current_app_role() in ('admin', 'cashier', 'accountant'));
