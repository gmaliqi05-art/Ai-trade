-- Telegram Sin: P&L dhe çmimi i daljes për çdo leg — për raportet (pips + fitimi/humbja).
alter table public.telegram_trades add column if not exists net numeric;
alter table public.telegram_trades add column if not exists exit_price numeric;
