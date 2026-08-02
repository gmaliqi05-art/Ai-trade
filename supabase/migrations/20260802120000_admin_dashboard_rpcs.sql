-- RISTRUKTURIMI I ADMIN-it (2 gusht 2026)
-- 1) admin_dashboard_stats(): raportet e reja të Përmbledhjes — abonimet sipas planit
--    + raporti i sinjaleve GoldSniperFX (nga rreshtat e llogarisë PRONARE të feed-it).
-- 2) admin_metaapi_overview(): faqja e re MetaTrader — lidhjet REALE MT5 nga metaapi_config
--    (tabela e vjetër metatrader_connections ka 0 rreshta). Token-at NUK ekspozohen kurrë —
--    kthehet vetëm 'ka token: po/jo'.

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'subs', (
      select jsonb_build_object(
        'trial',       count(*) filter (where subscription_tier = 'trial'   and subscription_status in ('trialing','active')),
        'monthly',     count(*) filter (where subscription_tier = 'monthly' and subscription_status = 'active'),
        'yearly',      count(*) filter (where subscription_tier = 'yearly'  and subscription_status = 'active'),
        'expiring_7d', count(*) filter (where subscription_status in ('trialing','active')
                                         and subscription_expires_at is not null
                                         and subscription_expires_at < now() + interval '7 days'),
        'inactive',    count(*) filter (where coalesce(subscription_status,'none') in ('none','expired','canceled'))
      )
      from public.profiles where coalesce(is_admin, false) = false
    ),
    'gsf', (
      select jsonb_build_object(
        'total',  count(*),
        'tp1',    count(*) filter (where coalesce(tp_hit,0) >= 1),
        'tp2',    count(*) filter (where coalesce(tp_hit,0) >= 2),
        'tp3',    count(*) filter (where coalesce(tp_hit,0) >= 3),
        'tp4',    count(*) filter (where coalesce(tp_hit,0) >= 4),
        'sl',     count(*) filter (where status = 'closed' and coalesce(tp_hit,0) = 0),
        'last7d', count(*) filter (where created_at > now() - interval '7 days')
      )
      from public.telegram_signals
      where user_id = public.goldsniper_owner() and kind = 'entry' and status <> 'ignored'
    )
  ) into v;
  return v;
end;
$$;

create or replace function public.admin_metaapi_overview()
returns table (
  user_id uuid, username text, full_name text, mode text, region text,
  auto_trade boolean, kill_switch boolean, has_account boolean, has_token boolean,
  last_connected_at timestamptz, disconnect_since timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  select m.user_id, p.username, p.full_name, m.mode, m.region,
         coalesce(m.auto_trade, false), coalesce(m.kill_switch, false),
         (m.account_id is not null and m.account_id <> ''),
         (m.token is not null and m.token <> ''),
         m.last_connected_at, m.disconnect_since, m.updated_at
  from public.metaapi_config m
  left join public.profiles p on p.id = m.user_id
  order by m.updated_at desc nulls last;
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
revoke all on function public.admin_metaapi_overview() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_metaapi_overview() to authenticated;
