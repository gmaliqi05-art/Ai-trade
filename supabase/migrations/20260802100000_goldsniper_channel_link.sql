-- BUTONI TELEGRAM NË MENY
-- Kthen linkun publik t.me të kanalit GoldSniper|FX — të lexueshëm nga çdo përdorues i kyçur,
-- pa ekspozuar asgjë tjetër nga gold_sniper_config (bot_token etj. mbeten të mbrojtur nga RLS).
-- Linku ndërtohet nga channel_id i llogarisë PRONARE (i njëjti rresht që përdor platform-poll):
--   '@xauricsignals'  → 'https://t.me/xauricsignals'
--   '-100…' (id numerik privat) → NULL (s'ka link publik — butoni fshihet vetë).

create or replace function public.goldsniper_channel_link()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.channel_id like '@%' then 'https://t.me/' || substr(c.channel_id, 2)
           when c.channel_id ~ '^[A-Za-z][A-Za-z0-9_]{3,}$' then 'https://t.me/' || c.channel_id
           else null
         end
    from public.gold_sniper_config c
   where c.channel_id is not null and c.channel_id <> ''
   order by c.updated_at desc nulls last
   limit 1;
$$;

revoke all on function public.goldsniper_channel_link() from public;
grant execute on function public.goldsniper_channel_link() to authenticated;
