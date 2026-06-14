-- Radha e porosive "para-hapjeje": kur tregu është i mbyllur, porosia ruhet këtu.
-- Rruga A: metaapi-trade provon ta vendosë si pending te brokeri (status 'placed').
-- Rruga B (rezervë): nëse brokeri e refuzon, mbetet 'queued' dhe auto-trade-runner
-- e dërgon si porosi TREGU pikërisht kur hapet tregu (entry me çmimin real të hapjes).
CREATE TABLE IF NOT EXISTS public.pre_open_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  action text NOT NULL CHECK (action IN ('BUY','SELL')),
  volume numeric NOT NULL,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  source text NOT NULL DEFAULT 'manual',          -- 'manual' | 'signal'
  signal_id uuid,
  status text NOT NULL DEFAULT 'queued',           -- queued | placed | submitted | cancelled | expired | failed
  broker_order_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  expires_at timestamptz
);
ALTER TABLE public.pre_open_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY pre_open_own_select ON public.pre_open_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY pre_open_own_update ON public.pre_open_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY pre_open_service ON public.pre_open_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS pre_open_status_idx ON public.pre_open_orders (status) WHERE status IN ('queued','placed');
