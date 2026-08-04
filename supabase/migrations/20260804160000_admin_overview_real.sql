-- BALLINA E ADMINIT — RAPORTE TË VËRTETA (4 gusht 2026)
--
-- Ankesa e pronarit, me të drejtë: ballina tregonte gjashtë karta të mëdha ku pesë prej tyre lexonin
-- "0". Nuk ishte çështje stili — ishte çështje burimi. 'get_admin_stats' lexonte tabelat E VJETRA:
--
--   • 'trades'  → 0 rreshta. E gjithë tregtia reale rri te 'position_closes' dhe 'telegram_trades'.
--   • 'assets'  → 19 rreshta, të cilët dilnin si "19 aktive të listuara" nën "Sinjale aktive: 0".
--   • 'signals' me status='active' → 0, sepse sinjalet e sotme nuk e përdorin atë kolonë.
--
-- Dhe çelësat 'executions', 'aiCostMonth', 'metaCallsMonth' nuk ktheheshin FARE nga RPC-ja — fronti
-- binte te vlerat bosh dhe shfaqte zero. Pra kartat nuk ishin "të zbrazëta"; ishin të pavërteta.
--
-- Këtu ndërtohen dy funksione mbi tabelat që kanë vërtet të dhëna:
--   1) admin_overview_v2()      — gjendja e platformës, me seri 30-ditore për grafikun
--   2) admin_user_performance() — një rresht për përdorues, me serinë e vet për grafikun e vogël
--
-- Asnjë shifër nuk trillohet. Kur diçka është zero, është zero e vërtetë.

-- ---------- 1) PËRMBLEDHJA ----------
create or replace function public.admin_overview_v2(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_days integer := greatest(least(coalesce(p_days, 30), 180), 7);
        v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'days', v_days,

    -- KUSH JANË. 'connected' = ka vërtet kredenciale, jo thjesht një rresht bosh konfigurimi.
    'users', jsonb_build_object(
      'total',      (select count(*) from public.profiles),
      'connected',  (select count(*) from public.metaapi_config
                      where coalesce(account_id,'') <> '' and coalesce(token,'') <> ''),
      'auto_trade', (select count(*) from public.metaapi_config where auto_trade),
      'new_7d',     (select count(*) from public.profiles where created_at >= now() - interval '7 days')
    ),

    -- PARATË. 'expiring_7d' është i vetmi numër këtu që kërkon veprim brenda javës.
    'subs', jsonb_build_object(
      'active',      (select count(*) from public.profiles where subscription_expires_at > now()),
      'trial',       (select count(*) from public.profiles where trial_ends_at > now()),
      'expiring_7d', (select count(*) from public.profiles
                        where subscription_expires_at between now() and now() + interval '7 days'),
      'expired',     (select count(*) from public.profiles
                        where subscription_expires_at is not null and subscription_expires_at <= now())
    ),

    -- REZULTATI REAL i të gjithë përdoruesve së bashku. Nëse del negativ, del negativ.
    'trading', jsonb_build_object(
      'closed',  (select count(*)      from public.position_closes where closed_at >= now() - make_interval(days => v_days)),
      'net',     (select round(coalesce(sum(net),0)::numeric, 2)    from public.position_closes where closed_at >= now() - make_interval(days => v_days)),
      'wins',    (select count(*)      from public.position_closes where closed_at >= now() - make_interval(days => v_days) and net > 0),
      'lots',    (select round(coalesce(sum(volume),0)::numeric, 2) from public.position_closes where closed_at >= now() - make_interval(days => v_days)),
      'traders', (select count(distinct user_id) from public.position_closes where closed_at >= now() - make_interval(days => v_days))
    ),

    -- NGA VJEN REZULTATI — ndarja sipas burimit.
    --
    -- Ky bllok doli gjatë verifikimit dhe është përgjigjja e drejtpërdrejtë e pyetjes "përdoruesit
    -- thonë se po humbin": në 30 ditë, tregtimi ME DORË kishte 358 tregti me -1251$, ndërsa sinjalet
    -- 6 tregti me +292$. Pa këtë ndarje të dyja shkrihen në një shifër të vetme negative, dhe faji
    -- bie te sinjalet. Etiketat vijnë ashtu siç i shkruajnë robotët; nuk grupohen me hamendje.
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'label', burimi, 'manual', is_man, 'n', n, 'wins', w,
               'net', round(net::numeric, 2)) order by n desc), '[]'::jsonb)
      from (
        select coalesce(pc.robot, 'Me dorë') as burimi,
               (pc.robot is null)            as is_man,
               count(*)                      as n,
               count(*) filter (where pc.net > 0) as w,
               coalesce(sum(pc.net), 0)      as net
        from public.position_closes pc
        where pc.closed_at >= now() - make_interval(days => v_days)
        group by 1, 2
      ) q
    ),

    -- SINJALET. I njëjti klasifikim si te auditimi: dalja krahasohet me TP/SL që vendosi roboti.
    -- 'manual' = doli larg të dyve → dikush e mbylli vetë ose lëvizi nivelet.
    'signals', (
      select jsonb_build_object(
        'sent',   count(*),
        'tp',     count(*) filter (where o = 'tp'),
        'sl',     count(*) filter (where o = 'sl'),
        'manual', count(*) filter (where o = 'manual'),
        'open',   count(*) filter (where o = 'open'))
      from (
        select case
                 when t.status = 'rejected' then 'rejected'
                 when t.exit_price is null then 'open'
                 when t.take_profit is not null
                  and abs(t.exit_price - t.take_profit) <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'tp'
                 when t.stop_loss is not null
                  and abs(t.exit_price - t.stop_loss)   <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'sl'
                 else 'manual' end as o
        from public.telegram_trades t
        where t.created_at >= now() - make_interval(days => v_days)
      ) s
    ),

    -- SHËNDETI I EKZEKUTIMIT. 'rejected' është numri që tregon nëse brokeri po i pret hyrjet.
    'exec', jsonb_build_object(
      'd7_ok',       (select count(*) from public.trade_executions where created_at >= now() - interval '7 days'  and status = 'executed'),
      'd7_rejected', (select count(*) from public.trade_executions where created_at >= now() - interval '7 days'  and status = 'rejected'),
      'd7_error',    (select count(*) from public.trade_executions where created_at >= now() - interval '7 days'  and status = 'error'),
      'h24_ok',      (select count(*) from public.trade_executions where created_at >= now() - interval '24 hours' and status = 'executed'),
      'h24_bad',     (select count(*) from public.trade_executions where created_at >= now() - interval '24 hours' and status in ('rejected','error'))
    ),

    -- SERIA PËR GRAFIKUN. Çdo ditë e dritares del, edhe ato pa tregti — ndryshe grafiku gënjen
    -- duke i bashkuar ditët aktive dhe duke fshehur pushimet.
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', g.d::date::text,
               'n', coalesce(x.n, 0),
               'net', round(coalesce(x.net, 0)::numeric, 2)) order by g.d), '[]'::jsonb)
      from generate_series((current_date - (v_days - 1)), current_date, interval '1 day') g(d)
      left join (
        select closed_at::date dd, count(*) n, sum(net) net
        from public.position_closes
        where closed_at >= current_date - (v_days - 1) group by 1
      ) x on x.dd = g.d::date
    )
  ) into v;

  return v;
end;
$$;

-- ---------- 2) PËRDORUESIT, ME GRAFIKUN E TYRE ----------
-- Një rresht për çdo përdorues të regjistruar — edhe ata pa asnjë tregti, sepse "kush nuk ka nisur
-- ende" është informacion po aq i vlefshëm sa "kush po humb".
--
-- Ndarja është TRE-pjesëshe: sinjalet, robotët e tjerë, dhe dora. Fillimisht i lashë vetëm dy dhe
-- shuma nuk përputhej me totalin — 717 tregti me 6 sinjale e 169 me dorë linin 542 pa shpjegim.
-- Një numër që s'mblidhet ngjall dyshim me të drejtë, ndaj tani mblidhet.
--
-- 'series' është neto KUMULATIVE ditore: pikërisht ajo që duhet një vije e vogël pranë emrit, sepse
-- tregon drejtimin, jo zhurmën e një dite të vetme.
-- Ndryshimi i kolonave të kthyera kërkon fshirje të plotë — Postgres nuk e lejon me 'replace'.
drop function if exists public.admin_user_performance(integer);

create function public.admin_user_performance(p_days integer default 30)
returns table (
  user_id uuid, email text, full_name text, registered_at timestamptz,
  subscription_tier text, subscription_status text, subscription_expires_at timestamptz,
  days_left integer, is_vip boolean, is_admin boolean,
  mt_connected boolean, mt_mode text, auto_trade boolean,
  trades bigint, wins bigint, net numeric, lots numeric, last_trade_at timestamptz,
  sig_trades bigint, sig_net numeric, bot_trades bigint, bot_net numeric,
  man_trades bigint, man_net numeric,
  series numeric[]
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_days integer := greatest(least(coalesce(p_days, 30), 180), 7);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;

  return query
  with win as (select (current_date - (v_days - 1)) as d0),
  days as (select g::date d from win, generate_series(win.d0, current_date, interval '1 day') g),
  agg as (
    select pc.user_id,
      count(*)                                                             as n,
      count(*) filter (where pc.net > 0)                                   as w,
      coalesce(sum(pc.net), 0)                                             as net,
      coalesce(sum(pc.volume), 0)                                          as lots,
      max(pc.closed_at)                                                    as last_at,
      count(*) filter (where pc.robot in ('GoldSniperFX','Sinjalet'))                       as sig_n,
      coalesce(sum(pc.net) filter (where pc.robot in ('GoldSniperFX','Sinjalet')), 0)       as sig_net,
      count(*) filter (where pc.robot is not null and pc.robot not in ('GoldSniperFX','Sinjalet'))                 as bot_n,
      coalesce(sum(pc.net) filter (where pc.robot is not null and pc.robot not in ('GoldSniperFX','Sinjalet')), 0) as bot_net,
      count(*) filter (where pc.robot is null)                             as man_n,
      coalesce(sum(pc.net) filter (where pc.robot is null), 0)             as man_net
    from public.position_closes pc, win
    where pc.closed_at >= win.d0 group by pc.user_id
  ),
  daily as (
    select pc.user_id, pc.closed_at::date d, sum(pc.net) net
    from public.position_closes pc, win
    where pc.closed_at >= win.d0 group by 1, 2
  ),
  -- Kumulativja llogaritet mbi ditët e PLOTËSUARA, jo mbi ditët me tregti — ndryshe vija do të
  -- kërcente nga një ditë aktive te tjetra dhe do ta fshihte pushimin.
  -- Dy hapa me qëllim: Postgres nuk lejon window function brenda një agregati, ndaj fillimisht
  -- ndërtohet rrjeta ditore me shumën kumulative, dhe vetëm pastaj mblidhet në varg.
  grid as (
    select p.id as uid, days.d,
           sum(coalesce(daily.net, 0)) over (partition by p.id order by days.d) as cum
    from public.profiles p
    cross join days
    left join daily on daily.user_id = p.id and daily.d = days.d
  ),
  ser as (
    select uid, array_agg(round(cum::numeric, 2) order by d) as s from grid group by uid
  )
  select p.id, u.email::text, p.full_name, p.created_at,
         p.subscription_tier, p.subscription_status, p.subscription_expires_at,
         case when p.subscription_expires_at is null then null
              else greatest(0, (p.subscription_expires_at::date - current_date))::integer end,
         coalesce(p.is_vip, false), coalesce(p.is_admin, false),
         (m.account_id is not null and m.account_id <> '' and m.token is not null and m.token <> ''),
         m.mode, coalesce(m.auto_trade, false),
         coalesce(a.n, 0), coalesce(a.w, 0), round(coalesce(a.net, 0)::numeric, 2),
         round(coalesce(a.lots, 0)::numeric, 2), a.last_at,
         coalesce(a.sig_n, 0), round(coalesce(a.sig_net, 0)::numeric, 2),
         coalesce(a.bot_n, 0), round(coalesce(a.bot_net, 0)::numeric, 2),
         coalesce(a.man_n, 0), round(coalesce(a.man_net, 0)::numeric, 2),
         coalesce(ser.s, '{}'::numeric[])
  from public.profiles p
  left join auth.users u            on u.id = p.id
  left join public.metaapi_config m on m.user_id = p.id
  left join agg a                   on a.user_id = p.id
  left join ser                     on ser.uid = p.id
  order by coalesce(a.n, 0) desc, p.created_at desc;
end;
$$;

revoke all on function public.admin_overview_v2(integer) from public, anon;
revoke all on function public.admin_user_performance(integer) from public, anon;
grant execute on function public.admin_overview_v2(integer) to authenticated;
grant execute on function public.admin_user_performance(integer) to authenticated;
