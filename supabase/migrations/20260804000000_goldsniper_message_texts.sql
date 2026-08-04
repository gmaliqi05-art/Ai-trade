-- TEKSTET E MESAZHIT TË SINJALIT — të redaktueshme nga Admini (4 gusht 2026)
--
-- Mesazhi që shkon te kanali ka tri vende teksti rreth sinjalit:
--
--   [ballina]            ← gold_sniper_config.header (ekzistonte)
--   🟢 BUY XAUUSD
--   📍 Entry / 🛑 SL / 🎯 TP…
--   [mbyllja]            ← ishte E FIKSUAR në kod: "Good luck! 🥇"
--   [fundi]              ← gold_sniper_config.footer (ekzistonte)
--
-- Rreshti i mbylljes ishte shkruar drejtpërdrejt në tri edge-functions (telegram-signals,
-- gold-sniper-ingest, gold-sniper-post), pra ndryshimi i tij kërkonte rilëshim kodi. Tani ruhet
-- në bazë si të tjerat, dhe secili nga të tre vendet ka çelësin e vet ON/OFF — që pronari të mund
-- ta heqë krejt njërin pa e fshirë tekstin që ka shkruar.

alter table public.gold_sniper_config
  add column if not exists note            text    not null default 'Good luck! 🥇',
  add column if not exists header_enabled  boolean not null default true,
  add column if not exists note_enabled    boolean not null default true,
  add column if not exists footer_enabled  boolean not null default true;

comment on column public.gold_sniper_config.note is
  'Teksti i mbylljes së sinjalit (para footer-it). Deri tani ishte i fiksuar në kod si "Good luck! 🥇".';
comment on column public.gold_sniper_config.header_enabled is 'OFF = ballina nuk shfaqet fare te mesazhi.';
comment on column public.gold_sniper_config.note_enabled   is 'OFF = rreshti i mbylljes nuk shfaqet fare.';
comment on column public.gold_sniper_config.footer_enabled is 'OFF = teksti i fundit nuk shfaqet fare.';
