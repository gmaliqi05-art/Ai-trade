-- MMT-FAST fix: kujtesa e mbrojtjes së fitimit (SL i ngritur + kulmi i favorit)
-- ruhet në DB që të mbijetojë mes lakëve 1-minutësh (më parë rifillonte nga zero).
ALTER TABLE public.mmt_trades
  ADD COLUMN IF NOT EXISTS best_fav numeric;
