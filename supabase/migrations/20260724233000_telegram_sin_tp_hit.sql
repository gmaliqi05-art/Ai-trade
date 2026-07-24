-- Telegram Sin: gjurmon TP-në më të lartë të prekur për çdo sinjal (0 = asnjë).
-- Përdoret nga menaxheri i shkallëve: push notification për çdo TP të ri të prekur
-- (pa përsëritje) + shkalla e SL (TP1→BE, TP2→SL te TP1, TP3→SL te TP2, ...).
alter table public.telegram_signals add column if not exists tp_hit integer not null default 0;
