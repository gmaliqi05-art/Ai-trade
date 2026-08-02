-- REGJISTRI I MESAZHEVE TË BLLOKUARA — çdo mesazh që nuk kalon, me arsyen dhe fjalën e saktë.
create table if not exists public.message_block_log (
  id uuid primary key default gen_random_uuid(),
  feed_id text,
  reason text not null,        -- mention | keyword | deposit | video | scalp_group | siren_media | siren_no_info | hide_chat
  matched text,                -- fjala/përmendja konkrete që shkaktoi bllokimin
  text_excerpt text not null,  -- teksti i mesazhit (deri 2000 shkronja)
  source text,
  created_at timestamptz not null default now()
);
create index if not exists mbl_time on public.message_block_log (created_at desc);
create index if not exists mbl_reason on public.message_block_log (reason, created_at desc);

alter table public.message_block_log enable row level security;
create policy mbl_admin_read on public.message_block_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create or replace function public.admin_block_stats(days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.message_block_log where created_at > now() - (days || ' days')::interval),
    'by_reason', coalesce((select jsonb_object_agg(reason, n) from (
        select reason, count(*) n from public.message_block_log
        where created_at > now() - (days || ' days')::interval group by reason) x), '{}'::jsonb),
    'ai_total', (select count(*) from public.signal_ai_log where created_at > now() - (days || ' days')::interval),
    'ai_applied', (select count(*) from public.signal_ai_log
        where created_at > now() - (days || ' days')::interval and text_out is not null)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_block_stats(int) from public;
grant execute on function public.admin_block_stats(int) to authenticated;
