-- =====================================================================
-- 013b — (1) عامل مشتل  (2) سيشن التصوير  (3) الصلاحيات الديناميكية
-- شغّله بعد 013a (في تشغيل منفصل). إضافي بالكامل: ما فيهوش drop لجداول ولا حذف بيانات.
-- =====================================================================

-- 1) عامل مشتل ---------------------------------------------------------
alter table public.staff add column if not exists job_title text
  check (job_title is null or job_title in ('nursery_worker'));
update public.staff set job_title = 'nursery_worker' where nursery_assigned and kind = 'employee' and job_title is null;

-- اختيار "عامل مشتل" يعيّن الموظف للمشتل تلقائيًا (راتبه ومصاريفه تروح لحسابات المشتل — pay_staff_salary من 012)
create or replace function public._staff_job_trg() returns trigger language plpgsql as $$
begin if new.job_title = 'nursery_worker' then new.nursery_assigned := true; end if; return new; end $$;
drop trigger if exists staff_job_title_trg on public.staff;
create trigger staff_job_title_trg before insert or update of job_title on public.staff for each row execute function public._staff_job_trg();

create or replace view public.staff_payroll with (security_invoker = true) as
  select s.id, s.name, s.kind, s.salary_type, s.base_salary, s.advances, s.is_active,
         coalesce(d.due, 0) as discounts, coalesce(d.orders, 0) as orders, s.job_title
    from public.staff s left join public.employee_dues d on d.staff_id = s.id;

-- 2) الصلاحيات الديناميكية -------------------------------------------------
-- مفاتيح الصلاحيات: hall (القاعة) • sessions (سيشن التصوير) • accounting (المحاسبة + المشتل)
create table if not exists public.user_permissions (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  permission text not null check (permission in ('hall', 'sessions', 'accounting')),
  granted_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);
create index if not exists user_permissions_perm_idx on public.user_permissions(permission);

-- الدور بيدّي صلاحيات افتراضية + أي صلاحية إضافية مسندة للحساب. الأدمن عنده كله.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when role = 'admin' then true
                 when p = 'hall'       then role = 'hall_manager'
                 when p = 'sessions'   then role in ('accountant', 'hall_manager', 'session_manager')
                 when p = 'accounting' then role = 'accountant'
                 else false end
       from profiles where id = auth.uid() and is_active)
    or exists (select 1 from user_permissions up join profiles pr on pr.id = up.user_id
                where up.user_id = auth.uid() and up.permission = p and pr.is_active),
    false)
$$;

create or replace function public.my_perms() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p), '{}') from unnest(array['hall', 'sessions', 'accounting']) p where public.has_perm(p)
$$;

-- الدوال القديمة بقت تحترم الصلاحيات المسندة (كل الـ RPCs والـ policies اللي بتستخدمها اشتغلت تلقائيًا)
create or replace function public.is_hall_staff() returns boolean language sql stable security definer set search_path = public as $$ select public.has_perm('hall') $$;
create or replace function public.is_finance()    returns boolean language sql stable security definer set search_path = public as $$ select public.has_perm('accounting') $$;

drop policy if exists hall_rates_read on public.hall_rates;
create policy hall_rates_read on public.hall_rates for select to authenticated using (public.is_hall_staff() or public.is_finance());
drop policy if exists hall_services_read on public.hall_services;
create policy hall_services_read on public.hall_services for select to authenticated using (public.is_hall_staff() or public.is_finance());
drop policy if exists hall_bookings_read on public.hall_bookings;
create policy hall_bookings_read on public.hall_bookings for select to authenticated using (public.is_hall_staff() or public.is_finance());
drop policy if exists hall_booking_items_read on public.hall_booking_items;
create policy hall_booking_items_read on public.hall_booking_items for select to authenticated using (public.is_hall_staff() or public.is_finance());

alter table public.user_permissions enable row level security;
drop policy if exists user_perm_read on public.user_permissions;
create policy user_perm_read on public.user_permissions for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin');
drop policy if exists user_perm_admin on public.user_permissions;
create policy user_perm_admin on public.user_permissions for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- 3) سيشن التصوير --------------------------------------------------------
create table if not exists public.photo_sessions (
  id             uuid primary key default gen_random_uuid(),
  session_no     bigint generated always as identity,
  session_date   date not null,
  session_time   time not null,
  customer_name  text not null check (btrim(customer_name) <> ''),
  customer_phone text,
  price          numeric(12,2) not null default 0 check (price >= 0),
  deposit        numeric(12,2) not null default 0 check (deposit >= 0),          -- الدفعة المقدمة
  status         text not null default 'confirmed' check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  notes          text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (deposit <= price)
);
create unique index if not exists photo_sessions_slot_uq on public.photo_sessions(session_date, session_time) where status <> 'cancelled';
create index if not exists photo_sessions_date_idx on public.photo_sessions(session_date, session_time);

create or replace function public._photo_sessions_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists photo_sessions_touch on public.photo_sessions;
create trigger photo_sessions_touch before update on public.photo_sessions for each row execute function public._photo_sessions_touch();

alter table public.photo_sessions enable row level security;
drop policy if exists photo_sessions_rw on public.photo_sessions;
create policy photo_sessions_rw on public.photo_sessions for all to authenticated
  using (public.has_perm('sessions')) with check (public.has_perm('sessions'));
drop policy if exists photo_sessions_no_delete on public.photo_sessions;
create policy photo_sessions_no_delete on public.photo_sessions as restrictive for delete to authenticated using (public.current_app_role() = 'admin');

-- ملخص السيشن لفترة (للتقارير)
create or replace function public.photo_sessions_summary(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_perm('sessions') then null else (
    select jsonb_build_object('count', count(*), 'total', coalesce(sum(price), 0), 'deposits', coalesce(sum(deposit), 0),
                              'remaining', coalesce(sum(price - deposit), 0))
      from photo_sessions where session_date between p_from and p_to and status <> 'cancelled') end
$$;

revoke all on function public.has_perm(text), public.my_perms(), public.photo_sessions_summary(date, date) from public, anon;
grant execute on function public.has_perm(text), public.my_perms(), public.photo_sessions_summary(date, date) to authenticated;
