-- Telegram Sin: PARAMETRA PËR KANAL (kërkesa e pronarit) — çdo grup/kanal ka lot-in,
-- mënyrën e TP, SL rezervë, max pozicione dhe shkallët e VETA; enabled = çelësi për kanal.
-- Krijohet vetë me sinjalin e parë (me vlerat e parazgjedhura nga telegram_sin_config).
create table if not exists public.telegram_sin_channels (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  name text,
  enabled boolean not null default true,
  lot numeric not null default 0.01,
  tp_mode text not null default 'multi',
  fallback_sl_usd numeric not null default 30,
  move_be_after_tp1 boolean not null default true,
  max_open integer not null default 3,
  updated_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);
alter table public.telegram_sin_channels enable row level security;
drop policy if exists tg_ch_sel on public.telegram_sin_channels;
create policy tg_ch_sel on public.telegram_sin_channels for select using (auth.uid() = user_id);
drop policy if exists tg_ch_ins on public.telegram_sin_channels;
create policy tg_ch_ins on public.telegram_sin_channels for insert with check (auth.uid() = user_id);
drop policy if exists tg_ch_upd on public.telegram_sin_channels;
create policy tg_ch_upd on public.telegram_sin_channels for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
