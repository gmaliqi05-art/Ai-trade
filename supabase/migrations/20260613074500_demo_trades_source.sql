-- Burimi i një demo-trade për filtrin Auto/Manual: 'manual' (user), 'scalp' (robot scalp), 'signal' (robot swing).
alter table public.demo_trades add column if not exists source text;

update public.demo_trades
set source = case
  when exit_reason = 'manual' then 'manual'
  when signal_id is not null then 'signal'
  else 'scalp'
end
where source is null;
