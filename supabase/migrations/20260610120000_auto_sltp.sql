-- AUTO SL/TP (opt-in) per robotin aktual: kur ON, roboti i llogarit SL/TP krejt vete
-- nga analiza e tregut (ATR/volatilitet) + balanca e perdoruesit; fushat manuale fiken ne UI.
-- DEFAULT false -> sjellja ekzistuese e robotit mbetet IDENTIKE pa e ndezur perdoruesi.
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS auto_sltp boolean NOT NULL DEFAULT false;
