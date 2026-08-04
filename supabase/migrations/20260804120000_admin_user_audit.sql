-- AUDITIMI I PËRDORUESVE (4 gusht 2026)
--
-- Pronari kërkon një pamje të vetme ku, për ÇDO përdorues, të shohë: abonimin (me mundësi
-- ndryshimi afati), a është i lidhur me MetaApi, dhe si po i shkon tregtimi — TË NDARË sipas
-- burimit: sinjalet e GoldSniperFX, robotët e tjerë, dhe tregtimi manual.
--
-- Arsyeja e vërtetë: ka përdorues që thonë "po humbas" ndërsa humbjet vijnë nga tregtimi i tyre
-- manual, ose sepse e mbyllin vetë tregtinë që hapi roboti / e lëvizin SL-TP-në. Pa të dhëna kjo
-- bisedë nuk zgjidhet; me të dhëna zgjidhet me një shikim.
--
-- Të tria funksionet janë SECURITY DEFINER me portë admini — i njëjti model si 'admin_*' ekzistuese.
-- Email-i vjen nga auth.users, i palexueshëm nga klienti; prandaj kalon përmes RPC-së.

-- ---------- 1) PAMJA E PËRGJITHSHME ----------
create or replace function public.admin_user_audit()
returns table (
  user_id uuid, email text, full_name text, username text, registered_at timestamptz,
  is_admin boolean, is_vip boolean,
  subscription_tier text, subscription_status text,
  subscription_expires_at timestamptz, trial_ends_at timestamptz,
  mt_connected boolean, mt_mode text, mt_last_connected_at timestamptz,
  sig_trades bigint, sig_net numeric, sig_wins bigint,
  bot_trades bigint, bot_net numeric, bot_wins bigint,
  man_trades bigint, man_net numeric, man_wins bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  with agg as (
    select pc.user_id,
      count(*) filter (where pc.robot = 'GoldSniperFX')                             as sig_n,
      coalesce(sum(pc.net) filter (where pc.robot = 'GoldSniperFX'), 0)             as sig_p,
      count(*) filter (where pc.robot = 'GoldSniperFX' and pc.net > 0)              as sig_w,
      count(*) filter (where pc.robot is not null and pc.robot <> 'GoldSniperFX')   as bot_n,
      coalesce(sum(pc.net) filter (where pc.robot is not null and pc.robot <> 'GoldSniperFX'), 0) as bot_p,
      count(*) filter (where pc.robot is not null and pc.robot <> 'GoldSniperFX' and pc.net > 0)  as bot_w,
      count(*) filter (where pc.robot is null)                                      as man_n,
      coalesce(sum(pc.net) filter (where pc.robot is null), 0)                      as man_p,
      count(*) filter (where pc.robot is null and pc.net > 0)                       as man_w
    from public.position_closes pc group by pc.user_id
  )
  select p.id, u.email::text, p.full_name, p.username, p.created_at,
         coalesce(p.is_admin,false), coalesce(p.is_vip,false),
         p.subscription_tier, p.subscription_status,
         p.subscription_expires_at, p.trial_ends_at,
         (m.account_id is not null and m.account_id <> '' and m.token is not null and m.token <> ''),
         m.mode, m.last_connected_at,
         coalesce(a.sig_n,0), coalesce(a.sig_p,0), coalesce(a.sig_w,0),
         coalesce(a.bot_n,0), coalesce(a.bot_p,0), coalesce(a.bot_w,0),
         coalesce(a.man_n,0), coalesce(a.man_p,0), coalesce(a.man_w,0)
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.metaapi_config m on m.user_id = p.id
  left join agg a on a.user_id = p.id
  order by p.created_at desc nulls last;
end;
$$;

-- ---------- 2) TREGTITË E SINJALEVE, ME REZULTATIN E VËRTETË ----------
-- Klasifikimi 'outcome' është thelbi: krahason ÇMIMIN E DALJES me TP/SL që vendosi roboti.
--   tp     → doli te take-profit-i i sinjalit
--   sl     → doli te stop-loss-i
--   manual → doli LARG të dyve → dikush e mbylli vetë ose lëvizi nivelet
-- Toleranca: 0.02% e çmimit të hyrjes, minimum 0.20 — sa për rrëshqitjen normale të ekzekutimit.
create or replace function public.admin_user_signal_trades(target uuid, p_days integer default 90)
returns table (
  created_at timestamptz, closed_at timestamptz, symbol text, action text,
  volume numeric, tp_index integer, entry_price numeric, stop_loss numeric,
  take_profit numeric, exit_price numeric, net numeric, status text, outcome text
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  select t.created_at, t.closed_at, t.symbol, t.action, t.volume, t.tp_index,
         t.entry_price, t.stop_loss, t.take_profit, t.exit_price, t.net, t.status,
         case
           when t.status = 'rejected' then 'rejected'
           when t.exit_price is null then 'open'
           when t.take_profit is not null
            and abs(t.exit_price - t.take_profit) <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'tp'
           when t.stop_loss is not null
            and abs(t.exit_price - t.stop_loss)   <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'sl'
           else 'manual'
         end::text
  from public.telegram_trades t
  where t.user_id = target
    and t.created_at >= now() - make_interval(days => greatest(p_days, 1))
  order by t.created_at desc
  limit 500;
end;
$$;

-- ---------- 3) NDRYSHIMI I AFATIT TË ABONIMIT ----------
create or replace function public.admin_set_subscription(
  target uuid, p_expires timestamptz, p_tier text default null, p_status text default null)
returns timestamptz
language plpgsql security definer set search_path to 'public'
as $$
declare v_new timestamptz;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  update public.profiles
     set subscription_expires_at = p_expires,
         subscription_tier   = coalesce(nullif(p_tier, ''),   subscription_tier),
         subscription_status = coalesce(nullif(p_status, ''), subscription_status),
         updated_at = now()
   where id = target
   returning subscription_expires_at into v_new;
  if not found then raise exception 'user_not_found'; end if;
  -- Gjurmë: kush e ndryshoi, kujt, dhe në ç'datë — abonimi është para, duhet të lexohet më vonë.
  begin
    insert into public.admin_audit_log (admin_id, action, target_table, target_id, details)
    values (auth.uid(), 'set_subscription', 'profiles', target,
            jsonb_build_object('expires_at', p_expires, 'tier', p_tier, 'status', p_status));
  exception when others then null;
  end;
  return v_new;
end;
$$;

revoke all on function public.admin_user_audit() from public, anon;
grant execute on function public.admin_user_audit() to authenticated;

revoke all on function public.admin_user_signal_trades(uuid, integer) from public, anon;
grant execute on function public.admin_user_signal_trades(uuid, integer) to authenticated;

revoke all on function public.admin_set_subscription(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.admin_set_subscription(uuid, timestamptz, text, text) to authenticated;
