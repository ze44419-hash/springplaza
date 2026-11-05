-- 017 — تحسينات أداء (من فحص التعقيد الزمني). آمن لو اتشغّل مرتين. شغّله بعد 016.

-- 1) فهرس على تاريخ الحجز (نطاق الشهر + الحجوزات القادمة + فحص الفترة في نفس اليوم)
create index if not exists hall_bookings_event_date_active_idx
  on public.hall_bookings (event_date) where status <> 'cancelled';

-- 2) فهرس GIN على slots بيزوّد تكلفة الكتابة بس (الفحص بيبدأ بـ event_date)
drop index if exists public.hall_bookings_slots_idx;

-- 3) فهرس على الخامة في بنود السحب (الخصم من السحوبات المفتوحة بيدوّر بالخامة)
create index if not exists stock_withdrawal_items_ingredient_idx
  on public.stock_withdrawal_items (ingredient_id);

-- 4) _restore_order_stock: تجميع لكل خامة/مصدر بدل update + select لكل صف في stock_usage
create or replace function public._restore_order_stock(p_order uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  -- سطر واحد في السجل لكل خامة
  insert into inventory_transactions (ingredient_id, type, qty_change, created_by, note)
  select ingredient_id, 'adjustment', sum(qty), auth.uid(), coalesce(p_note, 'استرجاع مخزون أوردر')
    from stock_usage where order_id = p_order group by ingredient_id;

  -- رصيد الخامة: update واحد لكل خامة
  update ingredients i set stock_qty = i.stock_qty + t.q
    from (select ingredient_id, sum(qty) q from stock_usage where order_id = p_order group by ingredient_id) t
   where i.id = t.ingredient_id;

  -- بنود السحب: update واحد لكل بند (السحب المفتوح: رجّع qty_used بس / المقفول: إرجاع متأخر للمخزن)
  for u in
    select su.withdrawal_item_id, su.ingredient_id, sum(su.qty) as qty, sw.status, sw.warehouse_id
      from stock_usage su
      join stock_withdrawal_items wi on wi.id = su.withdrawal_item_id
      join stock_withdrawals sw on sw.id = wi.withdrawal_id
     where su.order_id = p_order
     group by su.withdrawal_item_id, su.ingredient_id, sw.status, sw.warehouse_id
  loop
    if u.status = 'open' then
      update stock_withdrawal_items set qty_used = qty_used - u.qty where id = u.withdrawal_item_id;
    else
      update stock_withdrawal_items set qty_used = qty_used - u.qty, qty_returned = qty_returned + u.qty where id = u.withdrawal_item_id;
      perform public._wh_add(u.warehouse_id, u.ingredient_id, u.qty);
    end if;
  end loop;

  -- الخصم اللي اتعمل من المخزن الرئيسي مباشرة
  for u in
    select warehouse_id, ingredient_id, sum(qty) as qty from stock_usage
     where order_id = p_order and withdrawal_item_id is null group by warehouse_id, ingredient_id
  loop
    perform public._wh_add(u.warehouse_id, u.ingredient_id, u.qty);
  end loop;

  delete from stock_usage where order_id = p_order;
end $$;
revoke all on function public._restore_order_stock(uuid, text) from public, anon, authenticated;
