-- Verifikim i llogarisë me kod 6-shifror (nga admin) + kërkesa për abonim VIP.

-- 1) Kolonat e reja te profiles: statusi i verifikimit + kodi i qasjes (6-shifror).
alter table public.profiles
  add column if not exists is_verified boolean not null default false,
  add column if not exists access_code text;

-- 2) Përdoruesit EKZISTUES: mos i blloko — konsiderohen të verifikuar.
update public.profiles set is_verified = true where is_verified = false;

-- 3) Tabela e kërkesave për VIP (useri dërgon kërkesë, admini e aprovon).
create table if not exists public.vip_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',   -- pending | approved | rejected
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists vip_requests_status_idx on public.vip_requests(status, created_at desc);
alter table public.vip_requests enable row level security;

-- RLS: useri sheh/krijon vetëm kërkesat e VETA. Admini i menaxhon nga edge function (service role → anashkalon RLS).
drop policy if exists vip_requests_own_select on public.vip_requests;
create policy vip_requests_own_select on public.vip_requests for select using (auth.uid() = user_id);
drop policy if exists vip_requests_own_insert on public.vip_requests;
create policy vip_requests_own_insert on public.vip_requests for insert with check (auth.uid() = user_id);

-- 4) Trigger-i i regjistrimit: gjeneron kod 6-shifror + is_verified=false për regjistrimet e reja.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, username, is_admin, subscription_tier, balance, created_at, updated_at, is_verified, access_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    false,
    'free',
    0,
    now(),
    now(),
    false,                                                   -- regjistrimet e reja: TË PAVERIFIKUARA
    lpad((floor(random() * 1000000))::int::text, 6, '0')     -- kod qasjeje 6-shifror
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
