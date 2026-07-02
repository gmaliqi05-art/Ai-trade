-- MMT i dukshëm për PËRDORUESIT e kyçur (platformë private — llogaritë e pronarit):
-- konfigurimi lexohet/ndryshohet nga çdo përdorues i kyçur; trade-t/skanimet lexohen nga të gjithë.
DROP POLICY IF EXISTS mmt_config_admin ON public.mmt_config;
DROP POLICY IF EXISTS mmt_trades_admin_read ON public.mmt_trades;
DROP POLICY IF EXISTS mmt_scan_admin_read ON public.mmt_scan_log;

CREATE POLICY mmt_config_auth ON public.mmt_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY mmt_trades_auth_read ON public.mmt_trades FOR SELECT TO authenticated USING (true);
CREATE POLICY mmt_scan_auth_read ON public.mmt_scan_log FOR SELECT TO authenticated USING (true);
