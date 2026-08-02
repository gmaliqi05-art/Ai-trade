-- ROLI "OPERATOR GoldSniperFX" — qasje e KUFIZUAR vetëm te konsola GoldSniperFX.
--
-- Kërkesa e pronarit (2 gusht 2026): bashkëpronari/partneri teknik duhet ta mbikëqyrë
-- feed-in dhe kanalin gjatë gjithë kohës, por PA marrë dashboard-in e plotë të adminit.
--
-- Zgjidhja: një flamur i ri 'profiles.is_gs_operator'. Politikat dhe RPC-të që lidhen
-- VETËM me GoldSniperFX pranojnë tani "admin OSE operator"; çdo gjë tjetër e adminit
-- (përdoruesit, pagesat, planet, audit-i, njoftimet…) mbetet e mbyllur si më parë.

alter table public.profiles
  add column if not exists is_gs_operator boolean not null default false;

comment on column public.profiles.is_gs_operator is
  'Qasje vetëm te konsola GoldSniperFX (pa dashboard-in e plotë të adminit).';

-- Ndihmësi: admin OSE operator. SECURITY DEFINER që të mos ndeshet me RLS-në e profiles.
create or replace function public.is_gs_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.is_admin = true or p.is_gs_operator = true)
  );
$$;

revoke all on function public.is_gs_staff() from public;
grant execute on function public.is_gs_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- POLITIKAT — zëvendësojnë kontrollin "is_admin" me "is_gs_staff()".
-- Politikat e pronarit (auth.uid() = user_id) mbeten të paprekura.
-- ---------------------------------------------------------------------------

drop policy if exists gsc_admin on public.gold_sniper_config;
create policy gsc_admin on public.gold_sniper_config
  for all using (public.is_gs_staff()) with check (public.is_gs_staff());

drop policy if exists tg_cfg_admin on public.telegram_sin_config;
create policy tg_cfg_admin on public.telegram_sin_config
  for all using (public.is_gs_staff()) with check (public.is_gs_staff());

drop policy if exists mbl_admin_read on public.message_block_log;
create policy mbl_admin_read on public.message_block_log
  for select using (public.is_gs_staff());

drop policy if exists sal_admin_read on public.signal_ai_log;
create policy sal_admin_read on public.signal_ai_log
  for select using (public.is_gs_staff());

-- ---------------------------------------------------------------------------
-- RPC-të e konsolës GoldSniperFX — i njëjti zgjerim.
-- ---------------------------------------------------------------------------

create or replace function public.admin_block_stats(days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_gs_staff() then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.message_block_log where created_at > now() - (days || ' days')::interval),
    'by_reason', coalesce((select jsonb_object_agg(reason, n) from (
        select reason, count(*) n from public.message_block_log
        where created_at > now() - (days || ' days')::interval group by reason) x), '{}'::jsonb),
    'ai_total', (select count(*) from public.signal_ai_log where created_at > now() - (days || ' days')::interval),
    'ai_applied', (select count(*) from public.signal_ai_log
        where created_at > now() - (days || ' days')::interval and text_out is not null)
  ) into v;
  return v;
end;
$$;

create or replace function public.admin_others_state(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_signals_on boolean;
  v_mmt_active boolean;
  v_mmt_owner  uuid;
begin
  if not public.is_gs_staff() then
    raise exception 'forbidden';
  end if;

  select not coalesce(m.kill_switch, false) into v_signals_on
    from public.metaapi_config m where m.user_id = target;
  select c.active, c.live_user_id into v_mmt_active, v_mmt_owner
    from public.mmt_config c where c.id = 1;

  return jsonb_build_object(
    'signalsOn',      coalesce(v_signals_on, true),
    'mmtOn',          coalesce(v_mmt_active, false),
    'mmtControllable', (v_mmt_owner is not null and v_mmt_owner = target),
    'hasAccount',     exists (select 1 from public.metaapi_config m where m.user_id = target)
  );
end;
$$;

create or replace function public.admin_set_others(target uuid, turn_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_gs_staff() then
    raise exception 'forbidden';
  end if;

  update public.metaapi_config
     set kill_switch = not turn_on, updated_at = now()
   where user_id = target;

  update public.mmt_config
     set active = turn_on
   where id = 1 and live_user_id = target;
end;
$$;

-- Emri i llogarisë pronare për titullin e konsolës. RLS-ja e 'profiles' lejon vetëm
-- rreshtin e vet, prandaj etiketa lexohet me këtë funksion (jo me select të drejtpërdrejtë).
create or replace function public.goldsniper_owner_name()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(nullif(p.full_name, ''), p.username, p.id::text)
    from public.profiles p
   where public.is_gs_staff()
     and p.id = public.goldsniper_owner();
$$;

revoke all on function public.goldsniper_owner_name() from public;
grant execute on function public.goldsniper_owner_name() to authenticated;

-- ---------------------------------------------------------------------------
-- KODI SEKRET i hyrjes në konsolë (kyç i dytë në ndërfaqe).
-- Ruhet në server që të MOS jetë i shkruar brenda kodit të faqes dhe të mund
-- të ndërrohet pa rilëshim të aplikacionit.
-- ---------------------------------------------------------------------------

create table if not exists public.gs_operator_access (
  id         integer primary key default 1,
  code       text not null,
  updated_at timestamptz not null default now(),
  constraint gs_operator_access_one_row check (id = 1)
);

-- Pa asnjë politikë RLS → askush nuk e lexon dot nga klienti; vetëm funksionet
-- SECURITY DEFINER dhe service-role e prekin.
alter table public.gs_operator_access enable row level security;

insert into public.gs_operator_access (id, code) values (1, '2018')
on conflict (id) do nothing;

create or replace function public.gs_operator_unlock(in_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.gs_operator_access a
     where a.id = 1
       and a.code = btrim(in_code)
       and public.is_gs_staff()
  );
$$;

revoke all on function public.gs_operator_unlock(text) from public;
grant execute on function public.gs_operator_unlock(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Partneri teknik / bashkëpronari.
-- ---------------------------------------------------------------------------

update public.profiles p
   set is_gs_operator = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'belhaid.geci99@hotmail.com';
