-- =====================================================================
-- 004 — مخازن متعددة + سحب/إرجاع الكاشير (عهدة الباريستا) + تعديل الأوردرات من الأدمن
-- شغّله في Supabase → SQL Editor بعد 001 / 002 / 003. آمن على بيانات موجودة:
-- أرصدة الخامات الحالية بتتنقل تلقائيًا لمخزن اسمه "المخزن الرئيسي".
--
-- نموذج المخزون الجديد (القاعدة الثابتة):
--   ingredients.stock_qty  =  Σ أرصدة المخازن  +  Σ الباقي مع الباريستا (السحوبات المفتوحة)
--   • السحب من مخزن  : رصيد المخزن ↓ ، stock_qty ثابت (الكمية لسه موجودة، بس عند الباريستا)
--   • البيع (pay_order): stock_qty ↓ وبيتحسب على السحب المفتوح (الأقدم الأول، وسحب الكاشير نفسه الأول)،
--                        ولو مفيش سحب مفتوح بيخصم من المخزن الرئيسي (النظام القديم بيفضل شغال).
--   • الإرجاع        : رصيد المخزن ↑
--   • إقفال السحب    : أي كمية ما اترجعتش ولا اتباعت بتتسجّل "عجز" وبتتخصم من stock_qty.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) المخازن وأرصدتها
-- ---------------------------------------------------------------------
create table if not exists public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null unique,
  sort_order  int     not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.warehouse_stock (
  warehouse_id  uuid not null references public.warehouses(id)  on delete restrict,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty           numeric(14,3) not null default 0,
  primary key (warehouse_id, ingredient_id)
);
create index if not exists warehouse_stock_ing_idx on public.warehouse_stock(ingredient_id);

insert into public.warehouses (name, sort_order) values ('المخزن الرئيسي', 1) on conflict (name) do nothing;

-- نقل الأرصدة الحالية للمخزن الرئيسي (مرة واحدة فقط)
insert into public.warehouse_stock (warehouse_id, ingredient_id, qty)
select (select id from public.warehouses where name = 'المخزن الرئيسي'), i.id, i.stock_qty
  from public.ingredients i
 where not exists (select 1 from public.warehouse_stock);

alter table public.inventory_transactions add column if not exists warehouse_id uuid references public.warehouses(id);
update public.inventory_transactions set warehouse_id = (select id from public.warehouses where name = 'المخزن الرئيسي')
 where warehouse_id is null;

-- أول مخزن نشط (المخزن "الافتراضي" للشراء والبيع المباشر)
create or replace function public._main_warehouse() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.warehouses order by is_active desc, sort_order, created_at limit 1
$$;

-- زيادة/نقص رصيد خامة في مخزن (upsert)
create or replace function public._wh_add(p_wh uuid, p_ing uuid, p_delta numeric) returns void
language sql security definer set search_path = public as $$
  insert into public.warehouse_stock (warehouse_id, ingredient_id, qty) values (p_wh, p_ing, p_delta)
  on conflict (warehouse_id, ingredient_id) do update set qty = public.warehouse_stock.qty + excluded.qty
$$;

-- خامة جديدة برصيد أول مدة → تدخل المخزن الرئيسي
create or replace function public._ingredient_initial_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock_qty <> 0 then perform public._wh_add(public._main_warehouse(), new.id, new.stock_qty); end if;
  return new;
end $$;
drop trigger if exists ingredients_initial_stock on public.ingredients;
create trigger ingredients_initial_stock after insert on public.ingredients
  for each row execute function public._ingredient_initial_stock();

-- ---------------------------------------------------------------------
-- 2) سحوبات الكاشير (عهدة الباريستا)
-- ---------------------------------------------------------------------
create table if not exists public.stock_withdrawals (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references public.warehouses(id),
  cashier_id    uuid not null references public.profiles(id),     -- مين الكاشير اللي سحب
  shift_id      uuid references public.shifts(id),
  status        text not null default 'open' check (status in ('open', 'closed')),
  note          text,
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references public.profiles(id)
);
create index if not exists stock_withdrawals_status_idx  on public.stock_withdrawals(status, created_at);
create index if not exists stock_withdrawals_cashier_idx on public.stock_withdrawals(cashier_id);

create table if not exists public.stock_withdrawal_items (
  id             uuid primary key default gen_random_uuid(),
  withdrawal_id  uuid not null references public.stock_withdrawals(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id),
  qty_out        numeric(14,3) not null check (qty_out > 0),      -- اتسحب
  qty_returned   numeric(14,3) not null default 0,                -- رجع للمخزن
  qty_used       numeric(14,3) not null default 0,                -- اتصرف في أوردرات مدفوعة (حسب الوصفات)
  qty_variance   numeric(14,3) not null default 0,                -- عجز عند الإقفال (ما رجعش ومش في مبيعات)
  unique (withdrawal_id, ingredient_id)
);
-- الباقي مع الباريستا = qty_out - qty_returned - qty_used - qty_variance

-- أي كمية اتخصمت لأوردر جاية منين (عشان تعديل/إلغاء الأوردر المدفوع يرجّعها لمكانها)
create table if not exists public.stock_usage (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  ingredient_id       uuid not null references public.ingredients(id),
  withdrawal_item_id  uuid references public.stock_withdrawal_items(id),
  warehouse_id        uuid references public.warehouses(id),       -- لو اتخصمت مباشرة من مخزن
  qty                 numeric(14,3) not null
);
create index if not exists stock_usage_order_idx on public.stock_usage(order_id);

-- الأوردرات المدفوعة قبل الترقية: خصمها كان من المخزن الرئيسي
insert into public.stock_usage (order_id, ingredient_id, warehouse_id, qty)
select t.order_id, t.ingredient_id, (select id from public.warehouses where name = 'المخزن الرئيسي'), -t.qty_change
  from public.inventory_transactions t
 where t.type = 'sale' and t.order_id is not null
   and exists (select 1 from public.orders o where o.id = t.order_id)
   and not exists (select 1 from public.stock_usage);

-- ---------------------------------------------------------------------
-- 3) تعديل الأوردرات (أدمن) + سجل التعديلات
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists edited_at timestamptz;

create table if not exists public.order_edits (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  edited_by  uuid references public.profiles(id),
  edited_at  timestamptz not null default now(),
  before     jsonb not null,
  after      jsonb not null
);
create index if not exists order_edits_order_idx on public.order_edits(order_id, edited_at desc);

create or replace function public._order_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object('items', coalesce(
           (select jsonb_agg(to_jsonb(i) order by i.position) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
    from public.orders o where o.id = p_id
$$;

-- ---------------------------------------------------------------------
-- 4) خصم/إرجاع مخزون الأوردر (داخلي)
-- ---------------------------------------------------------------------
create or replace function public._deduct_order_stock(p_order uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_no bigint; v_uid uuid := auth.uid(); r record; w record;
  v_left numeric; v_take numeric; v_main uuid;
begin
  select order_no into v_no from orders where id = p_order;
  for r in
    select rc.ingredient_id, sum(oi.qty * rc.qty_per_unit) as used
      from order_items oi join recipes rc on rc.product_id = oi.product_id
     where oi.order_id = p_order
     group by rc.ingredient_id
  loop
    update ingredients set stock_qty = stock_qty - r.used where id = r.ingredient_id;
    insert into inventory_transactions (ingredient_id, type, qty_change, order_id, created_by, note)
    values (r.ingredient_id, 'sale', -r.used, p_order, v_uid, coalesce(p_note, 'Order #' || v_no));

    -- الأول: من السحوبات المفتوحة (سحب الكاشير نفسه الأول، بعدين الأقدم)
    v_left := r.used;
    for w in
      select wi.id, wi.qty_out - wi.qty_returned - wi.qty_used - wi.qty_variance as remaining
        from stock_withdrawal_items wi join stock_withdrawals sw on sw.id = wi.withdrawal_id
       where sw.status = 'open' and wi.ingredient_id = r.ingredient_id
         and wi.qty_out - wi.qty_returned - wi.qty_used - wi.qty_variance > 0
       order by (sw.cashier_id = v_uid) desc, sw.created_at
       for update of wi
    loop
      exit when v_left <= 0;
      v_take := least(w.remaining, v_left);
      update stock_withdrawal_items set qty_used = qty_used + v_take where id = w.id;
      insert into stock_usage (order_id, ingredient_id, withdrawal_item_id, qty) values (p_order, r.ingredient_id, w.id, v_take);
      v_left := v_left - v_take;
    end loop;

    -- اللي فضل (مفيش سحب يغطيه): من المخزن الرئيسي مباشرة
    if v_left > 0 then
      v_main := public._main_warehouse();
      perform public._wh_add(v_main, r.ingredient_id, -v_left);
      insert into stock_usage (order_id, ingredient_id, warehouse_id, qty) values (p_order, r.ingredient_id, v_main, v_left);
    end if;
  end loop;
end $$;

create or replace function public._restore_order_stock(p_order uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u record; v_status text; v_wh uuid;
begin
  -- سطر واحد في السجل لكل خامة
  insert into inventory_transactions (ingredient_id, type, qty_change, created_by, note)
  select ingredient_id, 'adjustment', sum(qty), auth.uid(), coalesce(p_note, 'استرجاع مخزون أوردر')
    from stock_usage where order_id = p_order group by ingredient_id;

  for u in select * from stock_usage where order_id = p_order loop
    update ingredients set stock_qty = stock_qty + u.qty where id = u.ingredient_id;
    if u.withdrawal_item_id is not null then
      select sw.status, sw.warehouse_id into v_status, v_wh
        from stock_withdrawal_items wi join stock_withdrawals sw on sw.id = wi.withdrawal_id
       where wi.id = u.withdrawal_item_id;
      if v_status = 'open' then
        update stock_withdrawal_items set qty_used = qty_used - u.qty where id = u.withdrawal_item_id;
      else   -- السحب اتقفل: الكمية ترجع للمخزن كإرجاع متأخر
        update stock_withdrawal_items set qty_used = qty_used - u.qty, qty_returned = qty_returned + u.qty where id = u.withdrawal_item_id;
        perform public._wh_add(v_wh, u.ingredient_id, u.qty);
      end if;
    else
      perform public._wh_add(u.warehouse_id, u.ingredient_id, u.qty);
    end if;
  end loop;
  delete from stock_usage where order_id = p_order;
end $$;

-- ---------------------------------------------------------------------
-- 5) pay_order (نفس المنطق القديم + الخصم الجديد)
-- ---------------------------------------------------------------------
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

  perform public._deduct_order_stock(p_id);
end $$;

-- ---------------------------------------------------------------------
-- 6) حركات المخزون اليدوية (أدمن) — دلوقتي على مخزن محدد
-- ---------------------------------------------------------------------
drop function if exists public.record_inventory_tx(uuid, inv_tx_type, numeric, text);
create or replace function public.record_inventory_tx(
  p_ingredient uuid, p_type inv_tx_type, p_qty numeric, p_note text default null, p_warehouse uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_delta numeric; v_wh uuid;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_type = 'sale' then raise exception 'sales are recorded automatically'; end if;
  v_wh := coalesce(p_warehouse, public._main_warehouse());
  if not exists (select 1 from warehouses where id = v_wh) then raise exception 'warehouse not found'; end if;
  v_delta := case p_type
               when 'purchase'        then abs(p_qty)
               when 'supplier_return' then -abs(p_qty)
               when 'waste'           then -abs(p_qty)
               else p_qty end;
  update ingredients set stock_qty = stock_qty + v_delta where id = p_ingredient;
  if not found then raise exception 'ingredient not found'; end if;
  perform public._wh_add(v_wh, p_ingredient, v_delta);
  insert into inventory_transactions (ingredient_id, type, qty_change, note, created_by, warehouse_id)
  values (p_ingredient, p_type, v_delta, p_note, auth.uid(), v_wh);
end $$;

-- تحويل بين مخزنين (الإجمالي ثابت)
create or replace function public.transfer_stock(
  p_from uuid, p_to uuid, p_ingredient uuid, p_qty numeric, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_have numeric; v_from text; v_to text;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_from = p_to then raise exception 'same warehouse'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select name into v_from from warehouses where id = p_from;
  select name into v_to   from warehouses where id = p_to;
  if v_from is null or v_to is null then raise exception 'warehouse not found'; end if;
  select coalesce(qty, 0) into v_have from warehouse_stock where warehouse_id = p_from and ingredient_id = p_ingredient;
  if coalesce(v_have, 0) < p_qty then raise exception 'insufficient stock'; end if;
  perform public._wh_add(p_from, p_ingredient, -p_qty);
  perform public._wh_add(p_to,   p_ingredient,  p_qty);
  insert into inventory_transactions (ingredient_id, type, qty_change, note, created_by, warehouse_id) values
    (p_ingredient, 'adjustment', -p_qty, trim('تحويل إلى ' || v_to   || ' ' || coalesce(p_note, '')), auth.uid(), p_from),
    (p_ingredient, 'adjustment',  p_qty, trim('تحويل من '  || v_from || ' ' || coalesce(p_note, '')), auth.uid(), p_to);
end $$;

-- ---------------------------------------------------------------------
-- 7) سحب الكاشير من المخزن + الإرجاع/التسوية
-- ---------------------------------------------------------------------
-- p_items = [{ingredient_id, qty}]
create or replace function public.create_withdrawal(p_warehouse uuid, p_items jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; it jsonb; v_qty numeric; v_ing uuid; v_have numeric; v_shift uuid;
begin
  if current_app_role() not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'withdrawal has no items'; end if;
  if not exists (select 1 from warehouses where id = p_warehouse and is_active) then raise exception 'warehouse not found'; end if;

  select id into v_shift from shifts where cashier_id = auth.uid() and status = 'open';
  insert into stock_withdrawals (warehouse_id, cashier_id, shift_id, note)
  values (p_warehouse, auth.uid(), v_shift, nullif(trim(coalesce(p_note, '')), '')) returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_ing := (it->>'ingredient_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;

    select coalesce(qty, 0) into v_have from warehouse_stock where warehouse_id = p_warehouse and ingredient_id = v_ing;
    if coalesce(v_have, 0) < v_qty then raise exception 'insufficient stock'; end if;

    insert into stock_withdrawal_items (withdrawal_id, ingredient_id, qty_out) values (v_id, v_ing, v_qty)
    on conflict (withdrawal_id, ingredient_id) do update set qty_out = stock_withdrawal_items.qty_out + excluded.qty_out;
    perform public._wh_add(p_warehouse, v_ing, -v_qty);
    -- لو نفس الخامة اتكررت في الطلب، الرصيد بيتفحص تاني بعد الخصم الأول (select فوق بيشوف الرصيد المحدّث)
  end loop;
  return v_id;
end $$;

-- p_returns = [{item_id, qty}] الكمية الراجعة للمخزن. p_close = true → يقفل السحب ويسجّل العجز.
create or replace function public.settle_withdrawal(p_id uuid, p_returns jsonb default '[]'::jsonb, p_close boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare w public.stock_withdrawals; it jsonb; wi public.stock_withdrawal_items; v_qty numeric; v_rem numeric;
begin
  if current_app_role() not in ('cashier', 'admin') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into w from stock_withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal not found'; end if;
  if w.status = 'closed' then return; end if;

  for it in select * from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'invalid quantity'; end if;
    continue when v_qty = 0;
    select * into wi from stock_withdrawal_items where id = (it->>'item_id')::uuid and withdrawal_id = p_id for update;
    if not found then raise exception 'withdrawal item not found'; end if;
    v_rem := wi.qty_out - wi.qty_returned - wi.qty_used - wi.qty_variance;
    if v_qty > v_rem + 0.0005 then raise exception 'return exceeds remaining'; end if;
    update stock_withdrawal_items set qty_returned = qty_returned + v_qty where id = wi.id;
    perform public._wh_add(w.warehouse_id, wi.ingredient_id, v_qty);
  end loop;

  if p_close then
    for wi in select * from stock_withdrawal_items where withdrawal_id = p_id for update loop
      v_rem := wi.qty_out - wi.qty_returned - wi.qty_used - wi.qty_variance;
      if v_rem > 0.0005 then
        update stock_withdrawal_items set qty_variance = qty_variance + v_rem where id = wi.id;
        update ingredients set stock_qty = stock_qty - v_rem where id = wi.ingredient_id;
        insert into inventory_transactions (ingredient_id, type, qty_change, created_by, note)
        values (wi.ingredient_id, 'adjustment', -v_rem, auth.uid(), 'عجز سحب #' || left(p_id::text, 4));
      end if;
    end loop;
    update stock_withdrawals set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8) تعديل أوردر (أدمن فقط)
-- p = { id, order_type?, table_id?, notes?, status?, discount?, payment_method?, amount_tendered?,
--       items?: [{ id?, product_id, qty, note?, modifier_ids? }] }
--   • سطر له id موجود = بيحتفظ بسعره القديم (snapshot) ولو لغيت modifier_ids بيفضل زي ما هو.
--   • سطر من غير id = صنف جديد بسعر المنيو الحالي.
--   • أي سطر مش في القايمة بيتمسح.
--   • الأوردر المدفوع: تعديل الأصناف أو الإلغاء بيرجّع المخزون القديم وبيخصم الجديد.
-- ---------------------------------------------------------------------
create or replace function public.admin_edit_order(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders; v_before jsonb; v_paid boolean;
  v_status order_status; v_type order_type; v_table uuid; v_disc numeric(10,2); v_sub numeric(10,2) := 0;
  v_has_items boolean := p ? 'items';
  v_item jsonb; v_line public.order_items; v_prod public.products; v_lid uuid; v_keep uuid[] := '{}';
  v_mods jsonb; v_mods_total numeric(10,2); v_qty int; v_pos smallint := 0;
begin
  if current_app_role() <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;

  select * into v_o from orders where id = (p->>'id')::uuid for update;
  if not found then raise exception 'order not found'; end if;
  if v_o.status = 'cancelled' then raise exception 'order is cancelled'; end if;
  v_before := public._order_snapshot(v_o.id);
  v_paid := v_o.paid_at is not null and v_o.status = 'completed';

  v_status := coalesce(nullif(p->>'status', '')::order_status, v_o.status);
  if v_status = 'completed' and not v_paid then raise exception 'use pay_order to complete'; end if;
  if v_paid and v_status not in ('completed', 'cancelled') then raise exception 'cannot reopen a paid order'; end if;

  -- مخزون الأوردر المدفوع: رجّع القديم لو الأصناف هتتغير أو الأوردر هيتلغي
  if v_paid and (v_has_items or v_status = 'cancelled') then
    perform public._restore_order_stock(v_o.id, 'تعديل/إلغاء أدمن · أوردر #' || v_o.order_no);
  end if;

  if v_has_items then
    if jsonb_array_length(p->'items') = 0 and v_status <> 'cancelled' then raise exception 'order has no items'; end if;
    for v_item in select * from jsonb_array_elements(p->'items') loop
      v_qty := greatest(coalesce((v_item->>'qty')::int, 1), 1);
      v_pos := v_pos + 1;
      v_lid := nullif(v_item->>'id', '')::uuid;
      v_line := null;
      if v_lid is not null then select * into v_line from order_items where id = v_lid and order_id = v_o.id; end if;

      if v_line.id is not null then
        if v_item ? 'modifier_ids' then
          select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', m.price_delta)), '[]'::jsonb), coalesce(sum(m.price_delta), 0)
            into v_mods, v_mods_total from modifiers m
           where m.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_item->'modifier_ids', '[]'::jsonb)));
          update order_items set qty = v_qty, note = nullif(v_item->>'note', ''), modifiers = v_mods, modifiers_total = v_mods_total, position = v_pos where id = v_line.id;
          v_sub := v_sub + (v_line.unit_price + v_mods_total) * v_qty;
        else
          update order_items set qty = v_qty, note = nullif(v_item->>'note', ''), position = v_pos where id = v_line.id;
          v_sub := v_sub + (v_line.unit_price + v_line.modifiers_total) * v_qty;
        end if;
        v_keep := v_keep || v_line.id;
      else
        select * into v_prod from products where id = (v_item->>'product_id')::uuid;
        if not found then raise exception 'product unavailable: %', v_item->>'product_id'; end if;
        select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', m.price_delta)), '[]'::jsonb), coalesce(sum(m.price_delta), 0)
          into v_mods, v_mods_total from modifiers m
         where m.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_item->'modifier_ids', '[]'::jsonb)));
        insert into order_items (order_id, product_id, name, unit_price, qty, modifiers, modifiers_total, note, position)
        values (v_o.id, v_prod.id, v_prod.name, v_prod.price, v_qty, v_mods, v_mods_total, nullif(v_item->>'note', ''), v_pos)
        returning id into v_lid;
        v_keep := v_keep || v_lid;
        v_sub := v_sub + (v_prod.price + v_mods_total) * v_qty;
      end if;
    end loop;
    delete from order_items where order_id = v_o.id and id <> all(v_keep);
  else
    v_sub := v_o.subtotal;
  end if;

  v_type  := coalesce(nullif(p->>'order_type', '')::order_type, v_o.order_type);
  v_table := case when p ? 'table_id' then nullif(p->>'table_id', '')::uuid else v_o.table_id end;
  if v_type <> 'dine_in' then v_table := null; end if;
  if v_type = 'dine_in' and v_table is null then raise exception 'table required'; end if;
  v_disc := least(greatest(coalesce((p->>'discount')::numeric, v_o.discount), 0), v_sub);

  update orders set
    order_type      = v_type,
    table_id        = v_table,
    notes           = case when p ? 'notes' then nullif(trim(coalesce(p->>'notes', '')), '') else notes end,
    status          = v_status,
    subtotal        = v_sub,
    discount        = v_disc,
    total           = v_sub - v_disc,
    payment_method  = case when v_paid and p ? 'payment_method' then (p->>'payment_method')::pay_method else payment_method end,
    amount_tendered = case when v_paid and p ? 'amount_tendered' then (p->>'amount_tendered')::numeric else amount_tendered end,
    edited_at       = now()
  where id = v_o.id;

  -- أوردر مدفوع اتعدلت أصنافه → اخصم المخزون من جديد
  if v_paid and v_has_items and v_status = 'completed' then
    perform public._deduct_order_stock(v_o.id, 'تعديل أدمن · أوردر #' || v_o.order_no);
  end if;

  insert into order_edits (order_id, edited_by, before, after)
  values (v_o.id, auth.uid(), v_before, public._order_snapshot(v_o.id));
end $$;

-- ---------------------------------------------------------------------
-- 9) الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function public._main_warehouse()                          from public, anon, authenticated;
revoke all on function public._wh_add(uuid, uuid, numeric)               from public, anon, authenticated;
revoke all on function public._ingredient_initial_stock()                from public, anon, authenticated;
revoke all on function public._order_snapshot(uuid)                      from public, anon, authenticated;
revoke all on function public._deduct_order_stock(uuid, text)            from public, anon, authenticated;
revoke all on function public._restore_order_stock(uuid, text)           from public, anon, authenticated;

revoke all on function public.pay_order(uuid, pay_method, numeric, numeric)                         from public, anon;
revoke all on function public.record_inventory_tx(uuid, inv_tx_type, numeric, text, uuid)           from public, anon;
revoke all on function public.transfer_stock(uuid, uuid, uuid, numeric, text)                       from public, anon;
revoke all on function public.create_withdrawal(uuid, jsonb, text)                                  from public, anon;
revoke all on function public.settle_withdrawal(uuid, jsonb, boolean)                               from public, anon;
revoke all on function public.admin_edit_order(jsonb)                                               from public, anon;
grant execute on function public.pay_order(uuid, pay_method, numeric, numeric)                      to authenticated;
grant execute on function public.record_inventory_tx(uuid, inv_tx_type, numeric, text, uuid)        to authenticated;
grant execute on function public.transfer_stock(uuid, uuid, uuid, numeric, text)                    to authenticated;
grant execute on function public.create_withdrawal(uuid, jsonb, text)                               to authenticated;
grant execute on function public.settle_withdrawal(uuid, jsonb, boolean)                            to authenticated;
grant execute on function public.admin_edit_order(jsonb)                                            to authenticated;

alter table public.warehouses              enable row level security;
alter table public.warehouse_stock         enable row level security;
alter table public.stock_withdrawals       enable row level security;
alter table public.stock_withdrawal_items  enable row level security;
alter table public.stock_usage             enable row level security;
alter table public.order_edits             enable row level security;

-- المخازن: كل الموظفين يقروا (الكاشير محتاج يختار مخزن)، الأدمن بس يكتب.
create policy warehouses_read  on public.warehouses for select to authenticated using (current_app_role() is not null);
create policy warehouses_admin on public.warehouses for all    to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

-- أرصدة المخازن والسحوبات: أدمن + كاشير يقروا. الكتابة عن طريق الدوال بس.
create policy warehouse_stock_read on public.warehouse_stock        for select to authenticated using (current_app_role() in ('admin', 'cashier'));
create policy withdrawals_read     on public.stock_withdrawals      for select to authenticated using (current_app_role() in ('admin', 'cashier'));
create policy withdrawal_items_read on public.stock_withdrawal_items for select to authenticated using (current_app_role() in ('admin', 'cashier'));
create policy stock_usage_admin_read on public.stock_usage          for select to authenticated using (current_app_role() = 'admin');
create policy order_edits_admin_read on public.order_edits          for select to authenticated using (current_app_role() = 'admin');

-- الكاشير يشوف أسماء الخامات ووحداتها عشان يعمل سحب.
create policy ingredients_cashier_read on public.ingredients for select to authenticated using (current_app_role() = 'cashier');
