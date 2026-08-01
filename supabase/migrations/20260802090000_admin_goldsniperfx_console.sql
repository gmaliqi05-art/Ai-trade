-- KONSOLA ADMIN "GoldSniperFX"
-- Nënfaqet e infrastrukturës (publikimi te kanali, lidhja me Telegram, parametrat e
-- parazgjedhur, robotët e tjerë) hiqen nga faqja e përdoruesit dhe kalojnë te Admin.
--
-- Feed-i i GoldSniperFX i takon llogarisë PRONARE (ajo që ka gold_sniper_config.channel_id) —
-- jo llogarisë admin. Prandaj admini duhet të lexojë/shkruajë RRESHTIN E PRONARIT.
-- RLS ekzistuese (auth.uid() = user_id) MBETET e paprekur; shtohen vetëm politika ADMIN mbi të.

-- ---------- 1) Politika ADMIN mbi tabelat e konfigurimit ----------
-- I njëjti model si 'mmt_config_admin_write' që ekziston tashmë.

drop policy if exists gsc_admin on public.gold_sniper_config;
create policy gsc_admin on public.gold_sniper_config
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists gsp_admin on public.gold_sniper_posts;
create policy gsp_admin on public.gold_sniper_posts
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists tg_cfg_admin on public.telegram_sin_config;
create policy tg_cfg_admin on public.telegram_sin_config
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- ---------- 2) Pronari i feed-it GoldSniperFX ----------
-- E njëjta logjikë si te 'platform-poll': rreshti me channel_id jo-null.
create or replace function public.goldsniper_owner()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.user_id
    from public.gold_sniper_config c
   where c.channel_id is not null and c.channel_id <> ''
   order by c.updated_at desc nulls last
   limit 1;
$$;

revoke all on function public.goldsniper_owner() from public;
grant execute on function public.goldsniper_owner() to authenticated;

-- ---------- 3) "Robotët e tjerë" për pronarin, pa ekspozuar token-at e MetaApi ----------
-- metaapi_config përmban token-in e brokerit; prandaj NUK zgjerojmë RLS mbi të.
-- Në vend të kësaj, dy funksione SECURITY DEFINER që lexojnë/shkruajnë vetëm fushën kill_switch.

create or replace function public.admin_others_state(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_signals_on boolean;
  v_mmt_active boolean;
  v_mmt_owner  uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
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
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
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

revoke all on function public.admin_others_state(uuid) from public;
revoke all on function public.admin_set_others(uuid, boolean) from public;
grant execute on function public.admin_others_state(uuid) to authenticated;
grant execute on function public.admin_set_others(uuid, boolean) to authenticated;
