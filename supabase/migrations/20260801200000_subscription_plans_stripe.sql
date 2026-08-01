-- ABONIMI: provë falas 15 ditë · mujor 69€ · vjetor 699€ (në vend të 828€). Pagesa me Stripe.
alter table public.profiles
  add column if not exists subscription_status text not null default 'none',   -- none|trialing|active|past_due|canceled|expired
  add column if not exists trial_ends_at timestamptz,
  add column if not exists subscription_started_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create index if not exists profiles_stripe_customer_idx on public.profiles(stripe_customer_id);
create index if not exists profiles_stripe_sub_idx on public.profiles(stripe_subscription_id);

-- Përdoruesit EKZISTUES: mos i blloko — trajtohen si aktivë (grandfathered).
update public.profiles set subscription_status = 'active'
where subscription_status = 'none' and subscription_tier in ('free','premium','pro','elite');

-- Audit i ngjarjeve nga Stripe (idempotencë + gjurmë).
create table if not exists public.subscription_events (
  id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.subscription_events enable row level security;

-- Regjistrimi i ri: pa plan të zgjedhur ende (shfaqet tabela e planeve pas "Krijo llogari").
create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare bd date;
begin
  bd := nullif(new.raw_user_meta_data->>'birth_date','')::date;
  if bd is not null and bd > (current_date - interval '18 years') then
    raise exception 'under_18';
  end if;
  insert into public.profiles (id, full_name, username, is_admin, subscription_tier, subscription_status,
                               balance, created_at, updated_at, is_verified, access_code,
                               first_name, last_name, birth_date, phone, address, country)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    false, 'none', 'none', 0, now(), now(), false,
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

-- Skadimi automatik: prova/abonimi i mbaruar → status 'expired'.
create or replace function public.expire_subscriptions() returns void
language sql security definer set search_path = public as $$
  update public.profiles
     set subscription_status = 'expired'
   where subscription_status in ('trialing','active')
     and coalesce(subscription_expires_at, trial_ends_at) is not null
     and coalesce(subscription_expires_at, trial_ends_at) < now();
$$;
