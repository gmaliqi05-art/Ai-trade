-- NIVELET ORIGJINALE TË SINJALIT + RAPORTI "PO TA KISHTE LËNË" (4 gusht 2026)
--
-- Kërkesa e pronarit, e thënë me fjalët e tij: roboti i vendos Hyrjen, TP-në dhe SL-në sipas
-- sinjalit; gjatë tregtisë përdoruesi e afron SL-në; qiriri ia prek; ai humbet. Por po ta kishte
-- lënë siç ishte, qirinjtë ktheheshin dhe do të kishte fituar. Kjo duhet të duket me të dhëna.
--
-- PENGESA që u zbulua gjatë ndërtimit: 'telegram_trades.stop_loss' NUK është SL-ja e sinjalit —
-- është ajo AKTUALE. Menaxheri ynë e përditëson kur e çon në breakeven ose e ngjit pas TP-ve
-- (telegram-signals: update {stop_loss: tgt}). Pra pa ruajtur veçmas nivelet e nisjes, pyetja
-- "po ta kishte lënë siç ishte" s'ka bazë krahasimi.
--
-- Anasjelltas, kjo është edhe arsyeja pse klasifikimi 'outcome' MBETET mbi SL-në aktuale: nëse do
-- ta krahasonim me origjinalin, çdo breakeven i vetë robotit do të dilte si "ndërhyrje e
-- përdoruesit" — një akuzë e rreme.

alter table public.telegram_trades
  add column if not exists orig_stop_loss   numeric,
  add column if not exists orig_take_profit numeric,
  add column if not exists orig_backfilled  boolean not null default false;

-- Mbushja e rreshtave ekzistues: kopjohen vlerat aktuale. Për tregtitë e pamodifikuara kjo është
-- saktësisht origjinali; për të modifikuarat është përafrim — s'kemi si ta dimë retroaktivisht.
-- 'orig_backfilled' e shënon dallimin, që raporti të mos pretendojë siguri që s'e ka; te faqja
-- del me yll dhe me sqarim.
update public.telegram_trades
   set orig_stop_loss   = coalesce(orig_stop_loss, stop_loss),
       orig_take_profit = coalesce(orig_take_profit, take_profit),
       orig_backfilled  = true
 where orig_stop_loss is null and orig_take_profit is null;

comment on column public.telegram_trades.orig_stop_loss is
  'SL-ja SIÇ E VENDOSI SINJALI në hapje. Nuk preket nga menaxheri — ndryshe nga stop_loss.';
comment on column public.telegram_trades.orig_take_profit is
  'TP-ja siç e vendosi sinjali në hapje.';
comment on column public.telegram_trades.orig_backfilled is
  'true = vlerat u kopjuan retroaktivisht nga gjendja aktuale, pra mund të mos jenë origjinalet.';

-- Raporti i tregtive: shtohet ID-ja (që faqja të kërkojë kontrollin) dhe nivelet origjinale.
drop function if exists public.admin_user_signal_trades(uuid, integer);

create or replace function public.admin_user_signal_trades(target uuid, p_days integer default 90)
returns table (
  id uuid, created_at timestamptz, closed_at timestamptz, symbol text, action text,
  volume numeric, tp_index integer, entry_price numeric, stop_loss numeric,
  take_profit numeric, orig_stop_loss numeric, orig_take_profit numeric,
  exit_price numeric, net numeric, status text, outcome text
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  select t.id, t.created_at, t.closed_at, t.symbol, t.action, t.volume, t.tp_index,
         t.entry_price, t.stop_loss, t.take_profit, t.orig_stop_loss, t.orig_take_profit,
         t.exit_price, t.net, t.status,
         case
           when t.status = 'rejected' then 'rejected'
           when t.exit_price is null then 'open'
           when t.take_profit is not null
            and abs(t.exit_price - t.take_profit) <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'tp'
           when t.stop_loss is not null
            and abs(t.exit_price - t.stop_loss)   <= greatest(0.20, coalesce(t.entry_price,0) * 0.0002) then 'sl'
           else 'manual'
         end::text
  from public.telegram_trades t
  where t.user_id = target
    and t.created_at >= now() - make_interval(days => greatest(p_days, 1))
  order by t.created_at desc
  limit 500;
end;
$$;

revoke all on function public.admin_user_signal_trades(uuid, integer) from public, anon;
grant execute on function public.admin_user_signal_trades(uuid, integer) to authenticated;
