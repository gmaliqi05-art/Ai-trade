import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// metaapi-trade — Faza 5: ekzekuton urdhra në MT5 via MetaApi.cloud, me mbrojtje rreziku.
// "Demo i pari": respekton mode-in e konfiguruar (demo/live) dhe ndalon çdo gjë kur
// kill_switch është aktiv ose kufijtë e rrezikut janë arritur.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MetaApiConfig {
  account_id: string;
  token: string;
  region: string;
  mode: string;
  auto_trade: boolean;
  default_lot: number;
  max_lot: number;
  max_daily_loss: number;
  max_open_trades: number;
  kill_switch: boolean;
}

function host(region: string): string {
  const r = (region || "new-york").trim();
  return `https://mt-client-api-v1.${r}.agiliumtrade.ai`;
}

function marketDataHost(region: string): string {
  const r = (region || "new-york").trim();
  return `https://mt-market-data-client-api-v1.${r}.agiliumtrade.ai`;
}

async function metaApiGet(cfg: MetaApiConfig, path: string) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
    headers: { "auth-token": cfg.token },
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* mbaje si tekst */ }
  if (!resp.ok) throw new Error(`MetaApi ${resp.status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// Disa brokerë (p.sh. Vantage) e quajnë arin me prapashtesë (XAUUSD+, XAUUSD., GOLD…).
// Gjen emrin REAL të simbolit te lista e brokerit; përndryshe kthen të kërkuarin.
async function resolveSymbol(cfg: MetaApiConfig, requested: string): Promise<string> {
  try {
    const list = await metaApiGet(cfg, `/symbols`) as unknown;
    if (!Array.isArray(list) || list.length === 0) return requested;
    const names = list.map(String);
    const req = requested.toUpperCase();
    const exact = names.find(s => s.toUpperCase() === req);
    if (exact) return exact;
    // Varianti me prapashtesë: XAUUSD+, XAUUSD., XAUUSDm, XAUUSD.r ...
    const prefixed = names.find(s => s.toUpperCase().startsWith(req));
    if (prefixed) return prefixed;
    // Alias-et e arit.
    if (req.includes("XAU")) {
      const goldish = names.find(s => /xau.*usd/i.test(s)) || names.find(s => /^gold/i.test(s.trim()));
      if (goldish) return goldish;
    }
    return requested;
  } catch { return requested; }
}

// P&L i REALIZUAR i ditës (që nga 00:00 UTC) — trade-t e mbyllura sot.
async function realizedToday(cfg: MetaApiConfig): Promise<number> {
  try {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await metaApiGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number }>;
    if (!Array.isArray(deals)) return 0;
    return deals.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0);
  } catch { return 0; }
}

// Humbja BRUTO e ditës — shuma e trade-ve HUMBËSE sot (pa i kompensuar me fitimet).
async function grossLossToday(cfg: MetaApiConfig): Promise<number> {
  try {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await metaApiGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number }>;
    if (!Array.isArray(deals)) return 0;
    let loss = 0;
    for (const d of deals) {
      const net = (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0);
      if (net < 0) loss += -net;
    }
    return loss;
  } catch { return 0; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Autentikimi i përdoruesit nga JWT.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "invalid_token" }, 401);

    const body = await req.json();
    const action: string = (body.action || "").toUpperCase();

    // Ngarko konfigurimin e përdoruesit.
    const { data: cfg } = await db.from("metaapi_config").select("*").eq("user_id", user.id).maybeSingle();
    if (!cfg || !cfg.account_id || !cfg.token) {
      return json({ error: "metaapi_not_configured", message: "Konfiguro token-in dhe account-id të MetaApi te faqja MetaTrader." }, 400);
    }
    const config = cfg as MetaApiConfig;

    // Regjistro thirrjen te MetaApi (best-effort) — për panelin e kostove te admin-i.
    // MetaApi tarifon për thirrje; këtu numërojmë çdo thirrje + një vlerësim kostoje.
    try {
      await db.from("metaapi_usage_log").insert({
        user_id: user.id,
        action,
        symbol: body.symbol || null,
        cost_usd: 0.0005,
      });
    } catch (_e) { /* injoro — s'duhet të ndalë tregtimin */ }

    // CHECK — testo lidhjen, kthe info të llogarisë.
    if (action === "CHECK") {
      try {
        const info = await metaApiGet(config, "/account-information");
        return json({ success: true, mode: config.mode, account: info });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // POSITIONS — kthen pozicionet e hapura REALE nga MT5 (live).
    if (action === "POSITIONS") {
      try {
        const positions = await metaApiGet(config, "/positions");
        return json({ success: true, mode: config.mode, positions });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // ORDERS — porositë NË PRITJE (limit/stop) që presin çmimin (ende pa u hapur si pozicion).
    if (action === "ORDERS") {
      try {
        const orders = await metaApiGet(config, "/orders");
        return json({ success: true, mode: config.mode, orders });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // CANCEL_ORDER — anulo një porosi në pritje sipas id-së.
    if (action === "CANCEL_ORDER") {
      const orderId = body.orderId;
      if (!orderId) return json({ error: "bad_request", message: "orderId i nevojshëm" }, 400);
      try {
        const resp = await fetch(`${host(config.region)}/users/current/accounts/${config.account_id}/trade`, {
          method: "POST",
          headers: { "auth-token": config.token, "Content-Type": "application/json" },
          body: JSON.stringify({ actionType: "ORDER_CANCEL", orderId }),
          signal: AbortSignal.timeout(20000),
        });
        const txt = await resp.text();
        let rb: unknown = txt; try { rb = JSON.parse(txt); } catch { /* tekst */ }
        if (!resp.ok) return json({ error: "cancel_failed", status: resp.status, details: rb }, 502);
        return json({ success: true, result: rb });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // PRICE — çmimi REAL live i brokerit (bid/ask) për një simbol (përkon me app-in MT5).
    if (action === "PRICE") {
      const symbol = await resolveSymbol(config, body.symbol || "XAUUSD");
      try {
        const price = await metaApiGet(config, `/symbols/${encodeURIComponent(symbol)}/current-price`);
        return json({ success: true, mode: config.mode, price });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // HISTORY — kthen deal-et e mbyllura për trade-t e përfunduara (parametri 'days', default 7).
    if (action === "HISTORY") {
      try {
        const days = Math.min(Math.max(Number(body.days) || 7, 1), 120);
        const end = new Date();
        const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(end.toISOString())}`;
        const deals = await metaApiGet(config, path);
        return json({ success: true, mode: config.mode, deals });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // CANDLES — qirinj historikë nga MT5 (për grafikun me linja SL/TP).
    if (action === "CANDLES") {
      const symbol = await resolveSymbol(config, body.symbol || "XAUUSD");
      const timeframe = body.timeframe || "15m";
      const limit = Math.min(Number(body.limit) || 300, 1000);
      try {
        const url = `${marketDataHost(config.region)}/users/current/accounts/${config.account_id}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${timeframe}/candles?limit=${limit}`;
        const resp = await fetch(url, { headers: { "auth-token": config.token }, signal: AbortSignal.timeout(15000) });
        const txt = await resp.text();
        let cb: unknown = txt; try { cb = JSON.parse(txt); } catch { /* tekst */ }
        if (!resp.ok) return json({ error: "candles_failed", status: resp.status, details: cb }, 502);
        return json({ success: true, candles: cb });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // MODIFY — ndrysho SL/TP të një pozicioni të hapur.
    if (action === "MODIFY") {
      const positionId = body.positionId;
      if (!positionId) return json({ error: "bad_request", message: "positionId i nevojshëm" }, 400);
      const mbody: Record<string, unknown> = { actionType: "POSITION_MODIFY", positionId };
      if (body.stopLoss != null && Number.isFinite(Number(body.stopLoss))) mbody.stopLoss = Number(body.stopLoss);
      if (body.takeProfit != null && Number.isFinite(Number(body.takeProfit))) mbody.takeProfit = Number(body.takeProfit);
      try {
        const resp = await fetch(`${host(config.region)}/users/current/accounts/${config.account_id}/trade`, {
          method: "POST",
          headers: { "auth-token": config.token, "Content-Type": "application/json" },
          body: JSON.stringify(mbody),
          signal: AbortSignal.timeout(20000),
        });
        const txt = await resp.text();
        let rb: unknown = txt; try { rb = JSON.parse(txt); } catch { /* tekst */ }
        if (!resp.ok) return json({ error: "modify_failed", status: resp.status, details: rb }, 502);
        return json({ success: true, result: rb });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    // CLOSE — mbyll një pozicion të hapur sipas id-së.
    if (action === "CLOSE") {
      const positionId = body.positionId;
      if (!positionId) return json({ error: "bad_request", message: "positionId i nevojshëm" }, 400);
      try {
        const resp = await fetch(`${host(config.region)}/users/current/accounts/${config.account_id}/trade`, {
          method: "POST",
          headers: { "auth-token": config.token, "Content-Type": "application/json" },
          body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId }),
          signal: AbortSignal.timeout(20000),
        });
        const txt = await resp.text();
        let rb: unknown = txt; try { rb = JSON.parse(txt); } catch { /* tekst */ }
        if (!resp.ok) return json({ error: "close_failed", status: resp.status, details: rb }, 502);
        return json({ success: true, result: rb });
      } catch (e) {
        return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
      }
    }

    if (action !== "BUY" && action !== "SELL") {
      return json({ error: "bad_action", message: "action duhet BUY, SELL ose CHECK" }, 400);
    }

    let symbol: string = body.symbol || "XAUUSD";
    // Zgjidh emrin REAL të simbolit te brokeri (rregullon "Unknown symbol 4301").
    symbol = await resolveSymbol(config, symbol);
    const signalId: string | null = body.signalId ?? null;
    const stopLoss: number | undefined = body.stopLoss != null ? Number(body.stopLoss) : undefined;
    const takeProfit: number | undefined = body.takeProfit != null ? Number(body.takeProfit) : undefined;

    // Madhësia e lot-it: e dhëna ose default, e kufizuar nga max_lot.
    let volume = Number(body.volume ?? config.default_lot) || config.default_lot;
    if (volume > config.max_lot) volume = config.max_lot;
    if (volume < 0.01) volume = 0.01;
    volume = Math.round(volume * 100) / 100;

    const logExec = (status: string, reason: string, orderId: string | null, raw: unknown) =>
      db.from("trade_executions").insert({
        user_id: user.id, signal_id: signalId, symbol, action, volume,
        stop_loss: stopLoss ?? null, take_profit: takeProfit ?? null,
        mode: config.mode, status, reason, metaapi_order_id: orderId, raw_response: raw ?? null,
      });

    // --- MBROJTJET E RREZIKUT (të detyrueshme) ---
    if (config.kill_switch) {
      await logExec("rejected", "Kill-switch aktiv — të gjitha tregtitë e bllokuara.", null, null);
      return json({ error: "kill_switch", message: "Kill-switch aktiv. Çaktivizoje për të tregtuar." }, 403);
    }

    // Gjendja aktuale e llogarisë nga MetaApi (pozicione + humbje e lëvizshme).
    let openTrades = 0;
    let dayPnl = 0; // realized(sot) + floating(tani); negativ = humbje
    let grossLoss = 0; // humbja BRUTO e ditës (vetëm trade-t humbëse)
    try {
      const positions = await metaApiGet(config, "/positions") as Array<{ profit?: number }>;
      openTrades = Array.isArray(positions) ? positions.length : 0;
      const info = await metaApiGet(config, "/account-information") as { balance?: number; equity?: number };
      const bal = Number(info?.balance), eq = Number(info?.equity);
      const floatingPnl = Number.isFinite(bal) && Number.isFinite(eq) ? eq - bal : 0;
      const realized = await realizedToday(config);
      dayPnl = realized + floatingPnl;
      grossLoss = await grossLossToday(config);
    } catch (e) {
      await logExec("error", `S'u arrit MetaApi: ${(e as Error).message}`, null, null);
      return json({ error: "metaapi_unreachable", message: (e as Error).message }, 502);
    }

    if (openTrades >= config.max_open_trades) {
      await logExec("rejected", `Arritur numri maksimal i tregtive të hapura (${config.max_open_trades}).`, null, null);
      return json({ error: "max_open_trades", message: `Arritur limiti i pozicioneve të hapura (${config.max_open_trades}).` }, 403);
    }
    const maxDaily = Number(config.max_daily_loss) || 0;
    if (maxDaily > 0 && (dayPnl <= -maxDaily || grossLoss >= maxDaily)) {
      await logExec("rejected", `Limit humbjeje ditore arritur (neto ${dayPnl.toFixed(2)}, bruto ${grossLoss.toFixed(2)}, kufi ${maxDaily}).`, null, null);
      return json({ error: "max_daily_loss", message: "Arritur limiti i humbjes ditore. Tregtitë e reja u bllokuan." }, 403);
    }

    // --- EKZEKUTIMI ---
    // Lloji i porosisë: TREG (menjëherë) ose NË PRITJE (kur çmimi s'është ende te hyrja e dhënë).
    // Nëse `entryPrice` jepet dhe ndryshon nga çmimi aktual, vendoset porosi LIMIT/STOP te ai nivel
    // (hyn vetëm kur çmimi e arrin). Përndryshe → porosi tregu menjëherë.
    const entryPrice: number | undefined =
      body.entryPrice != null && Number.isFinite(Number(body.entryPrice)) ? Number(body.entryPrice) : undefined;
    let actionType = action === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
    let openPrice: number | undefined;
    let pending = false;
    if (entryPrice != null) {
      try {
        const pr = await metaApiGet(config, `/symbols/${encodeURIComponent(symbol)}/current-price`) as { ask?: number; bid?: number };
        const ask = Number(pr?.ask), bid = Number(pr?.bid);
        const ref = action === "BUY" ? (Number.isFinite(ask) ? ask : bid) : (Number.isFinite(bid) ? bid : ask);
        const spread = (Number.isFinite(ask) && Number.isFinite(bid)) ? Math.abs(ask - bid) : 0;
        if (Number.isFinite(ref) && ref > 0) {
          const tol = Math.max(spread * 1.5, ref * 0.0002); // ~afër çmimit → trajtoje si treg
          if (Math.abs(entryPrice - ref) > tol) {
            pending = true;
            openPrice = Math.round(entryPrice * 100) / 100;
            if (action === "BUY") actionType = entryPrice < ref ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_BUY_STOP";
            else actionType = entryPrice > ref ? "ORDER_TYPE_SELL_LIMIT" : "ORDER_TYPE_SELL_STOP";
          }
        }
      } catch { /* nëse s'merret çmimi live, biem te porosia e tregut */ }
    }

    const tradeBody: Record<string, unknown> = { actionType, symbol, volume };
    if (pending && openPrice != null) tradeBody.openPrice = openPrice;
    if (stopLoss != null && Number.isFinite(stopLoss)) tradeBody.stopLoss = stopLoss;
    if (takeProfit != null && Number.isFinite(takeProfit)) tradeBody.takeProfit = takeProfit;

    const resp = await fetch(`${host(config.region)}/users/current/accounts/${config.account_id}/trade`, {
      method: "POST",
      headers: { "auth-token": config.token, "Content-Type": "application/json" },
      body: JSON.stringify(tradeBody),
      signal: AbortSignal.timeout(20000),
    });
    const respText = await resp.text();
    let respBody: unknown = respText;
    try { respBody = JSON.parse(respText); } catch { /* tekst */ }

    if (!resp.ok) {
      await logExec("error", `MetaApi trade ${resp.status}`, null, respBody);
      return json({ error: "trade_failed", status: resp.status, details: respBody }, 502);
    }

    // MetaApi kthen HTTP 200 edhe kur brokeri e REFUZON urdhrin — rezultati i vërtetë
    // është te numericCode (10009 = DONE). Lexo statusin real.
    const rb = (respBody ?? {}) as Record<string, unknown>;
    const code = Number(rb.numericCode);
    const orderId = (rb.orderId as string) ?? (rb.positionId as string) ?? null;
    const brokerMsg = String(rb.message ?? "");
    const ok = code === 10009 || code === 10008 || code === 10010 || (!!orderId && !Number.isFinite(code));

    if (!ok) {
      await logExec("rejected", `Brokeri: ${brokerMsg || "refuzuar"} (${code})`, null, respBody);
      return json({ error: "broker_rejected", code, message: brokerMsg || "Urdhri u refuzua nga brokeri.", result: respBody }, 200);
    }

    await logExec("executed", pending ? `Porosi në pritje @ ${openPrice} (${config.mode})` : `OK (${config.mode})`, orderId, respBody);
    return json({
      success: true,
      mode: config.mode,
      symbol, action, volume,
      pending, open_price: openPrice ?? null,
      order_id: orderId,
      result: respBody,
    });
  } catch (err) {
    return json({ error: "internal", message: (err as Error).message }, 500);
  }
});
