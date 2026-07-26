-- Telegram Sin: aktivizim/çaktivizim PËR KANAL (BESA, FX+, ...).
-- disabled_chats = lista e tg_chat_id-ve të ÇAKTIVIZUARA: sinjalet e tyre regjistrohen
-- si 'ignored' (kanal i fikur) dhe NUK tregtohen. Bosh = të gjitha kanalet aktive.
alter table public.telegram_sin_config add column if not exists disabled_chats text[] not null default '{}';
