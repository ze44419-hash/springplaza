-- =====================================================================
-- 008 — التكلفة (cost_price) + COGS + صافي الربح + تصدير المحاسبة
-- شغّله بعد 001…007. آمن على البيانات الحالية (إضافات فقط + استبدال دوال).
-- صافي الربح = (إجمالي الإيرادات − COGS) − المصروفات التشغيلية
-- ملاحظة: products = menu_items عندك، وhall_booking_items = booking_items.
--         عمود `price` الحالي هو سعر البيع، فأضفنا `unit_price` كعمود محسوب منه (نفس القيمة، بدون ازدواج).
-- =====================================================================

-- 1) أعمدة التكلفة ------------------------------------------------------
alter table public.products           add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);
alter table public.hall_services      add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);
alter table public.order_items        add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);  -- لقطة وقت البيع
alter table public.hall_booking_items add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);  -- لقطة وقت الحجز

-- unit_price (سعر البيع) للجدولين اللي كان عندهم price فقط
alter table public.products      add column if not exists unit_price numeric(12,2) generated always as (price) stored;
alter table public.hall_services add column if not exists unit_price numeric(12,2) generated always as (price) stored;

alter table public.hall_booking_items add column if not exists line_cost numeric(12,2) generated always as (cost_price * qty) stored;

-- 2) لقطة التكلفة تلقائيًا عند إضافة بند (من غير ما نعدّل create_order / admin_edit_order / hall_save_booking)
create or replace function public._snap_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.cost_price, 0) = 0 then
    if tg_table_name = 'order_items' then
      select cost_price into new.cost_price from products where id = new.product_id;
    else
      select cost_price into new.cost_price from hall_services where id = new.service_id;
    end if;
    new.cost_price := coalesce(new.cost_price, 0);
  end if;
  return new;
end $$;

drop trigger if exists order_items_snap_cost on public.order_items;
create trigger order_items_snap_cost before insert on public.order_items
  for each row execute function public._snap_cost();
drop trigger if exists booking_items_snap_cost on public.hall_booking_items;
create trigger booking_items_snap_cost before insert on public.hall_booking_items
  for each row execute function public._snap_cost();

-- (اختياري) بعد ما تدخّل التكلفة للأصناف: عبّي البنود القديمة بالتكلفة الحالية
-- update public.order_items oi        set cost_price = p.cost_price from public.products p      where p.id = oi.product_id and oi.cost_price = 0;
-- update public.hall_booking_items bi set cost_price = s.cost_price from public.hall_services s where s.id = bi.service_id and bi.cost_price = 0;

-- 3) صافي الربح الجديد (accounting_summary بتاخد المفاتيح الجديدة تلقائيًا لأنها بتدمج ناتج _acc_totals)
alter table public.profit_distributions add column if not exists cogs_total numeric(14,2) not null default 0;

create or replace function public._acc_totals(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public._biz_tz();
  v_ts_from timestamptz := p_from::timestamp at time zone v_tz;
  v_ts_to   timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_cafe numeric(14,2); v_cafe_n int; v_hall numeric(14,2); v_hall_n int; v_exp numeric(14,2);
  v_cafe_cogs numeric(14,2); v_hall_cogs numeric(14,2);
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid period'; end if;
  select coalesce(sum(total), 0), count(*) into v_cafe, v_cafe_n from orders
   where status = 'completed' and paid_at >= v_ts_from and paid_at < v_ts_to;
  select coalesce(sum(oi.qty * oi.cost_price), 0) into v_cafe_cogs
    from order_items oi join orders o on o.id = oi.order_id
   where o.status = 'completed' and o.paid_at >= v_ts_from and o.paid_at < v_ts_to;
  select coalesce(sum(total), 0), count(*) into v_hall, v_hall_n from hall_bookings
   where status = 'completed' and event_date between p_from and p_to;
  select coalesce(sum(bi.qty * bi.cost_price), 0) into v_hall_cogs
    from hall_booking_items bi join hall_bookings b on b.id = bi.booking_id
   where b.status = 'completed' and b.event_date between p_from and p_to;
  select coalesce(sum(amount), 0) into v_exp from expenses where expense_date between p_from and p_to;

  return jsonb_build_object(
    'cafe_revenue', v_cafe, 'cafe_orders', v_cafe_n, 'hall_revenue', v_hall, 'hall_bookings', v_hall_n,
    'total_revenue', v_cafe + v_hall,
    'cafe_cogs', v_cafe_cogs, 'hall_cogs', v_hall_cogs, 'cogs_total', v_cafe_cogs + v_hall_cogs,
    'gross_profit', v_cafe + v_hall - v_cafe_cogs - v_hall_cogs,
    'expenses_total', v_exp,
    'net_profit', (v_cafe + v_hall - v_cafe_cogs - v_hall_cogs) - v_exp);   -- (الإيرادات − COGS) − المصروفات
end $$;

-- اعتماد التوزيع: نفس المنطق القديم + حفظ COGS في اللقطة
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

  insert into profit_distributions (period_from, period_to, cafe_revenue, hall_revenue, cogs_total, expenses_total, net_profit, note, created_by)
  values (p_from, p_to, (v_tot->>'cafe_revenue')::numeric, (v_tot->>'hall_revenue')::numeric, (v_tot->>'cogs_total')::numeric,
          (v_tot->>'expenses_total')::numeric, v_net, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  for l in select * from jsonb_array_elements(public._partner_shares(v_net, true)) loop
    insert into profit_distribution_lines (distribution_id, partner_id, partner_name, share_pct, amount)
    values (v_id, (l->>'partner_id')::uuid, l->>'name', (l->>'share_pct')::numeric, (l->>'amount')::numeric);
  end loop;
  return v_id;
end $$;

-- 4) بيانات تصدير Excel (RPC واحدة = نفس أرقام الملخص بالضبط، ومحصورة على الأدمن/المحاسب)
create or replace function public.accounting_export(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public._biz_tz();
  v_f timestamptz := p_from::timestamp at time zone v_tz;
  v_t timestamptz := (p_to + 1)::timestamp at time zone v_tz;
begin
  if not public.is_finance() then raise exception 'finance only' using errcode = '42501'; end if;
  if p_to - p_from > 366 then raise exception 'period too long'; end if;
  return jsonb_build_object(
    'summary', public.accounting_summary(p_from, p_to),
    'cafe_discounts', (select coalesce(sum(discount), 0) from orders
                        where status = 'completed' and paid_at >= v_f and paid_at < v_t),
    'cafe', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
        select oi.name, sum(oi.qty)::int as qty,
               sum(oi.qty * (oi.unit_price + oi.modifiers_total)) as revenue,
               sum(oi.qty * oi.cost_price) as cogs
          from order_items oi join orders o on o.id = oi.order_id
         where o.status = 'completed' and o.paid_at >= v_f and o.paid_at < v_t
         group by oi.name) t),
    'hall', (select coalesce(jsonb_agg(t order by t.event_date, t.booking_no), '[]'::jsonb) from (
        select b.booking_no, b.event_date, b.customer_name, b.event_type, b.hall_price,
               b.dishes_total, b.extras_total, b.discount, b.total,
               coalesce((select sum(i.line_cost) from hall_booking_items i where i.booking_id = b.id), 0) as cogs
          from hall_bookings b
         where b.status = 'completed' and b.event_date between p_from and p_to) t),
    'expenses', (select coalesce(jsonb_agg(e order by e.expense_date), '[]'::jsonb) from (
        select expense_date, scope, category, description, amount
          from expenses where expense_date between p_from and p_to) e));
end $$;

revoke all on function public.accounting_export(date, date) from public, anon;
grant execute on function public.accounting_export(date, date) to authenticated;
