/*
  # SL/TP të scalp-it si përqindje (për crypto)

  Crypto (BTC/ETH) me SL/TP fiks në $ shkakton "Invalid stops (10016)" sepse $-i është
  shumë i ngushtë te çmimet e larta. Shtohen përqindjet që përdoren për crypto; ari mban $-in.
*/
ALTER TABLE metaapi_config
  ADD COLUMN IF NOT EXISTS scalp_sl_pct numeric DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS scalp_tp_pct numeric DEFAULT 0.6;
