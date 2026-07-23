-- Telegram Sin — robot i ri që lexon sinjale nga Telegram (trejderat) dhe hyn direkt në trade,
-- duke ri-përdorur të njëjtin motor MetaApi si roboti i Sinjaleve. 3 tabela:
--   telegram_sin_config  — cilësimet për-përdorues (aktivizim, lot, mënyra e TP, bot token, webhook secret)
--   telegram_signals     — çdo mesazh i marrë + parse-i (burimi i raporteve në faqe)
--   telegram_trades      — pozicionet e hapura nga çdo sinjal (një rresht për çdo TP)

create table if not exists public.telegram_sin_config (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  active         boolean     not null default false,
  lot            numeric     not null default 0.01,   -- lot PËR ÇDO TP
  tp_mode        text        not null default 'multi', -- 'multi' = 1 pozicion për çdo TP | 'first' = vetëm TP1 | 'split' = ndaj lotin
  fallback_sl_usd numeric    not null default 30,     -- SL sigu_rie kur trejderi s'dërgon SL (0 = kërko SL, mos hyr pa të)
  move_be_after_tp1 boolean  not null default true,   -- pas TP1 → zhvendos SL në breakeven për pozicionet e mbetura
  symbol_default text        not null default 'XAUUSD',
  max_open       integer     not null default 12,
  bot_token      text,                                -- token i botit të Telegram (per-user)
  webhook_secret text,                                -- sekret unik; pjesë e URL-së së webhook-ut (?key=...)
  allowed_chat_ids text[]    not null default '{}',   -- bosh = prano çdo chat ku është boti (boti është privat)
  allowed_senders  text[]    not null default '{}',   -- bosh = prano çdo dërgues në chat
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.telegram_signals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  tg_chat_id    text,
  tg_message_id bigint,
  tg_sender     text,
  raw_text      text,
  kind          text,        -- 'entry' | 'exit' | 'unknown'
  symbol        text,
  direction     text,        -- 'buy' | 'sell'
  entry_type    text,        -- 'market' | 'limit'
  entry_price   numeric,
  stop_loss     numeric,
  tps           jsonb        not null default '[]'::jsonb, -- [TP1, TP2, ...]
  status        text        not null default 'received',  -- received|executed|partial|rejected|closed|ignored
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_tg_signals_user_time on public.telegram_signals (user_id, created_at desc);

create table if not exists public.telegram_trades (
  id                  uuid primary key default gen_random_uuid(),
  signal_id           uuid references public.telegram_signals(id) on delete set null,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  symbol              text,
  action              text,       -- 'BUY' | 'SELL'
  volume              numeric,
  tp_index            integer,    -- 1..N (0 nëse pa TP)
  entry_price         numeric,
  stop_loss           numeric,
  take_profit         numeric,
  metaapi_order_id    text,
  metaapi_position_id text,
  status              text        not null default 'open', -- open|closed|rejected
  reason              text,
  raw_response        jsonb,
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create index if not exists idx_tg_trades_user on public.telegram_trades (user_id, status);

-- RLS: përdoruesi sheh VETËM të vetat; shkrimi bëhet nga edge function-i me service-role (bypass RLS).
alter table public.telegram_sin_config enable row level security;
alter table public.telegram_signals   enable row level security;
alter table public.telegram_trades     enable row level security;

drop policy if exists tg_cfg_select on public.telegram_sin_config;
create policy tg_cfg_select on public.telegram_sin_config for select using (auth.uid() = user_id);
drop policy if exists tg_cfg_upsert on public.telegram_sin_config;
create policy tg_cfg_upsert on public.telegram_sin_config for insert with check (auth.uid() = user_id);
drop policy if exists tg_cfg_update on public.telegram_sin_config;
create policy tg_cfg_update on public.telegram_sin_config for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tg_sig_select on public.telegram_signals;
create policy tg_sig_select on public.telegram_signals for select using (auth.uid() = user_id);

drop policy if exists tg_trades_select on public.telegram_trades;
create policy tg_trades_select on public.telegram_trades for select using (auth.uid() = user_id);
