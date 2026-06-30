import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// demo-trade-runner — cron. VIRTUAL paper-trading që pasqyron robotin LIVE, por:
//   • SWING: të njëjtat sinjale të motorit (signals, source='engine')
//   • SCALP: i njëjti momentum 1m/5m si auto-trade-runner, me qirinj REALË nga Binance (PAXG)
//   • me çmimet REALE të arit (assets.current_price) për vlerësim
//   • PA MetaApi, PA para reale → punon edhe kur MetaApi është poshtë.
// Çdo user ka një kuletë virtuale €100 (profiles.demo_balance). Madhësimi i pozicionit
// është i njëjtë me auto-trade-runner (fixed-fractional sipas risk_per_trade_pct + presetit).
// NUK prek auto-trade-runner-in, metaapi_config, as tregtimin real.
//
// Cron: çdo 2 min. Portë sigurie x-cron-secret (fail-safe: lejo nëse s'ka sekret).

// Njoftim Web Push (best-effort) — thërret web-push-send me service-role. S'duhet të ndalë robotin.
async function pushNotify(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/web-push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* njoftimi s'duhet të ndalë robotin */ }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

const OPEN_WINDOW_MIN = 15;   // sinjale të freskëta për të hapur swing demo-trade
const EXPIRE_H = 48;          // demo-trade i pambyllur pas 48h → 'closed' (exit_reason='expired')
const SCALP_COOLDOWN_S = 170; // mos hap dy scalp brenda ~3 min për të njëjtin user

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function normSym(s: string): string { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function valuePerPrice(symbol: string): number {
  const s = normSym(symbol);
  if (s.includes("XAU") || s.includes("GOLD")) return 100;
  if (s.includes("USOIL") || s.includes("UKOIL") || s.includes("OIL") || s.includes("WTI") || s.includes("BRENT")) return 1000;
  return 100000;
}

// ---------- Sesioni i arit (Frankfurt 09:00–23:00, DST automatik) — si te live ----------
function frankfurtHour(d = new Date()): number {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(d);
  return parseInt(s, 10) || 0;
}
function goldSessionOpen(): boolean { const h = frankfurtHour(); return h >= 9 && h < 23; }

// ---------- Indikatorë (identikë me auto-trade-runner) ----------
interface Candle { time: number; open: number; high: number; low: number; close: number; }
function ema(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length < p) return out;
  const k = 2 / (p + 1); let s = 0;
  for (let i = 0; i < p; i++) s += v[i];
  let prev = s / p; out[p - 1] = prev;
  for (let i = p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsi(v: number[], p = 14): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const c = v[i] - v[i - 1]; if (c >= 0) g += c; else l -= c; }
  let ag = g / p, al = l / p;
  const rf = (a: number, b: number) => (b === 0 ? 100 : 100 - 100 / (1 + a / b));
  out[p] = rf(ag, al);
  for (let i = p + 1; i < v.length; i++) {
    const c = v[i] - v[i - 1];
    ag = (ag * (p - 1) + (c > 0 ? c : 0)) / p;
    al = (al * (p - 1) + (c < 0 ? -c : 0)) / p;
    out[i] = rf(ag, al);
  }
  return out;
}
function macdHist(v: number[]): number[] {
  const ef = ema(v, 12), es = ema(v, 26);
  const line = v.map((_, i) => (Number.isNaN(ef[i]) || Number.isNaN(es[i]) ? NaN : ef[i] - es[i]));
  const first = line.findIndex((x) => !Number.isNaN(x));
  const sig = new Array(v.length).fill(NaN);
  if (first !== -1) { const s = ema(line.slice(first), 9); for (let i = 0; i < s.length; i++) sig[first + i] = s[i]; }
  return v.map((_, i) => (Number.isNaN(line[i]) || Number.isNaN(sig[i]) ? NaN : line[i] - sig[i]));
}
function atr(highs: number[], lows: number[], closes: number[], p = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= p) return out;
  const tr = new Array(n).fill(NaN); tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i];
  let prev = s / p; out[p] = prev;
  for (let i = p + 1; i < n; i++) { prev = (prev * (p - 1) + tr[i]) / p; out[i] = prev; }
  return out;
}

// ---------- MOTORI SCALP (kopjuar identik nga auto-trade-runner) ----------
function scalpSignal(c1m: Candle[], c5m: Candle[], loose = false): { action: "BUY" | "SELL"; reason: string } | null {
  if (c1m.length < 35 || c5m.length < 30) return null;
  const cl1 = c1m.map((c) => c.close), cl5 = c5m.map((c) => c.close);
  const i1 = cl1.length - 1, i5 = cl5.length - 1;

  const e9_5 = ema(cl5, 9)[i5], e21_5 = ema(cl5, 21)[i5];
  if (!Number.isFinite(e9_5) || !Number.isFinite(e21_5)) return null;
  const dir5 = e9_5 > e21_5 ? "up" : e9_5 < e21_5 ? "down" : "flat";
  if (dir5 === "flat") return null;

  const e9_1 = ema(cl1, 9)[i1], e21_1 = ema(cl1, 21)[i1];
  const r1 = rsi(cl1, 14)[i1];
  const mh1 = macdHist(cl1)[i1];
  const price = cl1[i1];
  const last = c1m[i1];
  if (!Number.isFinite(e9_1) || !Number.isFinite(e21_1) || !Number.isFinite(r1) || !Number.isFinite(mh1)) return null;

  if (loose) {
    const hi5 = c5m.map((c) => c.high), lo5 = c5m.map((c) => c.low);
    const hi1 = c1m.map((c) => c.high), lo1 = c1m.map((c) => c.low);
    const e9_5arr = ema(cl5, 9);
    const slope5 = e9_5arr[i5] - e9_5arr[i5 - 2];
    const atr5 = atr(hi5, lo5, cl5, 14)[i5];
    const atr1 = atr(hi1, lo1, cl1, 14)[i1];
    if (Number.isFinite(atr5) && atr5 > 0 && Math.abs(e9_5 - e21_5) < 0.30 * atr5) return null;
    const band = Number.isFinite(atr1) && atr1 > 0 ? 1.2 * atr1 : 1.5;
    if (Math.abs(price - e9_1) > band) return null;
    if (dir5 === "down" && slope5 < 0 && last.close < last.open && r1 >= 38 && r1 <= 68)
      return { action: "SELL", reason: "Scalp (lëvizje të vogla): pullback në trend 5m↓" };
    if (dir5 === "up" && slope5 > 0 && last.close > last.open && r1 >= 32 && r1 <= 62)
      return { action: "BUY", reason: "Scalp (lëvizje të vogla): pullback në trend 5m↑" };
    return null;
  }

  if (dir5 === "up" && e9_1 > e21_1 && price > e9_1 && last.close > last.open && r1 < 75 && mh1 > 0) {
    const recentHigh = Math.max(c1m[i1 - 1].high, c1m[i1 - 2].high, c1m[i1 - 3].high);
    if (price >= recentHigh) return { action: "BUY", reason: "Scalp: momentum 1m↑ në trend 5m↑ (breakout)" };
  }
  if (dir5 === "down" && e9_1 < e21_1 && price < e9_1 && last.close < last.open && r1 > 25 && mh1 < 0) {
    const recentLow = Math.min(c1m[i1 - 1].low, c1m[i1 - 2].low, c1m[i1 - 3].low);
    if (price <= recentLow) return { action: "SELL", reason: "Scalp: momentum 1m↓ në trend 5m↓ (breakdown)" };
  }
  return null;
}

// ---------- Qirinj REALË nga Binance (PAXG = ar), pa MetaApi ----------
async function fetchBinance(interval: string, limit: number): Promise<Candle[] | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const raw = (await resp.json()) as unknown[][];
    return raw.map((k) => ({
      time: Number(k[0]), open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string),
    }));
  } catch { return null; }
}

// ---------- Çmim + qirinj REALË nga MT5 (MetaApi) — pasqyrë e saktë si live (jo PAXG) ----------
function maHost(region: string): string { return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`; }
function maMarketHost(region: string): string { return `https://mt-market-data-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`; }
// Zgjedh një llogari referencë (preferon 'live') për çmimin REAL të brokerit — i njëjti për të gjithë (çmimi i arit s'ndryshon mes llogarive të të njëjtit broker).
function pickRefCfg(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  const valid = rows.filter((c) => c.account_id && c.token);
  return valid.find((c) => String(c.mode) === "live") ?? valid[0] ?? null;
}
function goldSymbolFor(cfg: Record<string, unknown> | null): string {
  const map = (cfg?.symbol_map && typeof cfg.symbol_map === "object") ? cfg.symbol_map as Record<string, string> : {};
  return map["XAUUSD"] || map["XAU"] || "XAUUSD";
}
async function maRealPrice(cfg: Record<string, unknown>, symbol: string): Promise<number | null> {
  try {
    const r = await fetch(`${maHost(String(cfg.region))}/users/current/accounts/${cfg.account_id}/symbols/${encodeURIComponent(symbol)}/current-price?keepSubscription=true`,
      { headers: { "auth-token": String(cfg.token) }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json() as { bid?: number; ask?: number };
    const bid = Number(j?.bid), ask = Number(j?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
    return null;
  } catch { return null; }
}
async function maCandles(cfg: Record<string, unknown>, symbol: string, tf: string, limit: number): Promise<Candle[] | null> {
  try {
    const r = await fetch(`${maMarketHost(String(cfg.region))}/users/current/accounts/${cfg.account_id}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${tf}/candles?limit=${limit}`,
      { headers: { "auth-token": String(cfg.token) }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const arr = await r.json() as Record<string, unknown>[];
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((k) => ({ time: new Date((k.time ?? k.brokerTime) as string).getTime(), open: +(k.open as number), high: +(k.high as number), low: +(k.low as number), close: +(k.close as number) }));
  } catch { return null; }
}

// ---------- Madhësimi i pozicionit (njëlloj si live) ----------
function lotForConfidence(cfg: Record<string, unknown>, conf: number): number {
  let lot = Number(cfg.default_lot) || 0.01;
  if (cfg.dynamic_lot) {
    const t1 = Number(cfg.lot_conf_t1) || 70, t2 = Number(cfg.lot_conf_t2) || 80, t3 = Number(cfg.lot_conf_t3) || 90;
    if (conf >= t3) lot = Number(cfg.lot_conf_90) || lot;
    else if (conf >= t2) lot = Number(cfg.lot_conf_80) || lot;
    else if (conf >= t1) lot = Number(cfg.lot_conf_70) || lot;
    else lot = Number(cfg.lot_conf_70) || lot;
  }
  const maxLot = Number(cfg.max_lot) || 1;
  return Math.max(0.01, Math.min(lot, maxLot));
}
function sizeVolume(cfg: Record<string, unknown>, equity: number, conf: number, slPriceDist: number, symbol: string): number {
  const lot = lotForConfidence(cfg, conf);
  const riskPct = Number(cfg.risk_per_trade_pct) || 1;
  const maxLot = Number(cfg.max_lot) || 1;
  const equityRisk = (equity * riskPct) / 100;
  const maxDaily = Number(cfg.max_daily_loss) > 0 ? Number(cfg.max_daily_loss) : equityRisk;
  const perTradeRisk = Math.min(equityRisk, maxDaily);
  const vpp = valuePerPrice(symbol);
  let volume = lot;
  if (slPriceDist > 0 && vpp > 0) {
    const lotByRisk = Math.floor((perTradeRisk / (slPriceDist * vpp)) * 100) / 100;
    volume = Math.min(lot, lotByRisk, maxLot);
  }
  volume = Math.round(volume * 100) / 100;
  if (volume < 0.01) volume = 0.01;
  return volume;
}

const DEFAULT_CFG: Record<string, unknown> = {
  default_lot: 0.01, max_lot: 1, risk_per_trade_pct: 1, max_daily_loss: 0,
  max_open_trades: 5, min_confidence: 55, dynamic_lot: false,
  scalp_sl_usd: 2, scalp_tp_usd: 4, scalp_max_trades: 3, scalp_small_moves: true,
};

// FILTRA TË EKSPERTËVE (provë VETËM në DEMO — para integrimit te roboti real).
// Bazuar te analizat e Dhomës së Ekspertëve mbi trade-t REALE: humbjet (SL)
// grumbullohen te hyrjet e MBI-EKSTENDUARA (ADX shumë i lartë + RSI në ekstrem,
// rrezik kthimi) dhe në orët e MBRËMJES ET 17–20 (likuiditet i ulët).
// Kthen arsyen e bllokimit nëse sinjali duhet kaluar, ose null nëse lejohet.
const EXPERT_FILTERS_DEMO = true;
function expertVeto(f: Record<string, unknown> | null | undefined): string | null {
  if (!EXPERT_FILTERS_DEMO || !f) return null;
  const adx = typeof f.adx === "number" ? f.adx : null;
  const rsi = typeof f.rsi === "number" ? f.rsi : null;
  const et = typeof f.et_hour === "number" ? f.et_hour : null;
  // 1) Mbi-ekstendim: ADX>50 me RSI në ekstrem (<25 ose >75) → lëvizje e shteruar.
  if (adx != null && adx > 50 && rsi != null && (rsi < 25 || rsi > 75)) return "over-extended";
  // 2) Sesioni i mbrëmjes ET 17–20: dalje me SL në likuiditet të ulët.
  if (et != null && et >= 17 && et <= 20) return "evening-ET";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { /* fail-safe */ }

  let dryRun = false;
  try { const b = await req.json(); dryRun = b?.dryRun === true; } catch { /* pa trup */ }

  try {
    // 1) Konfigurimi per-user.
    const { data: cfgRows } = await db.from("metaapi_config").select("*");
    const cfgBy = new Map<string, Record<string, unknown>>();
    for (const c of (cfgRows ?? []) as Record<string, unknown>[]) cfgBy.set(String(c.user_id), c);
    const cfgFor = (uid: string) => ({ ...DEFAULT_CFG, ...(cfgBy.get(uid) ?? {}) });

    // 2) Çmimet aktuale (real) sipas simbolit.
    const { data: assetRows } = await db.from("assets").select("symbol, current_price");
    const priceBy = new Map<string, number>();
    for (const a of (assetRows ?? []) as { symbol: string; current_price: number | null }[]) {
      if (a.current_price != null) priceBy.set(normSym(a.symbol), Number(a.current_price));
    }
    // BURIM REAL (MetaApi): mbivendos çmimin e arit me atë REAL të brokerit (MT5) — pasqyrë e saktë si live.
    // Fallback: nëse MetaApi s'është gati, mbetet çmimi PAXG nga assets. Metodologjia s'preket.
    const refCfg = pickRefCfg((cfgRows ?? []) as Record<string, unknown>[]);
    const realGoldSym = goldSymbolFor(refCfg);
    let realGold: number | null = null;
    if (refCfg) {
      realGold = await maRealPrice(refCfg, realGoldSym);
      if (realGold != null) { priceBy.set("XAUUSD", realGold); priceBy.set("XAU", realGold); priceBy.set(normSym(realGoldSym), realGold); }
    }

    // 3) Trade-t e hapura — vlerësohen TË GJITHA (edhe ato manuale, që të mbyllen te SL/TP).
    const { data: openTrades } = await db
      .from("demo_trades")
      .select("id, user_id, symbol, side, volume, entry_price, sl, tp, signal_id, opened_at")
      .eq("status", "open")
      .limit(2000);
    const openRows = (openTrades ?? []) as { id: string; user_id: string; symbol: string; side: string; volume: number; entry_price: number; sl: number | null; tp: number | null; signal_id: string | null; opened_at: string }[];

    // 4) SANDBOX PERSONAL: roboti auto-demo hap trade VETËM për userat që e kanë ndezur VETË
    //    (profiles.demo_auto = true). Vlerësimi/mbyllja vlen për këdo që ka trade të hapura.
    const { data: autoProfs } = await db.from("profiles").select("id, demo_balance").eq("demo_auto", true);
    const autoUsers = (autoProfs ?? []) as { id: string; demo_balance: number | null }[];

    // Tregtimet e SHKURTA (scalp) në demo hapen VETËM për userat që e kanë NDEZUR butonin
    // (metaapi_config.strategy_scalp=true). Default OFF → si te live. Tregtimet e gjata (sinjale) s'preken.
    const scalpEnabled = new Set<string>();
    if (autoUsers.length) {
      const { data: scfg } = await db.from("metaapi_config").select("user_id, strategy_scalp")
        .in("user_id", autoUsers.map((u) => u.id));
      for (const c of (scfg ?? []) as { user_id: string; strategy_scalp: boolean | null }[])
        if (c.strategy_scalp === true) scalpEnabled.add(c.user_id);
    }

    // 5) Balanca per-user: për këdo me trade të hapura + userat me robot auto.
    const idsNeeded = new Set<string>(autoUsers.map((u) => u.id));
    for (const t of openRows) idsNeeded.add(t.user_id);
    if (idsNeeded.size === 0) return json({ ok: true, dryRun, opened: 0, closed: 0, note: "no demo activity" });
    const bal = new Map<string, number>();
    const startBal = new Map<string, number>();
    const { data: balProfs } = await db.from("profiles").select("id, demo_balance").in("id", Array.from(idsNeeded));
    for (const p of (balProfs ?? []) as { id: string; demo_balance: number | null }[]) {
      bal.set(p.id, Number(p.demo_balance ?? 100)); startBal.set(p.id, Number(p.demo_balance ?? 100));
    }

    let opened = 0, closed = 0, openedScalp = 0, vetoed = 0;

    // 6) VLERËSIM — mbyll demo-trade-t e hapura kur prekin TP/SL (ose skadojnë).
    const expireBefore = Date.now() - EXPIRE_H * 60 * 60 * 1000;
    const openCountBy = new Map<string, number>();   // gjithsej të hapura
    const scalpOpenBy = new Map<string, number>();   // vetëm scalp (signal_id null)

    for (const t of openRows) {
      if (!bal.has(t.user_id)) continue;
      const price = priceBy.get(normSym(t.symbol));
      const isBuy = (t.side || "").toLowerCase() === "buy";
      const entry = Number(t.entry_price), sl = t.sl != null ? Number(t.sl) : null, tp = t.tp != null ? Number(t.tp) : null;
      const vpp = valuePerPrice(t.symbol);
      let exitReason: string | null = null, exitPrice: number | null = null;

      if (price != null) {
        const hitTp = tp != null && (isBuy ? price >= tp : price <= tp);
        const hitSl = sl != null && (isBuy ? price <= sl : price >= sl);
        if (hitTp) { exitReason = "tp"; exitPrice = tp; }
        else if (hitSl) { exitReason = "sl"; exitPrice = sl; }
      }
      if (!exitReason && new Date(t.opened_at).getTime() < expireBefore) { exitReason = "expired"; exitPrice = price ?? entry; }

      if (exitReason && exitPrice != null) {
        const profit = (exitPrice - entry) * (isBuy ? 1 : -1) * Number(t.volume) * vpp;
        if (!dryRun) {
          await db.from("demo_trades").update({
            status: "closed", exit_price: exitPrice, exit_reason: exitReason,
            profit: Math.round(profit * 100) / 100, closed_at: new Date().toISOString(),
          }).eq("id", t.id);
        }
        bal.set(t.user_id, (bal.get(t.user_id) ?? 0) + profit);
        closed++;
      } else {
        openCountBy.set(t.user_id, (openCountBy.get(t.user_id) ?? 0) + 1);
        if (t.signal_id == null) scalpOpenBy.set(t.user_id, (scalpOpenBy.get(t.user_id) ?? 0) + 1);
      }
    }

    // 7) HAPJE SWING — sinjale reale, vetëm për userat me robot auto të ndezur (dedup per user+signal).
    const sinceIso = new Date(Date.now() - OPEN_WINDOW_MIN * 60 * 1000).toISOString();
    const { data: sigs } = await db
      .from("signals")
      .select("id, symbol, type, entry_price, target_price, stop_loss, confidence, created_at, features")
      .eq("source", "engine").gte("created_at", sinceIso)
      .order("created_at", { ascending: false }).limit(50);
    const signals = (sigs ?? []) as { id: string; symbol: string; type: string; entry_price: number | null; target_price: number | null; stop_loss: number | null; confidence: number | null; created_at: string; features: Record<string, unknown> | null }[];

    if (signals.length > 0) {
      const sigIds = signals.map((s) => s.id);
      const { data: existing } = await db.from("demo_trades").select("user_id, signal_id").in("signal_id", sigIds);
      const seen = new Set<string>();
      for (const e of (existing ?? []) as { user_id: string; signal_id: string | null }[]) {
        if (e.signal_id) seen.add(`${e.user_id}|${e.signal_id}`);
      }
      const toInsert: Record<string, unknown>[] = [];
      for (const u of autoUsers) {
        const cfg = cfgFor(u.id);
        const minConf = Number(cfg.min_confidence);
        const maxOpen = Number(cfg.max_open_trades) || 5;
        let cnt = openCountBy.get(u.id) ?? 0;
        for (const s of signals) {
          if (cnt >= maxOpen) break;
          if (s.entry_price == null || s.stop_loss == null) continue;
          if (Number(s.confidence ?? 0) < minConf) continue;
          // SHKALLËZIM SIPAS BESUESHMËRISË: pozicioni i 2-të njëkohësisht kërkon ≥80%, i 3-ti e tutje ≥90%.
          {
            const confPct = Number(s.confidence ?? 0);
            if (cnt >= 2 && confPct < 90) continue;
            if (cnt >= 1 && confPct < 80) continue;
          }
          if (seen.has(`${u.id}|${s.id}`)) continue;
          const veto = expertVeto(s.features);   // FILTËR EKSPERTËSH (DEMO) — kalo hyrjet e dobëta
          if (veto) { vetoed++; continue; }
          let entry = Number(s.entry_price), sl = Number(s.stop_loss);
          const slDist = Math.abs(entry - sl);
          if (!(slDist > 0)) continue;
          const isBuy = (s.type || "").toLowerCase() === "buy";
          let tp = s.target_price != null ? Number(s.target_price) : (isBuy ? entry + slDist * 2 : entry - slDist * 2);
          const tpDist = Math.abs(tp - entry);
          // ANCHOR te çmimi REAL i brokerit, duke RUAJTUR distancat e sinjalit (SL/TP) — metodologjia s'preket,
          // por hyrja/dalja vlerësohen në shkallën reale të MT5 (jo PAXG) → pasqyrë e saktë.
          const realS = priceBy.get(normSym(s.symbol));
          if (realS != null && (normSym(s.symbol).includes("XAU") || normSym(s.symbol).includes("GOLD"))) {
            entry = realS;
            sl = isBuy ? entry - slDist : entry + slDist;
            tp = isBuy ? entry + tpDist : entry - tpDist;
          }
          const volume = sizeVolume(cfg, bal.get(u.id) ?? 100, Number(s.confidence ?? 70), slDist, s.symbol);
          toInsert.push({ user_id: u.id, signal_id: s.id, symbol: s.symbol, side: isBuy ? "buy" : "sell", volume, entry_price: entry, sl, tp, status: "open", source: "signal" });
          // Push (DEMO) — hyrje nga sinjali, me detaje + shenjën DEMO.
          await pushNotify({ user_id: u.id, title: `🧪 DEMO: ${isBuy ? "BLEJ" : "SHIT"} ${s.symbol}`,
            body: `${volume} lot • Hyrje ${entry.toFixed(2)} · TP ${tp.toFixed(2)} · SL ${sl.toFixed(2)} (demo)`,
            url: "/demo", tag: "demo-trade-open" });
          seen.add(`${u.id}|${s.id}`); cnt++; opened++;
        }
        openCountBy.set(u.id, cnt);
      }
      if (!dryRun && toInsert.length) await db.from("demo_trades").insert(toInsert);
    }

    // 8) HAPJE SCALP — momentum 1m/5m i arit, vetëm për userat me robot auto. Vetëm në sesion.
    let scalp: { action: "BUY" | "SELL"; reason: string } | null = null;
    let scalpEntry = 0;
    if (goldSessionOpen()) {
      // Qirinj REALË nga MT5 (MetaApi); fallback te PAXG nëse MT5 s'është gati. Logjika e scalp-it s'preket.
      let c1m: Candle[] | null = null, c5m: Candle[] | null = null;
      if (refCfg) [c1m, c5m] = await Promise.all([maCandles(refCfg, realGoldSym, "1m", 120), maCandles(refCfg, realGoldSym, "5m", 120)]);
      if (!c1m || !c5m || c1m.length < 35 || c5m.length < 30) [c1m, c5m] = await Promise.all([fetchBinance("1m", 120), fetchBinance("5m", 120)]);
      if (c1m && c5m && c1m.length >= 35 && c5m.length >= 30) {
        scalpEntry = realGold != null ? realGold : c1m[c1m.length - 1].close;  // hyrje te çmimi REAL nëse e kemi
        // Provo "loose" (lëvizje të vogla) e pastaj strict — që demo të jetë aktive si scalp-i live.
        scalp = scalpSignal(c1m, c5m, true) ?? scalpSignal(c1m, c5m, false);
      }
    }

    if (scalp && scalpEntry > 0) {
      // Cilët user janë në cooldown (hapën scalp brenda ~3 min).
      const cdIso = new Date(Date.now() - SCALP_COOLDOWN_S * 1000).toISOString();
      const { data: recentScalp } = await db.from("demo_trades")
        .select("user_id").is("signal_id", null).gte("opened_at", cdIso);
      const onCooldown = new Set<string>();
      for (const r of (recentScalp ?? []) as { user_id: string }[]) onCooldown.add(r.user_id);

      const isBuy = scalp.action === "BUY";
      const toInsert: Record<string, unknown>[] = [];
      for (const u of autoUsers) {
        if (!scalpEnabled.has(u.id)) continue; // tregtimet e shkurta OFF → mos hap scalp
        if (onCooldown.has(u.id)) continue;
        const cfg = cfgFor(u.id);
        const maxOpen = Number(cfg.max_open_trades) || 5;
        const scalpMax = Number(cfg.scalp_max_trades) || 3;
        if ((openCountBy.get(u.id) ?? 0) >= maxOpen) continue;
        if ((scalpOpenBy.get(u.id) ?? 0) >= scalpMax) continue;
        const slUsd = Number(cfg.scalp_sl_usd) || 2;
        const tpUsd = Number(cfg.scalp_tp_usd) || 4;
        const sl = isBuy ? scalpEntry - slUsd : scalpEntry + slUsd;
        const tp = isBuy ? scalpEntry + tpUsd : scalpEntry - tpUsd;
        const volume = sizeVolume(cfg, bal.get(u.id) ?? 100, 70, slUsd, "XAUUSD");
        toInsert.push({ user_id: u.id, signal_id: null, symbol: "XAUUSD", side: isBuy ? "buy" : "sell", volume, entry_price: scalpEntry, sl, tp, status: "open", source: "scalp" });
        openCountBy.set(u.id, (openCountBy.get(u.id) ?? 0) + 1);
        openedScalp++;
      }
      if (!dryRun && toInsert.length) await db.from("demo_trades").insert(toInsert);
    }

    // 9) Shkruaj balancat e ndryshuara (vetëm aty ku mbyllja ndryshoi balancën).
    if (!dryRun) {
      for (const [id, nbRaw] of bal) {
        const nb = Math.round(nbRaw * 100) / 100;
        if (nb !== Math.round((startBal.get(id) ?? 100) * 100) / 100) await db.from("profiles").update({ demo_balance: nb }).eq("id", id);
      }
    }

    return json({ ok: true, dryRun, autoUsers: autoUsers.length, evaluated: openRows.length, opened, openedScalp, closed, vetoed, session: goldSessionOpen(), scalp: scalp?.reason ?? null });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
