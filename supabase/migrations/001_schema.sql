-- =====================================================================
-- Spring Plaza Cafe — Supabase schema
-- Run in: Supabase Dashboard → SQL Editor (or `supabase db push`)
-- Contents: enums, tables, FKs, indexes, business functions (RPC),
--           Row Level Security, storage bucket, realtime publication.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type app_role       as enum ('admin', 'cashier', 'waiter');
create type order_type     as enum ('dine_in', 'takeaway', 'delivery');
create type order_status   as enum ('new', 'preparing', 'ready', 'completed', 'cancelled');
create type pay_method     as enum ('cash', 'card');
create type stock_unit     as enum ('g', 'kg', 'ml', 'l', 'pcs');
create type inv_tx_type    as enum ('purchase', 'sale', 'supplier_return', 'adjustment', 'waste');
create type shift_status   as enum ('open', 'closed');

-- ---------- Generic updated_at trigger ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- =====================================================================
-- TABLES
-- =====================================================================

-- One profile per auth user. Accounts are created ONLY by an admin (see /api/admin/users).
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null,
  role        app_role    not null default 'waiter',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Role lookup used by every RLS policy. SECURITY DEFINER avoids RLS recursion on profiles.
-- Returns NULL for unknown or deactivated users → they lose all access.
create or replace function public.current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create table public.cafe_tables (
  id          uuid primary key default gen_random_uuid(),
  label       text    not null unique,
  sort_order  int     not null default 0,
  is_active   boolean not null default true
);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null unique,
  sort_order  int     not null default 0,
  is_active   boolean not null default true
);

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid    not null references public.categories(id) on delete restrict,
  name          text    not null,
  price         numeric(10,2) not null check (price >= 0),
  image_url     text,
  is_available  boolean not null default true,
  sort_order    int     not null default 0,
  created_at    timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);

-- Quick modifiers ("extra sugar", "no foam"). Global; price_delta may be 0.
create table public.modifiers (
  id           uuid primary key default gen_random_uuid(),
  name         text    not null unique,
  price_delta  numeric(10,2) not null default 0,
  is_active    boolean not null default true
);

-- ---------- Inventory ----------
create table public.ingredients (
  id             uuid primary key default gen_random_uuid(),
  name           text       not null unique,
  unit           stock_unit not null default 'g',
  stock_qty      numeric(14,3) not null default 0,        -- may go negative if sales outrun purchases entries
  min_threshold  numeric(14,3) not null default 0,        -- low-stock alert level
  supplier       text,
  updated_at     timestamptz not null default now()
);
create trigger ingredients_touch before update on public.ingredients
  for each row execute function public.touch_updated_at();

-- Recipe mapping: 1 unit of product consumes qty_per_unit of ingredient (in the ingredient's unit).
create table public.recipes (
  product_id     uuid not null references public.products(id)    on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  qty_per_unit   numeric(14,3) not null check (qty_per_unit > 0),
  primary key (product_id, ingredient_id)
);

-- Immutable stock ledger. qty_change is signed (+ in, − out).
create table public.inventory_transactions (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  type           inv_tx_type not null,
  qty_change     numeric(14,3) not null,
  note           text,
  order_id       uuid,                                     -- set for automatic 'sale' deductions
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index inv_tx_ingredient_idx on public.inventory_transactions(ingredient_id, created_at desc);

-- ---------- Shifts ----------
create table public.shifts (
  id                    uuid primary key,                  -- client generated (offline-safe)
  cashier_id            uuid not null references public.profiles(id),
  status                shift_status not null default 'open',
  opened_at             timestamptz not null default now(),
  closed_at             timestamptz,
  opening_cash          numeric(10,2) not null default 0,
  closing_cash_counted  numeric(10,2),
  expected_cash         numeric(10,2)
);
create unique index one_open_shift_per_cashier on public.shifts(cashier_id) where status = 'open';

-- ---------- Orders ----------
create table public.orders (
  id                 uuid primary key,                      -- client generated → idempotent offline sync
  order_no           bigint generated always as identity,   -- human-friendly number, assigned on first sync
  order_type         order_type   not null default 'dine_in',
  table_id           uuid references public.cafe_tables(id),
  waiter_id          uuid references public.profiles(id),
  status             order_status not null default 'new',
  notes              text,
  subtotal           numeric(10,2) not null default 0,
  discount           numeric(10,2) not null default 0,
  total              numeric(10,2) not null default 0,
  payment_method     pay_method,
  amount_tendered    numeric(10,2),
  paid_at            timestamptz,
  shift_id           uuid references public.shifts(id),
  cashier_id         uuid references public.profiles(id),
  client_created_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (order_type <> 'dine_in' or table_id is not null)
);
create index orders_status_idx  on public.orders(status);
create index orders_paid_at_idx on public.orders(paid_at);
create index orders_waiter_idx  on public.orders(waiter_id);
create index orders_shift_idx   on public.orders(shift_id);
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  product_id       uuid not null references public.products(id),
  name             text not null,                          -- snapshot: menu edits never rewrite history
  unit_price       numeric(10,2) not null,
  qty              int  not null check (qty > 0),
  modifiers        jsonb not null default '[]'::jsonb,     -- [{id,name,price_delta}]
  modifiers_total  numeric(10,2) not null default 0,
  note             text,
  position         smallint not null default 0
);
create index order_items_order_idx on public.order_items(order_id);

-- Receipt designs, editable by the admin (key: 'cashier_slip' = order ticket printed at the cashier,
-- 'customer_bill' = the customer's bill). `config` is a JSON document; defaults live in the app code.
create table public.receipt_templates (
  kind        text primary key check (kind in ('cashier_slip', 'customer_bill')),
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

-- =====================================================================
-- BUSINESS FUNCTIONS (all writes to orders/shifts/stock go through these)
-- =====================================================================

-- Waiter (or cashier/admin) sends an order. Idempotent on p->>'id'. Prices are recomputed server-side.
-- p = { id, order_type, table_id, notes, client_created_at, items:[{product_id, qty, modifier_ids[], note}] }
create or replace function public.create_order(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_item jsonb; v_prod public.products;
  v_mods jsonb; v_mods_total numeric(10,2);
  v_qty int; v_subtotal numeric(10,2) := 0; v_pos smallint := 0;
begin
  if current_app_role() is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from orders where id = v_id) then return v_id; end if;   -- already synced
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then raise exception 'order has no items'; end if;

  insert into orders (id, order_type, table_id, waiter_id, notes, client_created_at)
  values (v_id, (p->>'order_type')::order_type, nullif(p->>'table_id', '')::uuid,
          auth.uid(), nullif(p->>'notes', ''), (p->>'client_created_at')::timestamptz);

  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    if not found or not v_prod.is_available then
      raise exception 'product unavailable: %', v_item->>'product_id';
    end if;
    v_qty := greatest((v_item->>'qty')::int, 1);

    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', m.price_delta)), '[]'::jsonb),
           coalesce(sum(m.price_delta), 0)
      into v_mods, v_mods_total
      from modifiers m
     where m.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_item->'modifier_ids', '[]'::jsonb)));

    v_pos := v_pos + 1;
    insert into order_items (order_id, product_id, name, unit_price, qty, modifiers, modifiers_total, note, position)
    values (v_id, v_prod.id, v_prod.name, v_prod.price, v_qty, v_mods, v_mods_total, nullif(v_item->>'note', ''), v_pos);

    v_subtotal := v_subtotal + (v_prod.price + v_mods_total) * v_qty;
  end loop;

  update orders set subtotal = v_subtotal, total = v_subtotal where id = v_id;
  return v_id;
end $$;

-- Status changes. Cashier/admin: preparing | ready | cancelled. Waiter: may cancel own order while still 'new'.
-- 'completed' is reachable only through pay_order().
create or replace function public.set_order_status(p_id uuid, p_status order_status) returns void
language plpgsql security definer set search_path = public as $$
declare v_role app_role := current_app_role(); v_order public.orders;
begin
  if v_role is null then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_order from orders where id = p_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status in ('completed', 'cancelled') then return; end if;          -- terminal, idempotent
  if p_status = 'completed' or p_status = 'new' then raise exception 'use pay_order to complete'; end if;

  if v_role = 'waiter' then
    if v_order.waiter_id <> auth.uid() or p_status <> 'cancelled' or v_order.status <> 'new' then
      raise exception 'waiters can only cancel their own new orders' using errcode = '42501';
    end if;
  end if;
  update orders set status = p_status where id = p_id;
end $$;

-- Checkout: records payment, completes the order and deducts stock per recipe — atomically.
-- Idempotent: paying an already-paid order is a no-op (safe for offline queue retries).
create or replace function public.pay_order(
  p_id uuid, p_method pay_method, p_tendered numeric default null, p_discount numeric default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := current_app_role();
  v_order public.orders; v_shift uuid; r record;
begin
  if v_role not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;

  select * into v_order from orders where id = p_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.paid_at is not null then return; end if;                               -- already paid
  if v_order.status = 'cancelled' then raise exception 'order is cancelled'; end if;

  select id into v_shift from shifts where cashier_id = auth.uid() and status = 'open';
  if v_shift is null and v_role = 'cashier' then raise exception 'open a shift before taking payments'; end if;

  update orders set
    discount        = least(greatest(coalesce(p_discount, 0), 0), v_order.subtotal),
    total           = v_order.subtotal - least(greatest(coalesce(p_discount, 0), 0), v_order.subtotal),
    payment_method  = p_method,
    amount_tendered = p_tendered,
    paid_at         = now(),
    status          = 'completed',
    shift_id        = v_shift,
    cashier_id      = auth.uid()
  where id = p_id;

  -- Recipe-based deduction, grouped per ingredient.
  for r in
    select rc.ingredient_id, sum(oi.qty * rc.qty_per_unit) as used
      from order_items oi join recipes rc on rc.product_id = oi.product_id
     where oi.order_id = p_id
     group by rc.ingredient_id
  loop
    update ingredients set stock_qty = stock_qty - r.used where id = r.ingredient_id;
    insert into inventory_transactions (ingredient_id, type, qty_change, order_id, created_by, note)
    values (r.ingredient_id, 'sale', -r.used, p_id, auth.uid(), 'Order #' || v_order.order_no);
  end loop;
end $$;

-- Shifts -----------------------------------------------------------------
create or replace function public.open_shift(p_id uuid, p_opening numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_existing uuid;
begin
  if current_app_role() not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from shifts where id = p_id) then return p_id; end if;       -- idempotent
  select id into v_existing from shifts where cashier_id = auth.uid() and status = 'open';
  if v_existing is not null then return v_existing; end if;
  insert into shifts (id, cashier_id, opening_cash) values (p_id, auth.uid(), greatest(coalesce(p_opening, 0), 0));
  return p_id;
end $$;

create or replace function public.close_shift(p_id uuid, p_counted numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_cash numeric(10,2);
begin
  select * into v_shift from shifts where id = p_id for update;
  if not found then raise exception 'shift not found'; end if;
  if v_shift.cashier_id <> auth.uid() and current_app_role() <> 'admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_shift.status = 'closed' then return; end if;
  select coalesce(sum(total), 0) into v_cash from orders
   where shift_id = p_id and status = 'completed' and payment_method = 'cash';
  update shifts set status = 'closed', closed_at = now(), closing_cash_counted = p_counted,
                    expected_cash = v_shift.opening_cash + v_cash
   where id = p_id;
end $$;

-- Manual stock movements (admin): purchase / supplier_return / adjustment / waste.
-- purchase → adds |qty|; supplier_return & waste → subtract |qty|; adjustment → signed delta.
create or replace function public.record_inventory_tx(
  p_ingredient uuid, p_type inv_tx_type, p_qty numeric, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_delta numeric;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_type = 'sale' then raise exception 'sales are recorded automatically'; end if;
  v_delta := case p_type
               when 'purchase'        then abs(p_qty)
               when 'supplier_return' then -abs(p_qty)
               when 'waste'           then -abs(p_qty)
               else p_qty end;
  update ingredients set stock_qty = stock_qty + v_delta where id = p_ingredient;
  if not found then raise exception 'ingredient not found'; end if;
  insert into inventory_transactions (ingredient_id, type, qty_change, note, created_by)
  values (p_ingredient, p_type, v_delta, p_note, auth.uid());
end $$;

-- Financial report for a period (admin). Uses paid_at so late-synced offline orders land on the right day.
create or replace function public.sales_report(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'gross',  coalesce(sum(total), 0),
        'cash',   coalesce(sum(total) filter (where payment_method = 'cash'), 0),
        'card',   coalesce(sum(total) filter (where payment_method = 'card'), 0),
        'discounts', coalesce(sum(discount), 0))
      from orders where status = 'completed' and paid_at >= p_from and paid_at < p_to),
    'top_products', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select oi.name, sum(oi.qty)::int as qty, sum(oi.qty * (oi.unit_price + oi.modifiers_total)) as revenue
          from order_items oi join orders o on o.id = oi.order_id
         where o.status = 'completed' and o.paid_at >= p_from and o.paid_at < p_to
         group by oi.name order by qty desc limit 10) t),
    'shifts', (
      select coalesce(jsonb_agg(s order by s.opened_at desc), '[]'::jsonb) from (
        select sh.id, sh.opened_at, sh.closed_at, sh.status, sh.opening_cash, sh.closing_cash_counted, sh.expected_cash,
               p.full_name as cashier,
               coalesce(x.orders, 0) as orders, coalesce(x.total, 0) as total,
               coalesce(x.cash, 0) as cash, coalesce(x.card, 0) as card
          from shifts sh
          join profiles p on p.id = sh.cashier_id
          left join lateral (
            select count(*) as orders, sum(o.total) as total,
                   sum(o.total) filter (where o.payment_method = 'cash') as cash,
                   sum(o.total) filter (where o.payment_method = 'card') as card
              from orders o where o.shift_id = sh.id and o.status = 'completed') x on true
         where sh.opened_at < p_to and coalesce(sh.closed_at, now()) >= p_from) s)
  ) into r;
  return r;
end $$;

-- Lock RPCs to signed-in users only.
revoke all on function public.create_order(jsonb)                          from public, anon;
revoke all on function public.set_order_status(uuid, order_status)         from public, anon;
revoke all on function public.pay_order(uuid, pay_method, numeric, numeric) from public, anon;
revoke all on function public.open_shift(uuid, numeric)                    from public, anon;
revoke all on function public.close_shift(uuid, numeric)                   from public, anon;
revoke all on function public.record_inventory_tx(uuid, inv_tx_type, numeric, text) from public, anon;
revoke all on function public.sales_report(timestamptz, timestamptz)       from public, anon;
grant execute on function public.create_order(jsonb)                          to authenticated;
grant execute on function public.set_order_status(uuid, order_status)         to authenticated;
grant execute on function public.pay_order(uuid, pay_method, numeric, numeric) to authenticated;
grant execute on function public.open_shift(uuid, numeric)                    to authenticated;
grant execute on function public.close_shift(uuid, numeric)                   to authenticated;
grant execute on function public.record_inventory_tx(uuid, inv_tx_type, numeric, text) to authenticated;
grant execute on function public.sales_report(timestamptz, timestamptz)       to authenticated;

-- Low-stock view (respects the caller's RLS → admin only in practice).
create or replace view public.low_stock_ingredients with (security_invoker = true) as
  select * from public.ingredients where stock_qty <= min_threshold;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles               enable row level security;
alter table public.cafe_tables            enable row level security;
alter table public.categories             enable row level security;
alter table public.products               enable row level security;
alter table public.modifiers              enable row level security;
alter table public.ingredients            enable row level security;
alter table public.recipes                enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.shifts                 enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.receipt_templates      enable row level security;

-- profiles: everyone reads their own row; admin reads/writes all. (Creation happens via service role.)
-- Cashiers may read staff names so the captain's name can be printed on the order ticket.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or current_app_role() in ('admin', 'cashier'));
create policy profiles_admin_write on public.profiles for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

-- Menu data: any active staff reads; only admin writes.
do $$
declare t text;
begin
  foreach t in array array['cafe_tables', 'categories', 'products', 'modifiers'] loop
    execute format('create policy %I on public.%I for select to authenticated using (current_app_role() is not null)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (current_app_role() = ''admin'') with check (current_app_role() = ''admin'')', t || '_admin', t);
  end loop;
end $$;

-- Inventory: admin only (deductions happen inside SECURITY DEFINER functions).
create policy ingredients_admin on public.ingredients for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy recipes_admin on public.recipes for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy inv_tx_admin_read on public.inventory_transactions for select to authenticated
  using (current_app_role() = 'admin');

-- Receipt designs: every active staff member reads (printing needs them, also offline via cache); only admin edits.
create policy receipt_templates_read on public.receipt_templates for select to authenticated
  using (current_app_role() is not null);
create policy receipt_templates_admin on public.receipt_templates for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

-- Shifts: cashier sees own; admin sees all. No direct writes.
create policy shifts_read on public.shifts for select to authenticated
  using (current_app_role() = 'admin' or (current_app_role() = 'cashier' and cashier_id = auth.uid()));

-- Orders: cashier/admin see everything; waiter sees only own. No direct writes (RPC only).
create policy orders_read on public.orders for select to authenticated
  using (current_app_role() in ('admin', 'cashier') or (current_app_role() = 'waiter' and waiter_id = auth.uid()));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));   -- inherits orders RLS

-- ---------- Storage: product images ----------
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
  on conflict (id) do nothing;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');
create policy product_images_admin on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and public.current_app_role() = 'admin')
  with check (bucket_id = 'product-images' and public.current_app_role() = 'admin');

-- ---------- Realtime ----------
alter table public.orders replica identity full;      -- lets listeners see the previous status on UPDATE
alter publication supabase_realtime add table public.orders, public.order_items;
