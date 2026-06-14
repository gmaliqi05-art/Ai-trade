-- Mënyra e porosive PARA-HAPJES (kur tregu është i mbyllur) — e zgjedhur nga PËRDORUESI.
-- 'A' = Rruga A: pending te brokeri (porosia mbahet nga brokeri te niveli i hyrjes; hyn kur
--       çmimi e prek atë nivel). Nëse brokeri s'e pranon, bie automatik te radha (siguri).
-- 'B' = Rruga B: radha jonë (default) — porosia ruhet te pre_open_orders dhe auto-trade-runner
--       e dërgon si porosi TREGU pikërisht kur hapet tregu. E parashikueshme, 100% nën kontrollin tonë.
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS preopen_mode text NOT NULL DEFAULT 'B'
  CHECK (preopen_mode IN ('A', 'B'));
