-- Filtra eksperimentalë të robotit (opt-in PER-PËRDORUES) — për t'i testuar te një llogari para se
-- t'i lëshojmë në gjithë platformën. Kur true, roboti aplikon rregullat e reja për reduktim humbjesh:
--   • Spread-guard: nuk hap kur spread-i i arit është i gjerë (orë të holla / lajme).
--   • Cool-off / ndalim serie: ndal hapjet pas 3 humbjeve radhazi sot; pauzë pas 2 humbjesh radhazi.
-- (Stop-et ATR menaxhohen tashmë nga auto_sltp.)
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS experimental_filters boolean NOT NULL DEFAULT false;
