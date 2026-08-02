-- LEXIMI INTELIGJENT I URDHRAVE (AI) — rrjet sigurie mbi parserin me rregulla.
alter table public.gold_sniper_config
  add column if not exists ai_parse_enabled boolean not null default true;

-- Regjistri i çdo vendimi të AI-së — transparencë e plotë për Adminin.
create table if not exists public.signal_ai_log (
  id uuid primary key default gen_random_uuid(),
  text_in text not null,
  text_out text,                 -- forma kanonike e prodhuar (null nëse u refuzua)
  decision text not null,        -- breakeven | sl | tp | none | rejected
  reason text,                   -- pse u refuzua (validimet)
  created_at timestamptz not null default now()
);
create index if not exists signal_ai_log_time on public.signal_ai_log (created_at desc);

alter table public.signal_ai_log enable row level security;
create policy sal_admin_read on public.signal_ai_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
