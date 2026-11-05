-- =====================================================================
-- 011b — فروع متعددة (كافيهات + قاعات) + مسؤولين بنطاق + مصاريف وتقارير لكل فرع + راتب الأدمن
-- شغّله بعد 011a. ملاحظات تسمية (لأن الأسماء دي موجودة ومستخدمة):
--   orders.order_type  = dine_in/takeaway/delivery        → نوع الأوردر الجديد هو orders.order_kind (009)
--   expenses.category  = نص حر (رواتب/إيجار…)             → التصنيف الجديد هو expenses.expense_type
-- =====================================================================

-- 1) الفروع والتعيينات ----------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('cafe', 'hall')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (type, name)
);
insert into public.branches (type, name)
  select 'cafe', 'الكافيه الرئيسي' where not exists (select 1 from public.branches where type = 'cafe');
insert into public.branches (type, name)
  select 'hall', 'القاعة الرئيسية' where not exists (select 1 from public.branches where type = 'hall');

-- مدير (عام/محدد) أو كاشير/كابتن: التعيين بيحدد الفرع/الفروع. من غير تعيين: مدير = عام، وكاشير/كابتن = الفرع الافتراضي.
create table if not exists public.user_assignments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);
alter table public.profiles add column if not exists active_cafe_id uuid references public.branches(id) on delete set null;
alter table public.profiles add column if not exists active_hall_id uuid references public.branches(id) on delete set null;

-- 2) أعمدة الفروع + تصنيف المصروف ---------------------------------------------
alter table public.orders        add column if not exists branch_id uuid references public.branches(id);
alter table public.hall_bookings add column if not exists branch_id uuid references public.branches(id);
alter table public.staff         add column if not exists branch_id uuid references public.branches(id);   -- null = كل الفروع
alter table public.expenses      add column if not exists branch_id uuid references public.branches(id);   -- null = عام / تأسيس مشترك
alter table public.expenses      add column if not exists expense_type text not null default 'operational'
  check (expense_type in ('operational', 'establishment', 'hospitality'));
alter table public.system_settings add column if not exists admin_salary_percent numeric(5,2) not null default 10
  check (admin_salary_percent between 0 and 100);

update public.orders o set branch_id = (select id from public.branches where type = 'cafe' order by created_at limit 1) where branch_id is null;
update public.hall_bookings set branch_id = (select id from public.branches where type = 'hall' order by created_at limit 1) where branch_id is null;
update public.expenses set branch_id = (select id from public.branches where type = 'cafe' order by created_at limit 1) where branch_id is null and scope = 'cafe';
update public.expenses set branch_id = (select id from public.branches where type = 'hall' order by created_at limit 1) where branch_id is null and scope = 'hall';
update public.expenses set expense_type = 'hospitality' where category = 'ضيافة';
alter table public.orders alter column branch_id set not null;
alter table public.hall_bookings alter column branch_id set not null;
create index if not exists orders_branch_idx on public.orders(branch_id, paid_at);
create index if not exists expenses_branch_idx on public.expenses(branch_id, expense_date);
create index if not exists hall_bookings_branch_idx on public.hall_bookings(branch_id, event_date);

-- 3) دوال النطاق ----------------------------------------------------------------
-- المدير بدون تعيينات لنوع الفرع = عام. ومعاه تعيينات = الفروع المعيّنة بس.
create or replace function public._manager_scope_ok(p_branch uuid, p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from branches b where b.id = p_branch and b.type = p_type and b.is_active)
     and (not exists (select 1 from user_assignments a join branches x on x.id = a.branch_id where a.user_id = auth.uid() and x.type = p_type)
          or exists (select 1 from user_assignments a where a.user_id = auth.uid() and a.branch_id = p_branch))
$$;

-- الفرع الحالي للمستخدم حسب النوع: اختياره الأخير (للأدمن/المحاسب/المدير) ← أول تعيين ← أقدم فرع نشط
create or replace function public.my_branch_id(p_type text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := current_app_role(); v_pref uuid; v_id uuid;
begin
  if v_role in ('admin', 'accountant', 'cafe_manager', 'hall_manager') then
    select case when p_type = 'cafe' then active_cafe_id else active_hall_id end into v_pref from profiles where id = auth.uid();
    if v_pref is not null and exists (select 1 from branches where id = v_pref and is_active)
       and (v_role in ('admin', 'accountant') or public._manager_scope_ok(v_pref, p_type)) then return v_pref; end if;
  end if;
  select a.branch_id into v_id from user_assignments a join branches b on b.id = a.branch_id
   where a.user_id = auth.uid() and b.type = p_type and b.is_active order by a.created_at limit 1;
  if v_id is not null then return v_id; end if;
  return (select id from branches where type = p_type and is_active order by created_at limit 1);
end $$;

create or replace function public.can_access_branch(p_branch uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := current_app_role(); v_type text;
begin
  if v_role in ('admin', 'accountant') then return true; end if;
  if p_branch is null or v_role is null then return false; end if;
  select type into v_type from branches where id = p_branch;
  if v_type is null then return false; end if;
  if v_role = 'cafe_manager' then return public._manager_scope_ok(p_branch, 'cafe'); end if;
  if v_role = 'hall_manager' then return public._manager_scope_ok(p_branch, 'hall'); end if;
  if v_role in ('cashier', 'waiter') then return v_type = 'cafe' and p_branch = public.my_branch_id('cafe'); end if;
  return false;
end $$;

-- صلاحية الاعتماد (ضيافة) وإدخال المصروفات على فرع: الأدمن أو مدير الفرع المعني
create or replace function public.can_manage_branch(p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin'
      or (public.current_app_role() in ('cafe_manager', 'hall_manager') and public.can_access_branch(p_branch)), false)
$$;

-- الفروع المتاحة للمستخدم (للـ switcher والتقارير)
create or replace view public.my_branches as
  select id, type, name from public.branches where is_active and public.can_access_branch(id);

create or replace function public.set_active_branch(p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if current_app_role() not in ('admin', 'accountant', 'cafe_manager', 'hall_manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  select type into v_type from branches where id = p_branch and is_active;
  if v_type is null or not public.can_access_branch(p_branch) then raise exception 'branch not available'; end if;
  if v_type = 'cafe' then update profiles set active_cafe_id = p_branch where id = auth.uid();
  else update profiles set active_hall_id = p_branch where id = auth.uid(); end if;
end $$;

-- 4) تعيين الفرع تلقائيًا + حصر مدير القاعة على قاعته -------------------------------
create or replace function public._set_branch_orders() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.branch_id is null then new.branch_id := public.my_branch_id('cafe'); end if; return new; end $$;
drop trigger if exists orders_set_branch on public.orders;
create trigger orders_set_branch before insert on public.orders for each row execute function public._set_branch_orders();

create or replace function public._set_branch_bookings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.branch_id is null then new.branch_id := public.my_branch_id('hall'); end if;
  elsif auth.uid() is not null and public.current_app_role() = 'hall_manager' and not public.can_access_branch(old.branch_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists hall_bookings_set_branch on public.hall_bookings;
create trigger hall_bookings_set_branch before insert or update on public.hall_bookings for each row execute function public._set_branch_bookings();

-- مصروفات قديمة/من الشاشة بدون فرع: نربطها بالفرع الحالي حسب النطاق (عام = بدون فرع)
create or replace function public._set_branch_expenses() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null and new.scope in ('cafe', 'hall') then new.branch_id := public.my_branch_id(new.scope::text); end if;
  if new.branch_id is not null then new.scope := (select type from branches where id = new.branch_id)::public.expense_scope; end if;
  return new;
end $$;
drop trigger if exists expenses_set_branch on public.expenses;
create trigger expenses_set_branch before insert or update of branch_id on public.expenses for each row execute function public._set_branch_expenses();

-- 5) مصروف على فرع (مدير الفرع: تشغيلي/ضيافة · الأدمن/المحاسب: كل الأنواع، وبدون فرع للتأسيس المشترك)
create or replace function public.add_branch_expense(p_branch uuid, p_type text, p_category text, p_description text, p_amount numeric, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_btype text;
begin
  if p_type not in ('operational', 'establishment', 'hospitality') then raise exception 'invalid type'; end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_category), '') = '' then raise exception 'invalid expense'; end if;
  if p_branch is null then
    if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  else
    select type into v_btype from branches where id = p_branch;
    if v_btype is null then raise exception 'branch not found'; end if;
    if not (public.is_finance() or (p_type <> 'establishment' and public.can_manage_branch(p_branch))) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  insert into expenses (expense_date, scope, branch_id, expense_type, category, description, amount)
  values (coalesce(p_date, (now() at time zone public._biz_tz())::date), coalesce(v_btype, 'general')::public.expense_scope, p_branch, p_type,
          btrim(p_category), nullif(btrim(coalesce(p_description, '')), ''), p_amount) returning id into v_id;
  return v_id;
end $$;

-- 6) ضيافة: يعتمدها الأدمن أو مدير الفرع → مصروف ضيافة على الفرع + خصم الخامات
create or replace function public.decide_hospitality_request(p_id uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hospitality_requests; o public.orders; v_exp uuid;
begin
  select * into r from hospitality_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  select * into o from orders where id = r.order_id for update;
  if not public.can_manage_branch(o.branch_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if r.approved_by_admin is not null then return; end if;

  if o.status = 'cancelled' or not p_approve then
    update hospitality_requests set approved_by_admin = false, decided_at = now(), decided_by = auth.uid(), notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
    update orders set status = 'cancelled', approval_status = 'rejected' where id = o.id;
    return;
  end if;
  if r.amount > 0 then
    insert into expenses (scope, branch_id, expense_type, category, description, amount)
    values ('cafe', o.branch_id, 'hospitality', 'ضيافة', 'ضيافة · أوردر #' || o.order_no || coalesce(' · ' || nullif(coalesce(nullif(p_notes, ''), r.notes), ''), ''), r.amount)
    returning id into v_exp;
  end if;
  update hospitality_requests set approved_by_admin = true, decided_at = now(), decided_by = auth.uid(), expense_id = v_exp, notes = coalesce(nullif(p_notes, ''), notes) where id = p_id;
  update orders set status = 'completed', approval_status = 'approved' where id = o.id;
  perform public._deduct_order_stock(o.id, 'ضيافة · أوردر #' || o.order_no);
end $$;

-- 7) تقرير فرع واحد (أو كل الفروع لو p_branch = null → للأدمن/المحاسب فقط)
--    صافي قبل التأسيس = إيراد − تكلفة − (تشغيلي + ضيافة)   |   التأسيس بيتخصم بعده
create or replace function public.branch_report(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public._biz_tz();
  v_f timestamptz := p_from::timestamp at time zone v_tz; v_t timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_type text; v_rev numeric(14,2) := 0; v_cogs numeric(14,2) := 0; v_n int := 0;
  v_op numeric(14,2); v_est numeric(14,2); v_hos numeric(14,2); v_base numeric(14,2);
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'invalid period'; end if;
  if p_branch is null then
    if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  else
    if not public.can_access_branch(p_branch) then raise exception 'not authorized' using errcode = '42501'; end if;
    select type into v_type from branches where id = p_branch;
  end if;

  if p_branch is null or v_type = 'cafe' then
    select coalesce(sum(total), 0), count(*) into v_rev, v_n from orders
     where status = 'completed' and paid_at >= v_f and paid_at < v_t and (p_branch is null or branch_id = p_branch);
    select coalesce(sum(oi.qty * oi.cost_price), 0) into v_cogs from order_items oi join orders o on o.id = oi.order_id
     where o.status = 'completed' and o.paid_at >= v_f and o.paid_at < v_t and (p_branch is null or o.branch_id = p_branch);
  end if;
  if p_branch is null or v_type = 'hall' then
    v_rev := v_rev + (select coalesce(sum(total), 0) from hall_bookings where status = 'completed' and event_date between p_from and p_to and (p_branch is null or branch_id = p_branch));
    v_n   := v_n   + (select count(*) from hall_bookings where status = 'completed' and event_date between p_from and p_to and (p_branch is null or branch_id = p_branch));
    v_cogs := v_cogs + (select coalesce(sum(bi.qty * bi.cost_price), 0) from hall_booking_items bi join hall_bookings b on b.id = bi.booking_id
                         where b.status = 'completed' and b.event_date between p_from and p_to and (p_branch is null or b.branch_id = p_branch));
  end if;

  select coalesce(sum(amount) filter (where expense_type = 'operational'), 0), coalesce(sum(amount) filter (where expense_type = 'establishment'), 0),
         coalesce(sum(amount) filter (where expense_type = 'hospitality'), 0),
         coalesce(sum(amount) filter (where expense_type <> 'establishment' and category <> 'راتب الأدمن'), 0)
    into v_op, v_est, v_hos, v_base
    from expenses where expense_date between p_from and p_to and (p_branch is null or branch_id = p_branch);

  return jsonb_build_object('branch_id', p_branch, 'type', v_type, 'revenue', v_rev, 'orders', v_n, 'cogs', v_cogs,
    'operational', v_op, 'hospitality', v_hos, 'establishment', v_est,
    'net_before_establishment', v_rev - v_cogs - v_op - v_hos,
    'net', v_rev - v_cogs - v_op - v_hos - v_est,
    'admin_salary_base', v_rev - v_cogs - v_base,       -- بدون مصروف "راتب الأدمن" نفسه (منعًا للدوران)
    'by_category', (select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb) from (
        select expense_type, category, sum(amount) as total from expenses
         where expense_date between p_from and p_to and (p_branch is null or branch_id = p_branch) group by expense_type, category) t));
end $$;

-- 8) راتب الأدمن = نسبة (10% افتراضيًا) من صافي الربح قبل مصاريف التأسيس (كل الفروع)
create or replace function public.admin_salary_due(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_pct numeric; v_base numeric;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  v := public.branch_report(p_from, p_to, null);
  select admin_salary_percent into v_pct from system_settings;
  v_base := greatest((v->>'admin_salary_base')::numeric, 0);
  return jsonb_build_object('base', v_base, 'percent', v_pct, 'amount', round(v_base * v_pct / 100, 2));
end $$;

-- pay_staff_salary: نفس 010 + راتب الأدمن بيتسجل بتصنيف "راتب الأدمن" وقابل للاستبعاد من وعاء حسابه
create or replace function public.pay_staff_salary(p_staff uuid, p_gross numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  if current_app_role() not in ('admin', 'accountant') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into s from staff where id = p_staff for update;
  if not found then raise exception 'staff not found'; end if;
  if coalesce(p_gross, 0) > 0 then
    insert into expenses (scope, branch_id, expense_type, category, description, amount)
    values ('general', s.branch_id, 'operational', case when s.kind = 'admin' then 'راتب الأدمن' else 'رواتب' end, 'راتب · ' || s.name, p_gross);
  end if;
  update employee_requests set settled_at = now() where staff_id = p_staff and status = 'approved' and settled_at is null;
  update staff set advances = 0 where id = p_staff;
end $$;

-- أسماء الموظفين عند الطلب: اللي بلا فرع (الكل) + موظفو الفرع الحالي
create or replace view public.staff_names as
  select id, name, kind from public.staff
   where is_active and public.current_app_role() is not null
     and (branch_id is null or branch_id = public.my_branch_id('cafe'));

-- 9) الصلاحيات و RLS ---------------------------------------------------------------
revoke all on function public.my_branch_id(text), public.can_access_branch(uuid), public.can_manage_branch(uuid), public.set_active_branch(uuid),
  public.add_branch_expense(uuid, text, text, text, numeric, date), public.branch_report(date, date, uuid), public.admin_salary_due(date, date) from public, anon;
grant execute on function public.my_branch_id(text), public.can_access_branch(uuid), public.can_manage_branch(uuid), public.set_active_branch(uuid),
  public.add_branch_expense(uuid, text, text, text, numeric, date), public.branch_report(date, date, uuid), public.admin_salary_due(date, date) to authenticated;
revoke all on public.my_branches from anon; grant select on public.my_branches to authenticated;

alter table public.branches enable row level security;
alter table public.user_assignments enable row level security;
create policy branches_read on public.branches for select to authenticated using (public.current_app_role() is not null);
create policy branches_admin on public.branches for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy assignments_read on public.user_assignments for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy assignments_admin on public.user_assignments for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- أوردرات: كل كاشير/مدير كافيه يشوف فرعه بس (الإشعارات Realtime بتتبع نفس الـ RLS)
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  public.current_app_role() = 'admin'
  or (public.current_app_role() in ('cashier', 'cafe_manager') and public.can_access_branch(branch_id))
  or (public.current_app_role() = 'waiter' and waiter_id = auth.uid()));

drop policy if exists hall_bookings_read on public.hall_bookings;
create policy hall_bookings_read on public.hall_bookings for select to authenticated using (
  public.current_app_role() in ('admin', 'accountant') or (public.current_app_role() = 'hall_manager' and public.can_access_branch(branch_id)));
drop policy if exists hall_booking_items_read on public.hall_booking_items;
create policy hall_booking_items_read on public.hall_booking_items for select to authenticated
  using (exists (select 1 from public.hall_bookings b where b.id = booking_id));

create policy expenses_manager_read on public.expenses for select to authenticated using (public.can_manage_branch(branch_id));

drop policy if exists hospitality_requests_read on public.hospitality_requests;
create policy hospitality_requests_read on public.hospitality_requests for select to authenticated using (
  public.current_app_role() in ('admin', 'accountant')
  or (public.current_app_role() in ('cashier', 'cafe_manager') and exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(o.branch_id))));
drop policy if exists employee_requests_read on public.employee_requests;
create policy employee_requests_read on public.employee_requests for select to authenticated using (
  staff_id = public.my_staff_id() or requested_by = auth.uid() or public.current_app_role() in ('admin', 'accountant')
  or (public.current_app_role() in ('cashier', 'cafe_manager') and exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(o.branch_id))));
