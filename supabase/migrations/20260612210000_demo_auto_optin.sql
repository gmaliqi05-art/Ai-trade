-- Sandbox personal për demo: roboti auto-demo tregton VETËM për userat që e ndezin vetë.
-- demo_auto = false (default) → çdo user sheh vetëm trade-t e veta manuale; mund ta ndezë robotin e VET.
alter table public.profiles
  add column if not exists demo_auto boolean not null default false;
