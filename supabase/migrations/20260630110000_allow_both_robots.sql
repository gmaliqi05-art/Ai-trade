-- ============================================================
-- allow_both_robots — lejon opt-in që Roboti i Sinjaleve (auto_trade) dhe FastT
-- (scalp_live_enabled) të punojnë NJËKOHËSISHT në të njëjtën llogari.
--
-- Default = false → ekskluziviteti ekzistues mbetet i pandryshuar (asgjë s'ndryshon
-- për askënd) derisa përdoruesi ta ndezë qëllimisht këtë flamur.
--
-- Server-side:
--   • scalp-live: lejon FastT-in edhe kur auto_trade=true NËSE allow_both_robots=true.
--   • Anti-hedge ndër-robot te FastT: nuk hap drejtim të kundërt mbi asnjë pozicion
--     ekzistues të të njëjtit simbol (përfshirë ata të robotit të sinjaleve).
-- ============================================================

alter table public.metaapi_config
  add column if not exists allow_both_robots boolean not null default false;
