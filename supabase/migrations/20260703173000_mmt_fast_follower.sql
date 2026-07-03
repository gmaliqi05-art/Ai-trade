-- MMT-Fast "ndjekësi i lëvizjes": dil kur çmimi kthehet X$ nga kulmi (fitim/0),
-- + vlera të reja pune: burst 0.6$/3s, pushim 15s, deri 40 tregtime/ditë.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS fast_pullback_usd numeric NOT NULL DEFAULT 0.4;

UPDATE public.mmt_config
   SET fast_move_usd = 0.6,
       fast_window_s = 3,
       fast_cooldown_s = 15,
       fast_max_day = 40
 WHERE id = 1;
