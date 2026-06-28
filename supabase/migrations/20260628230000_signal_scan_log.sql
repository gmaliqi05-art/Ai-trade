-- ============================================================
-- signal_scan_log — HISTORI DIAGNOSTIKE e skanimeve të motorit të sinjaleve.
-- Qëllimi: të shohim, pa hamendje, PSE hyri ose s'hyri një sinjal në çdo skanim.
--
-- KJO ËSHTË VETËM DIAGNOSTIKË (shtesë). NUK prek logjikën e robotit, gjeneratorin
-- e sinjaleve, indikatorët apo filtrat. engine-scan thjesht shkruan një rresht
-- (arsyen që e ka tashmë te `_diag`) në fund të çdo ekzekutimi.
-- Shfaqet në një tabelë të veçantë te "Tregto Live" dhe te "Tregto Demo".
-- ============================================================

create table if not exists public.signal_scan_log (
  id             uuid        primary key default gen_random_uuid(),
  scanned_at     timestamptz not null    default now(),
  symbol         text        not null    default 'XAUUSD',
  reject_reason  text,                      -- kodi i portës që e refuzoi (null nëse u krijua sinjal)
  gold_action    text,                      -- BUY/SELL kur kaloi (null kur u refuzua)
  gold_conf      int,                       -- besueshmëria % kur kaloi
  src_1h         text,                      -- burimi i qirinjve 1h (binance/broker/twelvedata)
  src_4h         text,                      -- burimi i qirinjve 4h
  created_signal boolean     not null    default false
);

create index if not exists signal_scan_log_scanned_at_idx
  on public.signal_scan_log (scanned_at desc);

alter table public.signal_scan_log enable row level security;

-- Lexim për të gjithë (info jo-sensitive, platform-wide — si sinjalet e shfaqura).
drop policy if exists "Anyone can read signal scan log" on public.signal_scan_log;
create policy "Anyone can read signal scan log"
  on public.signal_scan_log for select
  to anon, authenticated
  using (true);

-- Shkrim VETËM nga service-role (engine-scan). Pa politikë insert për klientët.
