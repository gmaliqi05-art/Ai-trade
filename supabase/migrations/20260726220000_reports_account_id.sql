-- Raportet PËR LLOGARI: kur përdoruesi ndërron llogarinë MT5 (p.sh. Vantage → PU Prime),
-- raportet e llogarisë së vjetër s'duhet të shfaqen te e reja. Çdo mbyllje/ekzekutim mban
-- account_id-në e MetaApi; fronti filtron sipas llogarisë aktuale të konfiguruar.
alter table public.position_closes add column if not exists account_id text;
alter table public.trade_executions add column if not exists account_id text;

-- Trigger: mbush account_id automatikisht nga metaapi_config i përdoruesit në çdo INSERT —
-- pa prekur asnjë robot/edge-function (të gjithë shkruajnë përmes këtyre tabelave).
create or replace function public.set_account_id_from_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then
    select account_id into new.account_id from public.metaapi_config where user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_position_closes_account on public.position_closes;
create trigger trg_position_closes_account before insert on public.position_closes
  for each row execute function public.set_account_id_from_config();

drop trigger if exists trg_trade_executions_account on public.trade_executions;
create trigger trg_trade_executions_account before insert on public.trade_executions
  for each row execute function public.set_account_id_from_config();

-- Mbushje e rreshtave ekzistues: llogaria aktuale e secilit përdorues (pamja s'u ndryshon atyre).
update public.position_closes pc set account_id = mc.account_id
  from public.metaapi_config mc where mc.user_id = pc.user_id and pc.account_id is null and mc.account_id <> '';
update public.trade_executions te set account_id = mc.account_id
  from public.metaapi_config mc where mc.user_id = te.user_id and te.account_id is null and mc.account_id <> '';

-- Përjashtim (i aplikuar edhe live): përdoruesi që kaloi te llogaria e re PU Prime — të gjitha
-- rreshtat e tij ekzistues janë të llogarisë së VJETËR (mbyllja e fundit 22 korrik, ekzekutimi
-- i fundit 24 korrik 17:20, para lidhjes së llogarisë së re më 24 korrik 20:47).
update public.position_closes set account_id = 'old-account'
  where user_id = '813262e6-b8bb-4002-bf5b-9647fc9c9af3';
update public.trade_executions set account_id = 'old-account'
  where user_id = '813262e6-b8bb-4002-bf5b-9647fc9c9af3';
