-- HYRJET NJËKOHËSISHT: 4 si nisje për përdoruesit e rinj (4 gusht 2026)
--
-- Ishte 12. Për një llogari të vogël kjo është shumë: 12 pozicione të hapura njëherësh e shterrin
-- marzhin, dhe brokeri fillon t'i refuzojë hyrjet e mëvonshme me "not enough money" — pra sinjalet
-- humbasin pa asnjë shenjë të dukshme për përdoruesin.
--
-- Rasti që e nxori: një përdorues i ri me bilanc 379 USD u lidh sot dhe e gjeti fushën me 12.
--
-- Prekhen VETËM parazgjedhjet — përdoruesit ekzistues i mbajnë vlerat e tyre, siç u kërkua.
-- Kanali i ri e trashëgon vlerën nga 'telegram_sin_config.max_open' (shih telegram-signals,
-- krijimi i rreshtit të kanalit), ndaj ndryshimi i konfigurimit është ai që vlen vërtet; kolona e
-- kanalit rregullohet për të njëjtin numër, që të mos mbetet 3 e pakuptueshme.

alter table public.telegram_sin_config   alter column max_open set default 4;
alter table public.telegram_sin_channels alter column max_open set default 4;
