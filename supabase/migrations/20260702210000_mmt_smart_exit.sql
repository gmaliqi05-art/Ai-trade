-- MMT: Dalja e Mençur (A) — merr fitimin e lartë kur momentum-i 15m kthehet fort kundër.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS smart_exit boolean NOT NULL DEFAULT true;
