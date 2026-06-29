-- ============================================================
-- RREGULL EKSKLUZIVITETI: kur Roboti i Sinjaleve është ON, TË GJITHË robotët e tjerë OFF.
--
-- Problemi: butonat në UI (auto_trade, strategy_scalp, scalp_live_enabled) janë të
-- pavarur, kështu që një llogari mund të kishte Signal→Live (auto_trade) ON dhe
-- njëkohësisht FastT (scalp_live_enabled) ON → FastT tregtonte paralel me sinjalet.
--
-- Zgjidhja zbatohet edhe SERVER-SIDE te runner-at (burimi i së vërtetës):
--   • scalp-live:        anashkalon çdo përdorues me auto_trade = true (FastT OFF kur sinjalet ON).
--   • auto-trade-runner: scalp tregton vetëm në modalitet scalp-only (swing i fikur).
-- Ky skedar bën KORRIGJIMIN e të dhënave ekzistuese (një herë) që gjendja të jetë konsistente.
-- ============================================================

-- FastT OFF për çdo llogari ku Roboti i Sinjaleve (master auto_trade) është ON.
update public.metaapi_config
  set scalp_live_enabled = false
  where auto_trade = true and scalp_live_enabled = true;

-- Scalp OFF kur sinjali swing është ON (vetëm modaliteti scalp-only lejohet me swing të fikur).
update public.metaapi_config
  set strategy_scalp = false
  where auto_trade = true and strategy_swing is distinct from false and strategy_scalp = true;
