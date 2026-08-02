-- SISTEMI I EMAIL-EVE (Resend) — 2 gusht 2026
--
-- Deri tani platforma NUK dërgonte asnjë email: kodi i verifikimit i jepej përdoruesit
-- me dorë nga Admini dhe nuk ekzistonte fare rikthimi i fjalëkalimit.
--
-- Struktura ndjek pikërisht modelin e pagesave:
--   email_config  → të dhënat e dukshme (dërguesi, emri, reply-to, cilat email-e janë aktive)
--   email_secrets → çelësi i Resend (RLS PA ASNJË politikë → e lexon vetëm service-role
--                   brenda edge functions; admini e vendos me RPC, s'e lexon dot kurrë)
--   email_log     → çdo email i dërguar (ose i dështuar) me arsyen — dukshmëri për adminin

create table if not exists public.email_config (
  id           int primary key default 1 check (id = 1),
  from_name    text not null default 'GoldSniper',
  from_email   text not null default 'no-reply@goldsniper.vip',
  reply_to     text not null default 'support@goldsniper.vip',
  -- Ndezje/fikje për çdo lloj email-i (asnjë rilëshim kodi nuk duhet për t'i ndryshuar).
  send_verify  boolean not null default true,
  send_reset   boolean not null default true,
  send_welcome boolean not null default true,
  send_billing boolean not null default true,
  send_expiry  boolean not null default true,
  updated_at   timestamptz not null default now()
);
insert into public.email_config (id) values (1) on conflict (id) do nothing;

alter table public.email_config enable row level security;
create policy ec_admin_read on public.email_config for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
create policy ec_admin_write on public.email_config for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create table if not exists public.email_secrets (
  id              int primary key default 1 check (id = 1),
  resend_api_key  text,
  updated_at      timestamptz not null default now()
);
insert into public.email_secrets (id) values (1) on conflict (id) do nothing;
alter table public.email_secrets enable row level security;
-- ASNJË politikë → as admini s'e lexon dot çelësin nga klienti; vetëm service-role.

create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  template   text not null,
  subject    text not null,
  status     text not null default 'sent',   -- sent | failed | skipped
  error      text,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists email_log_created_idx on public.email_log (created_at desc);

alter table public.email_log enable row level security;
create policy el_admin_read on public.email_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- Admini e VENDOS çelësin (pa e lexuar dot kurrë të plotë).
create or replace function public.admin_set_resend_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  update public.email_secrets
     set resend_api_key = coalesce(nullif(trim(p_key), ''), resend_api_key),
         updated_at = now()
   where id = 1;
end;
$$;

revoke all on function public.admin_set_resend_key(text) from public;
grant execute on function public.admin_set_resend_key(text) to authenticated;

-- Statusi i lidhjes pa e ekspozuar çelësin: a ekziston + 4 shenjat e fundit + statistika.
create or replace function public.admin_email_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare k text; v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  select resend_api_key into k from public.email_secrets where id = 1;
  select jsonb_build_object(
    'configured', (k is not null and length(trim(k)) > 0),
    'last4',      case when k is not null and length(k) >= 4 then right(k, 4) else null end,
    'sent_7d',    (select count(*) from public.email_log where status='sent'   and created_at > now() - interval '7 days'),
    'failed_7d',  (select count(*) from public.email_log where status='failed' and created_at > now() - interval '7 days')
  ) into v;
  return v;
end;
$$;

revoke all on function public.admin_email_status() from public;
grant execute on function public.admin_email_status() to authenticated;
