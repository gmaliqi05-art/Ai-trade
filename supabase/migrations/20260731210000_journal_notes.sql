-- Shënimet e Journal-it të treiderit — një shënim për ditë për përdorues.
create table if not exists public.journal_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.journal_notes enable row level security;
drop policy if exists journal_notes_own on public.journal_notes;
create policy journal_notes_own on public.journal_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
