-- Bootstrap the FIRST admin (one time only).
-- 1) Supabase Dashboard → Authentication → Users → "Add user" (email + password, auto-confirm).
-- 2) Replace the email below and run this script. All other accounts are then created from the Admin dashboard.
insert into public.profiles (id, full_name, role)
select id, 'المالك', 'admin' from auth.users where email = 'owner@springplaza.cafe'
on conflict (id) do update set role = 'admin', is_active = true;

-- Lets the middleware authorise this admin without a database round-trip (faster page loads).
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin', 'active', true)
where email = 'owner@springplaza.cafe';
