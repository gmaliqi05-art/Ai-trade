-- PARTNERITETET ME BROKERËT (4 gusht 2026)
--
-- Kërkesa e pronarit: një faqe e vetme në Super Admin ku konfigurohen marrëveshjet me brokerët
-- (Vantage i pari), me GJITHÇKA që duhet për ta nënshkruar një marrëveshje IB/CPA dhe pastaj për
-- ta matur atë — jo vetëm një link referimi.
--
-- Pse kaq shumë fusha: një marrëveshje IB nuk është "linku dhe kaq". Ajo që përcakton nëse fitohet
-- vërtet diçka janë detajet: cili ENTITET i brokerit i pranon klientët tanë, sa është rebate-i REAL
-- për ARIN (jo shifra maksimale e reklamës), a kalojnë llogaritë ekzistuese, kur paguhet, dhe çfarë
-- ndalon kontrata në marketing. Prandaj çdo njëra prej tyre ka fushën e vet — që kur t'i pyesim,
-- përgjigjet të kenë ku të shkruhen, dhe të mos humbasin nëpër biseda.
--
-- TRE PJESË:
--   1) broker_partners   — marrëveshja: kushtet, kontakti, rregullat, transparenca, lista e pyetjeve
--   2) broker_referrals  — kush u regjistrua nën cilin broker (atribuimi)
--   3) metaapi_config.mt_login / mt_server / mt_broker — ÇELËSI I PËRPUTHJES
--
-- Pika (3) është ajo pa të cilën gjithçka tjetër mbetet teori: portali IB i brokerit raporton sipas
-- NUMRIT TË LLOGARISË MT5. Deri sot ne ruanim vetëm 'account_id' të MetaApi-t, që brokeri nuk e njeh.
-- Pa numrin e llogarisë nuk dihet cili rresht i raportit të rebate-it i takon cilit përdorues.

-- ---------- 1) MARRËVESHJET ----------
create table if not exists public.broker_partners (
  id uuid primary key default gen_random_uuid(),

  -- Identiteti
  name        text not null,
  slug        text not null unique,
  website     text not null default '',
  logo_url    text not null default '',
  sort_order  integer not null default 0,
  enabled     boolean not null default false,   -- a u shfaqet përdoruesve në platformë
  is_primary  boolean not null default false,   -- brokeri i rekomanduar (vetëm një)

  -- Marrëveshja
  program     text not null default 'none',     -- none | ib | cpa | hybrid
  status      text not null default 'draft',    -- draft | applied | approved | active | paused | rejected
  applied_at    timestamptz,
  approved_at   timestamptz,
  ib_code       text not null default '',       -- numri/kodi ynë IB te brokeri
  ib_link       text not null default '',       -- linku i referimit që klikon përdoruesi
  ib_portal_url text not null default '',       -- ku i shohim raportet e rebate-it
  contact_name  text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  contract_url  text not null default '',

  -- Kushtet ekonomike
  currency            text    not null default 'USD',
  rebate_per_lot      numeric not null default 0,  -- rebate i përgjithshëm, USD për lot round-turn
  rebate_gold_per_lot numeric not null default 0,  -- rebate për XAUUSD — ai që na intereson vërtet
  cpa_amount          numeric not null default 0,
  cpa_min_deposit     numeric not null default 0,
  cpa_min_lots        numeric not null default 0,
  sub_ib_enabled      boolean not null default false,
  sub_ib_share_pct    numeric not null default 0,
  payout_frequency    text    not null default 'monthly',  -- daily | weekly | monthly
  payout_min          numeric not null default 0,
  payout_method       text    not null default '',

  -- Rregullat dhe pajtueshmëria
  entity               text    not null default '',  -- ASIC / FCA / CIMA / VFSC …
  regulator            text    not null default '',
  allowed_countries    text    not null default '',  -- me presje
  restricted_countries text    not null default '',
  min_deposit          numeric not null default 0,
  account_types        text    not null default '',  -- Standard / RAW / ECN …
  -- Emrat e serverëve MT5 (me presje). Kjo është ajo që na lejon të njohim AUTOMATIKISHT se cili
  -- përdorues është te ky broker, duke e krahasuar me 'metaapi_config.mt_server'.
  server_names         text    not null default '',
  marketing_rules      text    not null default '',

  -- Transparenca ndaj përdoruesve
  -- Rebate-i paguhet PËR LOT. Domethënë platforma fiton më shumë kur hapen më shumë pozicione —
  -- pavarësisht nëse përdoruesi fiton apo humb. Ky konflikt nuk zhduket duke heshtur; zhduket duke
  -- e thënë. Teksti më poshtë është ai që u shfaqet përdoruesve.
  disclosure_enabled boolean not null default true,
  disclosure_text    text    not null default '',

  -- LISTA E KONTROLLIT para nënshkrimit — pyetjet që duhen bërë brokerit, me vend për përgjigjen.
  checklist jsonb not null default $json$[
    {"id":"entity",     "q":"Cili entitet i brokerit (ASIC/FCA/CIMA/VFSC) i pranon klientët tanë — Kosovë, Shqipëri, Maqedoni, Gjermani, Zvicër? Rebate-i ndryshon sipas entitetit.", "a":"", "done":false},
    {"id":"gold_rate",  "q":"Sa është rebate-i REAL për XAUUSD, ndarë sipas llojit të llogarisë (Standard / RAW / ECN)? Shifra e reklamës është maksimumi për të gjitha instrumentet.", "a":"", "done":false},
    {"id":"existing",   "q":"A mund të kalojnë nën IB-në tonë llogaritë EKZISTUESE, me kërkesë me shkrim të klientit? (Zakonisht jo — kjo përcakton sa nga përdoruesit e tanishëm numërohen.)", "a":"", "done":false},
    {"id":"sub_ib",     "q":"A lejohet sub-IB, dhe me çfarë ndarjeje?", "a":"", "done":false},
    {"id":"payout",     "q":"Sa shpesh paguhet, cili është minimumi i tërheqjes, dhe në ç'formë (bankë / kripto)?", "a":"", "done":false},
    {"id":"legal",      "q":"Kërkohet kompani e regjistruar apo pranohet individ? Çfarë dokumentesh (KYC) duhen?", "a":"", "done":false},
    {"id":"marketing",  "q":"Çfarë kufizimesh marketingu ka kontrata — premtime fitimi, reklama të paguara, përdorimi i markës së brokerit?", "a":"", "done":false},
    {"id":"tiers",      "q":"A ndryshon rebate-i sipas volumit (shkallë), dhe kur rishikohet?", "a":"", "done":false},
    {"id":"servers",    "q":"Cilët janë emrat e saktë të serverëve MT4/MT5 që përdor brokeri? (Na duhen për përputhjen automatike te platforma.)", "a":"", "done":false},
    {"id":"attrib",     "q":"Si funksionon atribuimi — kohëzgjatja e cookie-t, çfarë ndodh kur regjistrimi bëhet nga aplikacioni celular, a mjafton kodi IB i shkruar me dorë?", "a":"", "done":false},
    {"id":"client_cost","q":"A e paguan rebate-in brokeri nga marzhi i vet, apo klienti ynë merr spread/komision më të lartë se normalja? (Përgjigjja shkon fjalë për fjalë te teksti i transparencës.)", "a":"", "done":false},
    {"id":"exit",       "q":"Si mbyllet marrëveshja — afati, njoftimi paraprak, dhe çfarë ndodh me klientët ekzistues pas mbylljes?", "a":"", "done":false}
  ]$json$::jsonb,

  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broker_partners_enabled_idx on public.broker_partners (enabled, sort_order);

alter table public.broker_partners enable row level security;
-- Vetëm adminët. Kushtet e kontratës, normat e rebate-it dhe kontaktet nuk kanë pse të dalin te
-- klienti. Ajo që u duhet përdoruesve del përmes funksionit 'public_brokers()' më poshtë.
drop policy if exists broker_partners_admin on public.broker_partners;
create policy broker_partners_admin on public.broker_partners for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- SIPËRFAQJA PUBLIKE: VETËM ato fusha që përdoruesi duhet t'i shohë kur zgjedh brokerin.
-- Funksion, jo pamje: një VIEW me SECURITY DEFINER e anashkalon RLS-në dhe linter-i i Supabase e
-- shënon si gabim. Funksioni bën të njëjtën punë me të njëjtin model si çdo RPC tjetër këtu.
create or replace function public.public_brokers()
returns table (
  id uuid, name text, slug text, website text, logo_url text,
  ib_link text, is_primary boolean, sort_order integer,
  min_deposit numeric, account_types text, disclosure_text text
)
language sql stable security definer set search_path to 'public'
as $fn$
  select b.id, b.name, b.slug, b.website, b.logo_url,
         b.ib_link, b.is_primary, b.sort_order,
         b.min_deposit, b.account_types,
         case when b.disclosure_enabled then b.disclosure_text else '' end
  from public.broker_partners b
  where b.enabled = true
  order by b.sort_order, b.name;
$fn$;

revoke all on function public.public_brokers() from public;
grant execute on function public.public_brokers() to anon, authenticated;

-- ---------- 2) ATRIBUIMI ----------
create table if not exists public.broker_referrals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  broker_id  uuid not null references public.broker_partners(id) on delete cascade,
  -- clicked = e ka hapur linkun | registered = thotë se hapi llogari | confirmed = e pamë te portali IB
  status     text not null default 'clicked',
  clicked_at   timestamptz not null default now(),
  registered_at timestamptz,
  confirmed_at  timestamptz,
  confirmed_by  uuid,
  mt_login   text not null default '',
  mt_server  text not null default '',
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker_id)
);

create index if not exists broker_referrals_broker_idx on public.broker_referrals (broker_id, status);

alter table public.broker_referrals enable row level security;
drop policy if exists broker_referrals_own_select on public.broker_referrals;
create policy broker_referrals_own_select on public.broker_referrals for select to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
drop policy if exists broker_referrals_own_insert on public.broker_referrals;
create policy broker_referrals_own_insert on public.broker_referrals for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists broker_referrals_admin_write on public.broker_referrals;
create policy broker_referrals_admin_write on public.broker_referrals for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- ---------- 3) NUMRI I LLOGARISË MT — ÇELËSI I PËRPUTHJES ----------
-- Mbushen nga 'metaapi-trade' (veprimi CHECK), nga account-information e MetaApi-t.
alter table public.metaapi_config add column if not exists mt_login  text;
alter table public.metaapi_config add column if not exists mt_server text;
alter table public.metaapi_config add column if not exists mt_broker text;

-- ---------- RPC: LISTA ----------
create or replace function public.admin_brokers_list()
returns setof public.broker_partners
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query select * from public.broker_partners order by sort_order, name;
end;
$$;

-- ---------- RPC: RUAJTJA ----------
-- Një hyrje e vetme për krijim dhe përditësim. Fushat që mungojnë te 'p' NUK preken — kështu një
-- panel i vogël (p.sh. vetëm lista e kontrollit) nuk i fshin pa dashje kushtet e kontratës.
create or replace function public.admin_broker_save(p jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin = true) then
    raise exception 'forbidden';
  end if;

  v_id := nullif(p->>'id','')::uuid;

  if v_id is null then
    insert into public.broker_partners (name, slug)
    values (coalesce(nullif(p->>'name',''), 'Broker i ri'),
            coalesce(nullif(p->>'slug',''), 'broker-' || substr(gen_random_uuid()::text, 1, 8)))
    returning id into v_id;
  end if;

  update public.broker_partners b set
    name        = coalesce(nullif(p->>'name',''), b.name),
    slug        = coalesce(nullif(p->>'slug',''), b.slug),
    website     = coalesce(p->>'website',     b.website),
    logo_url    = coalesce(p->>'logo_url',    b.logo_url),
    sort_order  = coalesce((p->>'sort_order')::int,  b.sort_order),
    enabled     = coalesce((p->>'enabled')::boolean, b.enabled),
    is_primary  = coalesce((p->>'is_primary')::boolean, b.is_primary),

    program     = coalesce(nullif(p->>'program',''), b.program),
    status      = coalesce(nullif(p->>'status',''),  b.status),
    applied_at  = coalesce((p->>'applied_at')::timestamptz,  b.applied_at),
    approved_at = coalesce((p->>'approved_at')::timestamptz, b.approved_at),
    ib_code       = coalesce(p->>'ib_code',       b.ib_code),
    ib_link       = coalesce(p->>'ib_link',       b.ib_link),
    ib_portal_url = coalesce(p->>'ib_portal_url', b.ib_portal_url),
    contact_name  = coalesce(p->>'contact_name',  b.contact_name),
    contact_email = coalesce(p->>'contact_email', b.contact_email),
    contact_phone = coalesce(p->>'contact_phone', b.contact_phone),
    contract_url  = coalesce(p->>'contract_url',  b.contract_url),

    currency            = coalesce(nullif(p->>'currency',''), b.currency),
    rebate_per_lot      = coalesce((p->>'rebate_per_lot')::numeric,      b.rebate_per_lot),
    rebate_gold_per_lot = coalesce((p->>'rebate_gold_per_lot')::numeric, b.rebate_gold_per_lot),
    cpa_amount          = coalesce((p->>'cpa_amount')::numeric,          b.cpa_amount),
    cpa_min_deposit     = coalesce((p->>'cpa_min_deposit')::numeric,     b.cpa_min_deposit),
    cpa_min_lots        = coalesce((p->>'cpa_min_lots')::numeric,        b.cpa_min_lots),
    sub_ib_enabled      = coalesce((p->>'sub_ib_enabled')::boolean,      b.sub_ib_enabled),
    sub_ib_share_pct    = coalesce((p->>'sub_ib_share_pct')::numeric,    b.sub_ib_share_pct),
    payout_frequency    = coalesce(nullif(p->>'payout_frequency',''),    b.payout_frequency),
    payout_min          = coalesce((p->>'payout_min')::numeric,          b.payout_min),
    payout_method       = coalesce(p->>'payout_method',                  b.payout_method),

    entity               = coalesce(p->>'entity',               b.entity),
    regulator            = coalesce(p->>'regulator',            b.regulator),
    allowed_countries    = coalesce(p->>'allowed_countries',    b.allowed_countries),
    restricted_countries = coalesce(p->>'restricted_countries', b.restricted_countries),
    min_deposit          = coalesce((p->>'min_deposit')::numeric, b.min_deposit),
    account_types        = coalesce(p->>'account_types',        b.account_types),
    server_names         = coalesce(p->>'server_names',         b.server_names),
    marketing_rules      = coalesce(p->>'marketing_rules',      b.marketing_rules),

    disclosure_enabled = coalesce((p->>'disclosure_enabled')::boolean, b.disclosure_enabled),
    disclosure_text    = coalesce(p->>'disclosure_text',               b.disclosure_text),
    checklist          = coalesce(p->'checklist',                      b.checklist),
    notes              = coalesce(p->>'notes',                         b.notes),
    updated_at = now()
  where b.id = v_id;

  -- Vetëm një broker mund të jetë "kryesori".
  if coalesce((p->>'is_primary')::boolean, false) then
    update public.broker_partners set is_primary = false where id <> v_id and is_primary;
  end if;

  begin
    insert into public.admin_audit_log (admin_id, action, target_table, target_id, details)
    values (auth.uid(), 'broker_save', 'broker_partners', v_id, p);
  exception when others then null;
  end;

  return v_id;
end;
$$;

-- ---------- RPC: FSHIRJA ----------
create or replace function public.admin_broker_delete(p_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin = true) then
    raise exception 'forbidden';
  end if;
  delete from public.broker_partners where id = p_id;
  begin
    insert into public.admin_audit_log (admin_id, action, target_table, target_id, details)
    values (auth.uid(), 'broker_delete', 'broker_partners', p_id, '{}'::jsonb);
  exception when others then null;
  end;
  return true;
end;
$$;

-- ---------- RPC: PËRDORUESIT SIPAS BROKERIT ----------
-- Përputhja bëhet me emrin e serverit MT: nëse 'metaapi_config.mt_server' përmban njërin nga emrat
-- te 'server_names' i një brokeri, përdoruesi i takon atij brokeri. Kur serveri nuk njihet, rreshti
-- shfaqet me broker bosh — më mirë "nuk e di" sesa një hamendje.
--
-- 'lots' është volumi i mbyllur (shuma e 'volume' te position_closes). Prej tij llogaritet rebate-i
-- i pritshëm në UI — VLERËSIM, jo faturë: e vërteta është ajo që shkruan portali i brokerit.
create or replace function public.admin_broker_users(p_days integer default 90)
returns table (
  user_id uuid, email text, full_name text, registered_at timestamptz,
  mt_login text, mt_server text, mt_broker text, mt_mode text,
  broker_id uuid, broker_name text,
  ref_status text, ref_confirmed_at timestamptz,
  lots numeric, trades bigint, net numeric
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  with vol as (
    select pc.user_id,
           coalesce(sum(pc.volume), 0) as lots,
           count(*)                    as trades,
           coalesce(sum(pc.net), 0)    as net
    from public.position_closes pc
    where pc.closed_at >= now() - make_interval(days => greatest(p_days, 1))
    group by pc.user_id
  ),
  matched as (
    select m.user_id, b.id as bid, b.name as bname
    from public.metaapi_config m
    join public.broker_partners b
      on b.server_names <> ''
     and exists (
       select 1 from unnest(string_to_array(b.server_names, ',')) s
       where trim(s) <> '' and coalesce(m.mt_server,'') ilike '%' || trim(s) || '%'
     )
  )
  select p.id, u.email::text, p.full_name, p.created_at,
         m.mt_login, m.mt_server, m.mt_broker, m.mode,
         coalesce(r.broker_id, mt.bid), coalesce(rb.name, mt.bname),
         r.status, r.confirmed_at,
         coalesce(v.lots, 0), coalesce(v.trades, 0), coalesce(v.net, 0)
  from public.profiles p
  left join auth.users u          on u.id = p.id
  left join public.metaapi_config m on m.user_id = p.id
  left join matched mt            on mt.user_id = p.id
  left join public.broker_referrals r on r.user_id = p.id
  left join public.broker_partners rb on rb.id = r.broker_id
  left join vol v                 on v.user_id = p.id
  order by coalesce(v.lots, 0) desc, p.created_at desc;
end;
$$;

-- ---------- RPC: KONFIRMIMI I NJË REFERIMI ----------
-- Kur e gjejmë përdoruesin te portali IB i brokerit, e vulosim këtu me numrin e llogarisë.
create or replace function public.admin_broker_referral_set(
  p_user uuid, p_broker uuid, p_status text, p_login text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin = true) then
    raise exception 'forbidden';
  end if;
  insert into public.broker_referrals (user_id, broker_id, status, mt_login, note,
                                       confirmed_at, confirmed_by)
  values (p_user, p_broker, coalesce(nullif(p_status,''), 'clicked'), coalesce(p_login,''), coalesce(p_note,''),
          case when p_status = 'confirmed' then now() end,
          case when p_status = 'confirmed' then auth.uid() end)
  on conflict (user_id, broker_id) do update set
    status  = coalesce(nullif(excluded.status,''), broker_referrals.status),
    mt_login = case when coalesce(excluded.mt_login,'') <> '' then excluded.mt_login else broker_referrals.mt_login end,
    note     = case when coalesce(excluded.note,'')     <> '' then excluded.note     else broker_referrals.note end,
    confirmed_at = case when excluded.status = 'confirmed' then now() else broker_referrals.confirmed_at end,
    confirmed_by = case when excluded.status = 'confirmed' then auth.uid() else broker_referrals.confirmed_by end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_brokers_list()  from public, anon;
revoke all on function public.admin_broker_save(jsonb) from public, anon;
revoke all on function public.admin_broker_delete(uuid) from public, anon;
revoke all on function public.admin_broker_users(integer) from public, anon;
revoke all on function public.admin_broker_referral_set(uuid, uuid, text, text, text) from public, anon;

grant execute on function public.admin_brokers_list()  to authenticated;
grant execute on function public.admin_broker_save(jsonb) to authenticated;
grant execute on function public.admin_broker_delete(uuid) to authenticated;
grant execute on function public.admin_broker_users(integer) to authenticated;
grant execute on function public.admin_broker_referral_set(uuid, uuid, text, text, text) to authenticated;
