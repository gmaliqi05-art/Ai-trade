-- ============================================================
-- K2 (audit): Lock kundër mbivendosjes së auto-trade-runner.
-- Cron-i nis çdo 60s, por një ekzekutim mund të zgjasë më shumë (vonesa MetaApi/Claude + trailing).
-- Dy ekzekutime paralele lexonin të njëjtin sinjal "active" dhe hapnin POROSI TË DYFISHTA reale.
-- Runner-i tani merr këtë lock atomik në fillim; nëse e mban një run tjetër (< 90s), del menjëherë.
-- (Aplikuar operacionalisht në prodhim; ky skedar e mban në version control.)
-- ============================================================
create table if not exists public.runner_lock (
  id smallint primary key default 1,
  locked_at timestamptz,
  constraint runner_lock_single check (id = 1)
);
insert into public.runner_lock (id, locked_at) values (1, null) on conflict (id) do nothing;
alter table public.runner_lock enable row level security;
-- Pa politika klienti → vetëm service-role (runner-i) e prek; klientët s'kanë akses.
