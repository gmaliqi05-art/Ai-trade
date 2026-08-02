-- FILTRAT E MESAZHEVE nga platforma e jashtme (Admin → GoldSniperFX):
-- heqja e emoji-ve/simboleve, fshehja e komenteve, fjalët kyçe të bllokuara.
alter table public.gold_sniper_config
  add column if not exists msg_strip_emojis boolean not null default true,
  add column if not exists msg_hide_chat boolean not null default false,
  add column if not exists msg_blocked_words text not null default '';
