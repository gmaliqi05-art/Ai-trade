-- MMT: "Merr fitimin pas kohe" — pozicion i hapur gjatë me fitim të mjaftueshëm mbyllet
-- për të liruar vendin për trade të reja (max_open s'bllokohet më nga fituesit e ngadaltë).
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS tp_time_h numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS tp_time_usd numeric NOT NULL DEFAULT 10;
