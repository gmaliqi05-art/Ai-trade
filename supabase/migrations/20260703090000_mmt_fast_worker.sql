-- MMT-FAST (Rruga A): roboti tik-pas-tiku në VPS — konfigurimi i tij (lexohet live nga worker-i).
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS fast_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fast_move_usd numeric NOT NULL DEFAULT 1.2,   -- burst: lëvizja min $ brenda dritares
  ADD COLUMN IF NOT EXISTS fast_window_s integer NOT NULL DEFAULT 5,     -- dritarja e burst-it (sekonda)
  ADD COLUMN IF NOT EXISTS fast_sl_usd numeric NOT NULL DEFAULT 2,       -- SL fiks i ngushtë ($ nga hyrja)
  ADD COLUMN IF NOT EXISTS fast_tp_rr numeric NOT NULL DEFAULT 1.2,      -- TP = RR × SL
  ADD COLUMN IF NOT EXISTS fast_stall_s integer NOT NULL DEFAULT 45,     -- ngecja: pa ekstrem të ri → dil
  ADD COLUMN IF NOT EXISTS fast_max_day integer NOT NULL DEFAULT 10,     -- max trade fast/ditë
  ADD COLUMN IF NOT EXISTS fast_cooldown_s integer NOT NULL DEFAULT 60;  -- pushim pas çdo daljeje
