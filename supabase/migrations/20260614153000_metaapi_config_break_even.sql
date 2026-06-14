-- Break-even auto: kur fitimi rritet, roboti e ngul SL te hyrja ± offset (rrezik zero + bllokon offset-in).
-- Lexohet nga auto-trade-runner (menaxhimi i pozicioneve) dhe konfigurohet te paneli i Cilësimeve.
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS be_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS be_offset_usd numeric NOT NULL DEFAULT 0.9;
