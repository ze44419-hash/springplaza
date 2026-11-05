-- بيانات تجريبية (اختيارية) — تجاهلها في الإنتاج.
insert into public.cafe_tables (label, sort_order)
  select g::text, g from generate_series(1, 12) g on conflict do nothing;      -- تظهر في التطبيق "طاولة 1 … طاولة 12"

insert into public.categories (name, sort_order) values
  ('مشروبات ساخنة', 1), ('مشروبات باردة', 2), ('حلويات', 3), ('سناكس', 4) on conflict do nothing;

insert into public.modifiers (name, price_delta) values
  ('سكر زيادة', 0), ('بدون سكر', 0), ('بدون فوم', 0), ('شوت زيادة', 15), ('حليب شوفان', 10) on conflict do nothing;

insert into public.ingredients (name, unit, stock_qty, min_threshold, supplier) values
  ('بن', 'g', 5000, 1000, 'محمصة الأمير'),
  ('سكر', 'g', 8000, 1500, 'الجملة'),
  ('حليب', 'ml', 20000, 4000, 'شركة الألبان'),
  ('ثلج', 'g', 10000, 2000, null),
  ('صوص شوكولاتة', 'ml', 3000, 500, 'الجملة')
  on conflict do nothing;

do $$
declare
  hot uuid := (select id from categories where name = 'مشروبات ساخنة');
  cold uuid := (select id from categories where name = 'مشروبات باردة');
  des uuid := (select id from categories where name = 'حلويات');
  p_turkish uuid; p_latte uuid; p_iced uuid; p_brownie uuid;
begin
  insert into products (category_id, name, price, sort_order) values (hot, 'قهوة تركي', 40, 1) returning id into p_turkish;
  insert into products (category_id, name, price, sort_order) values (hot, 'لاتيه', 65, 2) returning id into p_latte;
  insert into products (category_id, name, price, sort_order) values (cold, 'آيس لاتيه', 70, 1) returning id into p_iced;
  insert into products (category_id, name, price, sort_order) values (des, 'براوني', 55, 1) returning id into p_brownie;

  insert into recipes (product_id, ingredient_id, qty_per_unit) values
    (p_turkish, (select id from ingredients where name = 'بن'), 10),
    (p_turkish, (select id from ingredients where name = 'سكر'), 20),
    (p_latte,   (select id from ingredients where name = 'بن'), 18),
    (p_latte,   (select id from ingredients where name = 'حليب'), 200),
    (p_iced,    (select id from ingredients where name = 'بن'), 18),
    (p_iced,    (select id from ingredients where name = 'حليب'), 180),
    (p_iced,    (select id from ingredients where name = 'ثلج'), 150),
    (p_brownie, (select id from ingredients where name = 'صوص شوكولاتة'), 30);
end $$;
