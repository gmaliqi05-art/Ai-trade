-- Parametra SL/TP të scalp-it specifikë për NAFTË (USOIL/UKOIL), si % e çmimit.
-- Nafta është më volatile se ari dhe ka çmim shumë më të ulët (~$65) se ari (~$4300),
-- prandaj $-i fiks nuk i përshtatet; përdorim përqindje (si te crypto), me defaults të naftës.
ALTER TABLE metaapi_config
  ADD COLUMN IF NOT EXISTS scalp_sl_pct_oil numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS scalp_tp_pct_oil numeric NOT NULL DEFAULT 0.8;
