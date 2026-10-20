-- =====================================================================
-- 012 — المشتل (Nursery) + تقرير Excel المطوّر + فهارس الأداء
-- شغّله بعد 011b. إضافي بالكامل: create-if-not-exists / create-or-replace فقط — لا drop ولا delete ولا تعديل لبيانات قديمة.
-- =====================================================================

-- 1) تعيين موظف للمشتل ---------------------------------------------------
alter table public.staff add column if not exists nursery_assigned boolean not null default false;
create index if not exists staff_nursery_idx on public.staff(id) where nursery_assigned and is_active;

-- 2) جداول المشتل ----------------------------------------------------------
create table if not exists public.nursery_inventory (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'plant' check (kind in ('plant', 'supply')),      -- نبات / مستلزم
  unit_label    text,
  cost_price    numeric(12,2) not null default 0 check (cost_price >= 0),               -- متوسط مرجّح (بيتحدّث مع كل توريد)
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  quantity      numeric(12,3) not null default 0 check (quantity >= 0),
  low_stock_at  numeric(12,3) not null default 0 check (low_stock_at >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (kind, name)
);

create table if not exists public.nursery_transactions (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.nursery_inventory(id) on delete restrict,
  txn_type   text not null check (txn_type in ('purchase', 'sale')),                    -- توريد / بيع
  txn_date   date not null default ((now() at time zone public._biz_tz())::date),
  qty        numeric(12,3) not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),                            -- توريد: تكلفة الوحدة • بيع: سعر البيع
  unit_cost  numeric(12,2) not null default 0 check (unit_cost >= 0),                   -- لقطة التكلفة وقت البيع (COGS)
  total      numeric(14,2) generated always as (round(qty * unit_price, 2)) stored,
  cogs       numeric(14,2) generated always as (case when txn_type = 'sale' then round(qty * unit_cost, 2) else 0 end) stored,
  staff_id   uuid references public.staff(id) on delete set null,                      -- موظف المشتل المسؤول
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists nursery_txn_date_idx  on public.nursery_transactions(txn_date, txn_type) include (total, cogs);
create index if not exists nursery_txn_item_idx  on public.nursery_transactions(item_id, txn_date);
create index if not exists nursery_txn_staff_idx on public.nursery_transactions(staff_id) where staff_id is not null;

create table if not exists public.nursery_expenses (
  id           uuid primary key default gen_random_uuid(),
  expense_date date not null default ((now() at time zone public._biz_tz())::date),
  category     text not null,
  description  text,
  amount       numeric(12,2) not null check (amount > 0),
  staff_id     uuid references public.staff(id) on delete set null,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists nursery_exp_date_idx on public.nursery_expenses(expense_date) include (amount);

-- 3) تسجيل توريد/بيع ذرّي (قفل الصنف → منع البيع بالسالب → تحديث الكمية والتكلفة المرجّحة)
create or replace function public.nursery_record(
  p_item uuid, p_type text, p_qty numeric, p_price numeric default null,
  p_staff uuid default null, p_note text default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.nursery_inventory; v_price numeric; v_id uuid;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if p_type not in ('purchase', 'sale') or coalesce(p_qty, 0) <= 0 then raise exception 'invalid quantity'; end if;
  select * into i from nursery_inventory where id = p_item for update;
  if not found then raise exception 'ingredient not found'; end if;
  if p_staff is not null and not exists (select 1 from staff where id = p_staff and nursery_assigned) then
    raise exception 'staff not assigned to nursery'; end if;

  if p_type = 'sale' then
    if p_qty > i.quantity then raise exception 'insufficient stock'; end if;
    v_price := coalesce(p_price, i.selling_price);
    insert into nursery_transactions (item_id, txn_type, txn_date, qty, unit_price, unit_cost, staff_id, note)
      values (i.id, 'sale', coalesce(p_date, (now() at time zone public._biz_tz())::date), p_qty, v_price, i.cost_price, p_staff, nullif(btrim(coalesce(p_note, '')), ''))
      returning id into v_id;
    update nursery_inventory set quantity = quantity - p_qty where id = i.id;
  else
    v_price := coalesce(p_price, i.cost_price);
    insert into nursery_transactions (item_id, txn_type, txn_date, qty, unit_price, unit_cost, staff_id, note)
      values (i.id, 'purchase', coalesce(p_date, (now() at time zone public._biz_tz())::date), p_qty, v_price, v_price, p_staff, nullif(btrim(coalesce(p_note, '')), ''))
      returning id into v_id;
    update nursery_inventory set
      cost_price = round((quantity * cost_price + p_qty * v_price) / (quantity + p_qty), 2),
      quantity = quantity + p_qty
     where id = i.id;
  end if;
  return v_id;
end $$;

-- 4) تقرير المشتل المنفصل (مبيعات، تكلفة، توريد، مصروفات، صافي + تفصيل أصناف/موظفين/عمليات)
create or replace function public.nursery_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rev numeric(14,2); v_cogs numeric(14,2); v_pur numeric(14,2); v_n int; v_exp numeric(14,2);
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'invalid period'; end if;
  select coalesce(sum(total) filter (where txn_type = 'sale'), 0), coalesce(sum(cogs), 0),
         coalesce(sum(total) filter (where txn_type = 'purchase'), 0), count(*) filter (where txn_type = 'sale')
    into v_rev, v_cogs, v_pur, v_n from nursery_transactions where txn_date between p_from and p_to;
  select coalesce(sum(amount), 0) into v_exp from nursery_expenses where expense_date between p_from and p_to;

  return jsonb_build_object('revenue', v_rev, 'cogs', v_cogs, 'gross', v_rev - v_cogs, 'purchases', v_pur,
    'expenses', v_exp, 'net', v_rev - v_cogs - v_exp, 'sales_count', v_n,
    'items', (select coalesce(jsonb_agg(t order by t.revenue desc, t.name), '[]'::jsonb) from (
        select i.name, i.kind, i.unit_label, i.quantity, i.cost_price, i.selling_price,
               round(i.quantity * i.cost_price, 2) as stock_value,
               coalesce(sum(x.qty) filter (where x.txn_type = 'sale'), 0) as sold_qty,
               coalesce(sum(x.total) filter (where x.txn_type = 'sale'), 0) as revenue,
               coalesce(sum(x.cogs), 0) as cogs,
               coalesce(sum(x.qty) filter (where x.txn_type = 'purchase'), 0) as purchased_qty,
               coalesce(sum(x.total) filter (where x.txn_type = 'purchase'), 0) as purchases
          from nursery_inventory i
          left join nursery_transactions x on x.item_id = i.id and x.txn_date between p_from and p_to
         where i.is_active or x.id is not null
         group by i.id) t),
    'staff', (select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) from (
        select s.name,
               coalesce((select sum(total) from nursery_transactions x where x.staff_id = s.id and x.txn_type = 'sale' and x.txn_date between p_from and p_to), 0) as sales,
               coalesce((select count(*) from nursery_transactions x where x.staff_id = s.id and x.txn_date between p_from and p_to), 0) as txns,
               coalesce((select sum(amount) from nursery_expenses e where e.staff_id = s.id and e.expense_date between p_from and p_to), 0) as expenses
          from staff s where s.nursery_assigned and s.is_active) t),
    'txns', (select coalesce(jsonb_agg(t order by t.txn_date, t.created_at), '[]'::jsonb) from (
        select x.txn_date, x.txn_type, i.name as item, x.qty, x.unit_price, x.total, x.cogs, s.name as staff, x.note, x.created_at
          from nursery_transactions x join nursery_inventory i on i.id = x.item_id left join staff s on s.id = x.staff_id
         where x.txn_date between p_from and p_to order by x.txn_date, x.created_at limit 5000) t),
    'expense_rows', (select coalesce(jsonb_agg(t order by t.expense_date), '[]'::jsonb) from (
        select e.expense_date, e.category, e.description, e.amount, s.name as staff
          from nursery_expenses e left join staff s on s.id = e.staff_id
         where e.expense_date between p_from and p_to order by e.expense_date limit 5000) t));
end $$;

-- 5) راتب الأدمن: نفس 011b + صافي المشتل داخل الوعاء (10% من صافي الربح قبل التأسيس لكل الأنشطة)
create or replace function public.admin_salary_due(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; n jsonb; v_pct numeric; v_base numeric;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  v := public.branch_report(p_from, p_to, null);
  n := public.nursery_report(p_from, p_to);
  select admin_salary_percent into v_pct from system_settings;
  v_base := greatest((v->>'admin_salary_base')::numeric + (n->>'net')::numeric, 0);
  return jsonb_build_object('base', v_base, 'percent', v_pct, 'amount', round(v_base * v_pct / 100, 2), 'nursery_net', (n->>'net')::numeric);
end $$;

-- 6) صرف الراتب: موظف المشتل → مصروف مشتل (مستقل) • الباقي زي 011b بالظبط
create or replace function public.pay_staff_salary(p_staff uuid, p_gross numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  if current_app_role() not in ('admin', 'accountant') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into s from staff where id = p_staff for update;
  if not found then raise exception 'staff not found'; end if;
  if coalesce(p_gross, 0) > 0 then
    if s.nursery_assigned and s.kind <> 'admin' then
      insert into nursery_expenses (category, description, amount, staff_id) values ('رواتب', 'راتب · ' || s.name, p_gross, s.id);
    else
      insert into expenses (scope, branch_id, expense_type, category, description, amount)
      values ('general', s.branch_id, 'operational', case when s.kind = 'admin' then 'راتب الأدمن' else 'رواتب' end, 'راتب · ' || s.name, p_gross);
    end if;
  end if;
  update employee_requests set settled_at = now() where staff_id = p_staff and status = 'approved' and settled_at is null;
  update staff set advances = 0 where id = p_staff;
end $$;

-- 7) بيانات تصدير Excel الموسّعة (RPC واحدة = round-trip واحد). accounting_export القديمة تفضل زي ما هي.
create or replace function public.accounting_export_v2(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b jsonb; sm jsonb; nu jsonb; ad jsonb; v_paid numeric; v_est numeric; v_opex numeric; v_gross numeric; v_nb numeric; v_final numeric;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  b := public.accounting_export(p_from, p_to); sm := b->'summary';
  nu := public.nursery_report(p_from, p_to);
  ad := public.admin_salary_due(p_from, p_to);

  select coalesce(sum(amount) filter (where category = 'راتب الأدمن'), 0),
         coalesce(sum(amount) filter (where expense_type = 'establishment' and category <> 'راتب الأدمن'), 0)
    into v_paid, v_est from expenses where expense_date between p_from and p_to;

  v_opex  := (sm->>'expenses_total')::numeric - v_est - v_paid;                       -- تشغيلي + ضيافة بدون راتب الأدمن
  v_gross := (sm->>'gross_profit')::numeric + (nu->>'gross')::numeric;
  v_nb    := v_gross - v_opex - (nu->>'expenses')::numeric;                           -- صافي قبل التأسيس (وعاء راتب الأدمن)
  v_final := v_nb - (ad->>'amount')::numeric - v_est;

  return b || jsonb_build_object(
    'nursery', nu,
    'pnl', jsonb_build_object('gross', v_gross, 'opex', v_opex, 'nursery_expenses', (nu->>'expenses')::numeric,
        'net_before_establishment', v_nb, 'admin_salary', (ad->>'amount')::numeric, 'establishment', v_est, 'final_net', v_final,
        'partners', public._partner_shares(v_final, false)),
    'admin_salary', ad || jsonb_build_object('paid', v_paid, 'payments', (select coalesce(jsonb_agg(t order by t.expense_date), '[]'::jsonb) from (
        select expense_date, description, amount from expenses where category = 'راتب الأدمن' and expense_date between p_from and p_to) t)),
    'expenses', (select coalesce(jsonb_agg(t order by t.expense_date), '[]'::jsonb) from (
        select e.expense_date, e.scope, e.expense_type, br.name as branch, e.category, e.description, e.amount
          from expenses e left join branches br on br.id = e.branch_id
         where e.expense_date between p_from and p_to) t),
    'staff', (select coalesce(jsonb_agg(t order by t.kind, t.name), '[]'::jsonb) from (
        select p.name, p.kind, p.salary_type, p.base_salary, p.advances, p.discounts, p.orders, s.nursery_assigned, br.name as branch,
               coalesce((select sum(e.amount) from expenses e where e.description = 'راتب · ' || p.name and e.expense_date between p_from and p_to), 0)
             + coalesce((select sum(x.amount) from nursery_expenses x where x.staff_id = p.id and x.category = 'رواتب' and x.expense_date between p_from and p_to), 0) as paid
          from staff_payroll p join staff s on s.id = p.id left join branches br on br.id = s.branch_id where p.is_active) t));
end $$;

-- 8) صلاحيات + RLS (أدمن/محاسب فقط؛ الكتابة على الحركات عبر nursery_record فقط)
revoke all on function public.nursery_record(uuid, text, numeric, numeric, uuid, text, date), public.nursery_report(date, date),
  public.accounting_export_v2(date, date) from public, anon;
grant execute on function public.nursery_record(uuid, text, numeric, numeric, uuid, text, date), public.nursery_report(date, date),
  public.accounting_export_v2(date, date) to authenticated;

alter table public.nursery_inventory    enable row level security;
alter table public.nursery_transactions enable row level security;
alter table public.nursery_expenses     enable row level security;
drop policy if exists nursery_inv_finance on public.nursery_inventory;
create policy nursery_inv_finance on public.nursery_inventory    for all    to authenticated using (public.is_finance()) with check (public.is_finance());
drop policy if exists nursery_txn_read on public.nursery_transactions;
create policy nursery_txn_read    on public.nursery_transactions for select to authenticated using (public.is_finance());
drop policy if exists nursery_exp_finance on public.nursery_expenses;
create policy nursery_exp_finance on public.nursery_expenses     for all    to authenticated using (public.is_finance()) with check (public.is_finance());

-- 9) فهارس الأداء (partial/covering لمسارات التقارير؛ if not exists = آمن لو اتشغّل مرتين)
create index if not exists orders_completed_paid_idx on public.orders(paid_at) include (total, discount, branch_id) where status = 'completed';
create index if not exists orders_paid_day_idx       on public.orders((((paid_at at time zone 'Africa/Cairo'))::date)) where status = 'completed';
create index if not exists orders_staff_idx          on public.orders(staff_id) where staff_id is not null;
create index if not exists hall_bookings_done_idx    on public.hall_bookings(event_date) include (total, branch_id) where status = 'completed';
create index if not exists expenses_type_date_idx    on public.expenses(expense_type, expense_date) include (amount, branch_id);
create index if not exists expenses_admin_salary_idx on public.expenses(expense_date) include (amount) where category = 'راتب الأدمن';
create index if not exists staff_branch_idx          on public.staff(branch_id) where is_active;
create index if not exists emp_requests_open_idx     on public.employee_requests(staff_id) where status = 'approved' and settled_at is null;
create index if not exists hospitality_pending_idx   on public.hospitality_requests(created_at) where approved_by_admin is null;
analyze public.orders; analyze public.expenses; analyze public.hall_bookings;
