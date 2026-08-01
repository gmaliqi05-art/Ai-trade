-- Fushat e reja të profilit (regjistrimi i zgjeruar): emri/mbiemri, datëlindja (18+),
-- telefoni, adresa e banimit, shteti.
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists birth_date date,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists country text;

-- Trigger-i i regjistrimit: kopjon fushat e reja nga metadata + ZBATON moshën 18+ NË SERVER
-- (mbrojtje edhe nëse dikush e anashkalon kontrollin e klientit).
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  bd date;
begin
  bd := nullif(new.raw_user_meta_data->>'birth_date','')::date;
  if bd is not null and bd > (current_date - interval '18 years') then
    raise exception 'under_18';
  end if;
  insert into public.profiles (id, full_name, username, is_admin, subscription_tier, balance, created_at, updated_at,
                               is_verified, access_code, first_name, last_name, birth_date, phone, address, country)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    false,
    'free',
    0,
    now(),
    now(),
    false,
    lpad((floor(random() * 1000000))::int::text, 6, '0'),
    nullif(new.raw_user_meta_data->>'first_name',''),
    nullif(new.raw_user_meta_data->>'last_name',''),
    bd,
    nullif(new.raw_user_meta_data->>'phone',''),
    nullif(new.raw_user_meta_data->>'address',''),
    nullif(new.raw_user_meta_data->>'country','')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
