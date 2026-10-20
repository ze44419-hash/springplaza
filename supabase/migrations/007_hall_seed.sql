-- (اختياري) بيانات تجريبية للقاعة — الأسعار أمثلة، عدّلها من شاشة «الأسعار والخدمات».
insert into public.hall_rates (name, price, sort_order) values
  ('إيجار القاعة — مناسبة نهارية', 5000, 1),
  ('إيجار القاعة — مناسبة مسائية', 8000, 2)
on conflict (name) do nothing;

insert into public.hall_services (kind, name, price, unit_label, sort_order) values
  ('dish',  'وجبة فراخ مشوية',        120, 'فرد',  1),
  ('dish',  'وجبة لحم',               180, 'فرد',  2),
  ('dish',  'بوفيه حلويات',            35, 'فرد',  3),
  ('extra', 'ديكور أساسي',           1500, 'خدمة', 1),
  ('extra', 'إضاءة وإنارة خاصة',      1000, 'خدمة', 2),
  ('extra', 'دي جي',                 2500, 'خدمة', 3),
  ('extra', 'شوك وسكاكين وأدوات مائدة', 8, 'فرد',  4)
on conflict (kind, name) do nothing;
