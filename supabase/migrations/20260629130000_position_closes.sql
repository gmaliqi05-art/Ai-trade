-- ============================================================
-- position_closes — burim i QËNDRUESHËM i "Trade-t e mbyllura" (sinjal/auto/manual).
--
-- Problemi: për llogari me SHUMË deal-e (p.sh. FastT scalping), thirrja e historisë 7-ditore të MT5
-- dështon (502) → lista bie te logu (vetëm FastT), dhe trade-t e robotit të sinjaleve (mbyllje me
-- TP/SL ose manuale) NUK shfaqeshin, sepse s'logoheshin askund.
--
-- Zgjidhja: serveri regjistron ÇDO mbyllje pozicioni te kjo tabelë —
--   • metaapi-watchdog (çdo 2 min): krahason pozicionet me snapshot-in → kap mbylljet (TP/SL/auto/manual).
--   • metaapi-trade: shkruan menjëherë kur përdoruesi mbyll manualisht (feedback i shpejtë).
-- Fronti e lexon këtë tabelë → lista shfaqet pavarësisht historikut të rëndë të MT5.
-- ============================================================

create table if not exists public.position_closes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  position_id text        not null,
  symbol      text,
  action      text,                 -- BUY / SELL
  volume      numeric,
  entry_price numeric,
  exit_price  numeric,
  net         numeric,              -- P&L real (profit+commission+swap)
  source      text,                 -- signal/auto, fastt, manual
  horizon     text,                 -- long / short
  opened_at   timestamptz,
  closed_at   timestamptz not null default now(),
  unique (user_id, position_id)
);
create index if not exists position_closes_user_closed_idx on public.position_closes (user_id, closed_at desc);

alter table public.position_closes enable row level security;
drop policy if exists "read own position_closes" on public.position_closes;
create policy "read own position_closes" on public.position_closes
  for select to authenticated using (auth.uid() = user_id);
-- Shkrim vetëm nga service-role (watchdog + metaapi-trade). Pa politikë insert për klientët.

-- Snapshot-i i pozicioneve të hapura per-përdorues — për të dalluar cilët u mbyllën mes dy cikleve.
create table if not exists public.open_pos_snapshot (
  user_id    uuid        primary key,
  positions  jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.open_pos_snapshot enable row level security;
-- Pa politika klienti → vetëm service-role (watchdog) e prek.
