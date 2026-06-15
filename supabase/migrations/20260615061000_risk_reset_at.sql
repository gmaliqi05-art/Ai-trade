-- Pikë rinisjeje e numëruesve të rrezikut të robotit (humbja ditore + seria e humbjeve).
-- Kur vendoset, auto-trade-runner i numëron humbjet vetëm PAS kësaj kohe (jo nga mesnata),
-- që pas ndryshimeve të cilësimeve testimi të fillojë nga zero.
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS risk_reset_at timestamptz;
