-- SISTEMI I PAGESAVE & PLANEVE (Admin) — 2 gusht 2026
-- Burim i VETËM i së vërtetës për çmimet dhe pagesat:
--   billing_config  → çmimet e planeve + kripto-pagesat (lexohet nga regjistrimi,
--                     cilësimet e përdoruesit DHE stripe-checkout → gjithçka e sinkronizuar)
--   billing_secrets → çelësat e Stripe (RLS pa ASNJË politikë → i lexon vetëm service-role
--                     në edge functions; admini i vendos përmes RPC-ve të mbrojtura)

create table if not exists public.billing_config (
  id int primary key default 1 check (id = 1),
  trial_days int not null default 15 check (trial_days between 0 and 365),
  monthly_eur numeric not null default 69 check (monthly_eur >= 0),
  yearly_eur numeric not null default 699 check (yearly_eur >= 0),
  yearly_full_eur numeric not null default 828 check (yearly_full_eur >= 0),
  crypto_enabled boolean not null default false,
  crypto_note text not null default '',
  crypto_wallets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.billing_config (id) values (1) on conflict (id) do nothing;

alter table public.billing_config enable row level security;
create policy bc_read on public.billing_config for select to authenticated using (true);
create policy bc_admin_write on public.billing_config for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create table if not exists public.billing_secrets (
  id int primary key default 1 check (id = 1),
  stripe_secret_key text,
  stripe_webhook_secret text,
  updated_at timestamptz not null default now()
);
insert into public.billing_secrets (id) values (1) on conflict (id) do nothing;
alter table public.billing_secrets enable row level security;
-- ASNJË politikë → asnjë klient (as admini) s'i lexon dot direkt; vetëm service-role.

-- Admini i VENDOS çelësat (pa i lexuar dot kurrë të plotë).
create or replace function public.admin_set_stripe_keys(p_secret text default null, p_webhook text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  update public.billing_secrets set
    stripe_secret_key    = coalesce(nullif(trim(p_secret), ''), stripe_secret_key),
    stripe_webhook_secret = coalesce(nullif(trim(p_webhook), ''), stripe_webhook_secret),
    updated_at = now()
  where id = 1;
end;
$$;

-- Statusi (pa e ekspozuar çelësin): a ekziston + lloji + 4 shenjat e fundit.
create or replace function public.admin_stripe_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  select * into r from public.billing_secrets where id = 1;
  return jsonb_build_object(
    'has_secret',  r.stripe_secret_key is not null and r.stripe_secret_key <> '',
    'secret_hint', case when r.stripe_secret_key is null or r.stripe_secret_key = '' then null
                        else left(r.stripe_secret_key, 8) || '…' || right(r.stripe_secret_key, 4) end,
    'has_webhook', r.stripe_webhook_secret is not null and r.stripe_webhook_secret <> '',
    'updated_at',  r.updated_at
  );
end;
$$;

revoke all on function public.admin_set_stripe_keys(text, text) from public;
revoke all on function public.admin_stripe_status() from public;
grant execute on function public.admin_set_stripe_keys(text, text) to authenticated;
grant execute on function public.admin_stripe_status() to authenticated;
