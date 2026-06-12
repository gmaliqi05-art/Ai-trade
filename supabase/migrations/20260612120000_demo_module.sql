-- Demo (paper-trading) module — fully independent of MetaApi.
-- Mirrors the LIVE trading experience but executes virtually against real gold prices.
-- Per-user virtual balance + virtual positions. Does NOT touch live/robot logic.

-- 1) Per-user demo wallet on profiles (dedicated columns — do NOT reuse profiles.balance
--    to avoid clashing with any existing semantics).
alter table public.profiles
  add column if not exists demo_balance      numeric  not null default 100,   -- € virtual wallet (realized)
  add column if not exists demo_start_balance numeric not null default 100,   -- starting/refill reference
  add column if not exists demo_enabled       boolean not null default true;  -- demo module on/off per user

-- 2) Virtual positions (per user). Modeled on mmti_shadow_trades, with money P&L in €.
create table if not exists public.demo_trades (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  signal_id    uuid,                         -- engine signal that opened it (nullable)
  symbol       text not null default 'XAUUSD',
  side         text not null,                -- 'buy' | 'sell'
  volume       numeric not null,             -- lots
  entry_price  numeric not null,
  sl           numeric,
  tp           numeric,
  status       text not null default 'open', -- 'open' | 'closed'
  exit_price   numeric,
  exit_reason  text,                         -- 'tp' | 'sl' | 'manual' | 'signal'
  profit       numeric,                      -- realized € P&L when closed
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);

create index if not exists demo_trades_user_status_idx on public.demo_trades (user_id, status);
create index if not exists demo_trades_user_opened_idx on public.demo_trades (user_id, opened_at desc);

-- 3) Refill / adjustment ledger (audit of Super Admin top-ups).
create table if not exists public.demo_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric not null,             -- + topup / - adjustment
  balance_after numeric,
  reason      text,                         -- 'admin_topup' | 'reset' | 'trade'
  actor       uuid,                         -- admin who did it (nullable for system)
  created_at  timestamptz not null default now()
);

create index if not exists demo_ledger_user_idx on public.demo_ledger (user_id, created_at desc);

-- 4) RLS — users see only their own demo data; service role (engine) bypasses RLS.
alter table public.demo_trades  enable row level security;
alter table public.demo_ledger  enable row level security;

drop policy if exists demo_trades_select_own on public.demo_trades;
create policy demo_trades_select_own on public.demo_trades
  for select using (auth.uid() = user_id);

drop policy if exists demo_ledger_select_own on public.demo_ledger;
create policy demo_ledger_select_own on public.demo_ledger
  for select using (auth.uid() = user_id);
