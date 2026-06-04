import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// auto-trade-runner — cron (çdo minutë). Çelësi: SL/TP ankorohen te çmimi REAL i MT5
// (jo PAXG), dhe Claude merr kontekstin shumë-periudhash të grafikut MT5 para se të
// pranojë trade-in. Plus: rrezik via lot, trailing/break-even, statusi real i brokerit.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Cfg {
  user_id: string; account_id: string; token: string; region: string; mode: string;
  default_lot: number; max_lot: number; max_daily_loss: number; max_open_trades: number;
  kill_switch: boolean; min_confidence: number; auto_symbols: string;
  dynamic_lot?: boolean; lot_conf_70?: number; lot_conf_80?: number; lot_conf_90?: number;
}

interface Signal {
  id: string; symbol: string; type: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  analysis: string | null;
}

interface Position {
  id: string; type?: string; openPrice?: number; currentPrice?: number;
  stopLoss?: number; takeProfit?: number; profit?: number;
}

interface Candle { time: number; open: number; high: number; low: number; close: number; }

function host(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}
function marketDataHost(region: string) {
  return `https://mt-market-data-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

function valuePerPrice(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU")) return 100;
  if (s.includes("XAG")) return 5000;
  if (/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test(s)) return 1;
  if (s.length === 6) return 100000;
  return 100;
}

// Madhësia e pozicionit sipas % të analizës (≥70/≥80/≥90), e kapur te max_lot.
function lotForConfidence(cfg: Cfg, conf: number): number {
  let lot: number;
  if (cfg.dynamic_lot === false) {
    lot = Number(cfg.default_lot) || 0.01;
  } else {
    lot = Number(cfg.lot_conf_70 ?? 0.01);
    if (conf >= 80) lot = Number(cfg.lot_conf_80 ?? 0.02);
    if (conf >= 90) lot = Number(cfg.lot_conf_90 ?? 0.05);
  }
  const maxLot = Number(cfg.max_lot) || lot;
  lot = Math.min(lot, maxLot);
  if (!(lot >= 0.01)) lot = 0.01;
  return Math.round(lot * 100) / 100;
}

// ---------- Indikatorë (për kontekstin e grafikut MT5) ----------
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
function adx(highs: number[], lows: number[], closes: number[], p = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= p * 2 + 1) return out;
  const pdm = new Array(n).fill(0), mdm = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let as = 0, ps = 0, ms = 0;
  for (let i = 1; i <= p; i++) { as += tr[i]; ps += pdm[i]; ms += mdm[i]; }
  const dx = new Array(n).fill(NaN);
  for (let i = p + 1; i < n; i++) {
    as = as - as / p + tr[i]; ps = ps - ps / p + pdm[i]; ms = ms - ms / p + mdm[i];
    const pdi = as === 0 ? 0 : 100 * ps / as, mdi = as === 0 ? 0 : 100 * ms / as;
    const den = pdi + mdi; dx[i] = den === 0 ? 0 : 100 * Math.abs(pdi - mdi) / den;
  }
  const f = dx.findIndex((x) => !Number.isNaN(x));
  if (f === -1 || f + p >= n) return out;
  let sum = 0; for (let i = f; i < f + p; i++) sum += dx[i];
  let prev = sum / p; out[f + p - 1] = prev;
  for (let i = f + p; i < n; i++) { prev = (prev * (p - 1) + dx[i]) / p; out[i] = prev; }
  return out;
}
const rn = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// Pivot-e (mbështetje/rezistencë) nga lëkundjet lokale.
function swingLevels(highs: number[], lows: number[], lb = 3): { res: number[]; sup: number[] } {
  const res: number[] = [], sup: number[] = [];
  for (let i = lb; i < highs.length - lb; i++) {
    let ph = true, pl = true;
    for (let j = i - lb; j <= i + lb; j++) { if (highs[j] > highs[i]) ph = false; if (lows[j] < lows[i]) pl = false; }
    if (ph) res.push(highs[i]);
    if (pl) sup.push(lows[i]);
  }
  return { res, sup };
}

interface TF { tf: string; price: number; atr: number; snapshot: Record<string, unknown>; res: number[]; sup: number[]; }
function buildTF(candles: Candle[], tf: string): TF {
  const closes = candles.map((c) => c.close), highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
  const i = candles.length - 1;
  const e9 = ema(closes, 9)[i], e21 = ema(closes, 21)[i], e50 = ema(closes, 50)[i], e200 = ema(closes, 200)[i];
  const r = rsi(closes, 14)[i], mh = macdHist(closes)[i], a = atr(highs, lows, closes, 14)[i], ad = adx(highs, lows, closes, 14)[i];
  const price = closes[i];
  const above200 = Number.isFinite(e200) ? price > e200 : e9 > e21;
  const trend = (above200 && e9 > e21) ? "up" : (!above200 && e9 < e21) ? "down" : "range";
  const sw = swingLevels(highs, lows, 3);
  return {
    tf, price, atr: Number.isFinite(a) ? a : 0, res: sw.res, sup: sw.sup,
    snapshot: { timeframe: tf, price: rn(price), ema9: rn(e9), ema21: rn(e21), ema50: rn(e50), ema200: rn(e200),
      rsi14: Number.isFinite(r) ? Math.round(r) : null, macdHist: rn(mh), atr14: rn(a), adx14: Number.isFinite(ad) ? Math.round(ad) : null, trend },
  };
}

function buildContext(symbol: string, t15: TF, t1h: TF, t4h: TF, price: number) {
  const uniq = (arr: number[]) => { const o: number[] = []; for (const x of arr) { const v = Math.round(x * 100) / 100; if (!o.some((y) => Math.abs(y - v) / v < 0.001)) o.push(v); } return o; };
  const resistance = uniq([...t1h.res, ...t4h.res].filter((x) => x > price).sort((a, b) => a - b)).slice(0, 3);
  const support = uniq([...t1h.sup, ...t4h.sup].filter((x) => x < price).sort((a, b) => b - a)).slice(0, 3);
  return { symbol, current_price: rn(price), timeframes: { "15m": t15.snapshot, "1h": t1h.snapshot, "4h": t4h.snapshot }, key_levels: { resistance, support } };
}

async function fetchMt5Candles(cfg: Cfg, symbol: string, tf: string, limit = 300): Promise<Candle[] | null> {
  try {
    const url = `${marketDataHost(cfg.region)}/users/current/accounts/${cfg.account_id}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${tf}/candles?limit=${limit}`;
    const resp = await fetch(url, { headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const arr = await resp.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((k: Record<string, unknown>) => ({
      time: new Date((k.time ?? k.brokerTime) as string).getTime(),
      open: +(k.open as number), high: +(k.high as number), low: +(k.low as number), close: +(k.close as number),
    }));
  } catch { return null; }
}

async function maGet(cfg: Cfg, path: string) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
    headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(15000),
  });
  const txt = await resp.text();
  let body: unknown = txt; try { body = JSON.parse(txt); } catch { /* */ }
  if (!resp.ok) throw new Error(`MetaApi ${resp.status}`);
  return body;
}

async function maTrade(cfg: Cfg, body: Record<string, unknown>) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}/trade`, {
    method: "POST", headers: { "auth-token": cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  let b: unknown = txt; try { b = JSON.parse(txt); } catch { /* */ }
  return { ok: resp.ok, status: resp.status, body: b };
}

// P&L i REALIZUAR i ditës (që nga 00:00 UTC) — shuma e fitim/humbjeve të trade-ve
// të mbyllura sot (profit+commission+swap). Përdoret për limitin REAL të humbjes ditore.
async function realizedToday(cfg: Cfg): Promise<number> {
  try {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await maGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number }>;
    if (!Array.isArray(deals)) return 0;
    return deals.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0);
  } catch { return 0; }
}

// Rezultati real i brokerit (10009 = DONE); HTTP 200 fsheh refuzimet.
function brokerResult(body: unknown): { ok: boolean; code: number; msg: string; orderId: string | null } {
  const o = (body ?? {}) as Record<string, unknown>;
  const code = Number(o.numericCode);
  const orderId = (o.orderId as string) ?? (o.positionId as string) ?? null;
  const msg = String(o.message ?? "");
  const ok = code === 10009 || code === 10008 || code === 10010 || (!!orderId && !Number.isFinite(code));
  return { ok, code, msg, orderId };
}

// Claude si "portë" — tani me KONTEKSTIN real të grafikut MT5 (15m/1h/4h + nivele).
// Verifikon trendin, momentumin, dhe a po hyn trade-i drejt e në nivel kundërshtues.
type DB = ReturnType<typeof createClient>;
async function claudeConfirm(
  db: DB, sig: Signal, action: string,
  proposal: { entry?: number; sl?: number; tp?: number; confidence: number },
  ctx: Record<string, unknown> | null,
): Promise<{ agree: boolean; reason: string }> {
  try {
    const { data: prov } = await db.from("ai_providers")
      .select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
    const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
    if (!key) return { agree: true, reason: "pa Claude (lejuar)" };
    const model = (prov as { model?: string }).model || "claude-opus-4-8";

    const sys = 'You are a strict, risk-aware trade validator for an automated trading bot. You receive multi-timeframe (15m/1h/4h) technical snapshots and key support/resistance levels for the symbol, plus the engine\'s proposed trade (already passed a multi-TF + EMA200 + ADX filter). Evaluate in order: (1) trend alignment across timeframes (price vs EMA200, EMA9/21, "trend" field); (2) momentum (MACD histogram sign, RSI — flag overbought>70 for BUY or oversold<30 for SELL); (3) is the entry running directly into the nearest opposing key level (resistance for BUY, support for SELL) with little room? (4) is risk:reward acceptable (>=1.5)? Reply ONLY compact JSON: {"agree": true|false, "confidence": 0-100, "reason": "short"}. Set agree=true ONLY if trend+momentum support the direction and the entry is not slamming into an opposing level.';

    const payload = ctx
      ? { engine_proposal: { action, confidence: proposal.confidence, entry: proposal.entry, stop_loss: proposal.sl, take_profit: proposal.tp }, market_context: ctx }
      : { engine_proposal: { action, symbol: sig.symbol, confidence: proposal.confidence, entry: proposal.entry, stop_loss: proposal.sl, take_profit: proposal.tp, reasons: sig.analysis } };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 350, system: sys, messages: [{ role: "user", content: JSON.stringify(payload) }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return { agree: true, reason: "Claude error (lejuar)" };
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { agree: true, reason: "Claude pa JSON (lejuar)" };
    const parsed = JSON.parse(m[0]);
    return { agree: !!parsed.agree, reason: String(parsed.reason || "") };
  } catch {
    return { agree: true, reason: "Claude exception (lejuar)" };
  }
}

const BREAKEVEN_R = 1.0;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: Array<Record<string, unknown>> = [];
  const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: configs } = await db
      .from("metaapi_config").select("*").eq("auto_trade", true).eq("kill_switch", false);

    for (const raw of (configs ?? [])) {
      const cfg = raw as Cfg;
      if (!cfg.account_id || !cfg.token) continue;

      let positions: Position[] = [];
      let dayPnl = 0; // P&L i ditës = realized(sot) + floating(tani); negativ = humbje
      try {
        positions = (await maGet(cfg, "/positions") as Position[]) ?? [];
        if (!Array.isArray(positions)) positions = [];
        const info = await maGet(cfg, "/account-information") as { balance?: number; equity?: number };
        const bal = Number(info?.balance), eq = Number(info?.equity);
        const floatingPnl = Number.isFinite(bal) && Number.isFinite(eq) ? eq - bal : 0;
        const realized = await realizedToday(cfg);
        dayPnl = realized + floatingPnl;
      } catch (e) {
        summary.push({ user: cfg.user_id, error: `metaapi: ${(e as Error).message}` });
        continue;
      }
      let openTrades = positions.length;

      // TRAILING / BREAK-EVEN
      for (const p of positions) {
        const isBuy = String(p.type || "").includes("BUY");
        const entry = Number(p.openPrice), cur = Number(p.currentPrice);
        const sl = p.stopLoss != null ? Number(p.stopLoss) : null;
        if (!Number.isFinite(entry) || !Number.isFinite(cur) || sl == null) continue;
        const riskDist = Math.abs(entry - sl);
        if (!(riskDist > 0)) continue;
        const moved = isBuy ? cur - entry : entry - cur;
        if (moved < riskDist * BREAKEVEN_R) continue;
        const alreadyBE = isBuy ? sl >= entry : sl <= entry;
        if (alreadyBE) continue;
        const beSL = Math.round((isBuy ? entry + 0.1 * riskDist : entry - 0.1 * riskDist) * 100) / 100;
        try {
          const r = await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: beSL, takeProfit: p.takeProfit ?? undefined });
          summary.push({ user: cfg.user_id, trailing: p.id, breakeven: r.ok });
        } catch { /* injoro */ }
      }

      const allowed = new Set((cfg.auto_symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
      if (allowed.size === 0) continue;

      const { data: signals } = await db
        .from("signals")
        .select("id, symbol, type, confidence, entry_price, target_price, stop_loss, analysis")
        .eq("user_id", cfg.user_id).eq("status", "active").gte("created_at", sinceIso)
        .order("created_at", { ascending: false }).limit(5);

      const candidates = (signals ?? []).filter((s: Signal) =>
        (s.type === "buy" || s.type === "sell") &&
        Number(s.confidence) >= cfg.min_confidence &&
        allowed.has((s.symbol || "").toUpperCase()),
      ) as Signal[];

      for (const sig of candidates) {
        const { data: existing } = await db
          .from("trade_executions").select("id").eq("user_id", cfg.user_id).eq("signal_id", sig.id).limit(1);
        if (existing && existing.length > 0) continue;

        const action = sig.type === "buy" ? "BUY" : "SELL";
        const isBuy = action === "BUY";

        // ---- ANKORIM te çmimi REAL MT5 (zgjidh bug-un PAXG→MT5) + konteksti i grafikut ----
        let entryPx: number | undefined;
        let stopLoss: number | undefined;
        let takeProfit: number | undefined;
        let slDist = 0;
        let ctx: Record<string, unknown> | null = null;
        let dataSrc = "mt5";

        const [m15, m1h, m4h] = await Promise.all([
          fetchMt5Candles(cfg, sig.symbol, "15m", 300),
          fetchMt5Candles(cfg, sig.symbol, "1h", 300),
          fetchMt5Candles(cfg, sig.symbol, "4h", 300),
        ]);

        if (m15 && m1h && m4h && m15.length > 30 && m1h.length > 30 && m4h.length > 30) {
          const t15 = buildTF(m15, "15m"), t1h = buildTF(m1h, "1h"), t4h = buildTF(m4h, "4h");
          entryPx = t15.price; // çmimi më i freskët MT5
          slDist = t1h.atr > 0 ? t1h.atr * 1.5 : entryPx * 0.015;
          const tpDist = slDist * 2;
          stopLoss = Math.round((isBuy ? entryPx - slDist : entryPx + slDist) * 100) / 100;
          takeProfit = Math.round((isBuy ? entryPx + tpDist : entryPx - tpDist) * 100) / 100;
          ctx = buildContext(sig.symbol, t15, t1h, t4h, entryPx);
        } else {
          // Fallback: nivelet e sinjalit (PAXG) kur MT5 s'jep qirinj.
          dataSrc = "binance_fallback";
          entryPx = sig.entry_price != null ? Number(sig.entry_price) : undefined;
          stopLoss = sig.stop_loss != null ? Number(sig.stop_loss) : undefined;
          takeProfit = sig.target_price != null ? Number(sig.target_price) : undefined;
          slDist = entryPx != null && stopLoss != null ? Math.abs(entryPx - stopLoss) : 0;
        }

        // Lot fillestar dinamik, pastaj rrezik via lot mbi distancën REALE të SL.
        let volume = lotForConfidence(cfg, Number(sig.confidence) || 0);
        const maxRisk = Number(cfg.max_daily_loss) || 0;
        let tooRisky = false;
        if (slDist > 0 && maxRisk > 0) {
          const vpp = valuePerPrice(sig.symbol);
          const lotByRisk = Math.floor((maxRisk / (slDist * vpp)) * 100) / 100;
          if (lotByRisk < volume) volume = lotByRisk;
          if (volume < 0.01) tooRisky = true;
        }
        volume = Math.round(volume * 100) / 100;

        const log = (status: string, reason: string, orderId: string | null, rawResp: unknown) =>
          db.from("trade_executions").insert({
            user_id: cfg.user_id, signal_id: sig.id, symbol: sig.symbol, action, volume: Math.max(volume, 0.01),
            entry_price: entryPx ?? sig.entry_price, stop_loss: stopLoss ?? sig.stop_loss, take_profit: takeProfit ?? sig.target_price,
            mode: cfg.mode, status, reason, metaapi_order_id: orderId, raw_response: rawResp ?? null,
          });

        if (tooRisky) {
          await log("rejected", `Rreziku i 0.01 lot e tejkalon kufirin ($${maxRisk}) — anashkaluar. Rrit kufirin ditor.`, null, null);
          summary.push({ user: cfg.user_id, signal: sig.id, status: "too_risky" });
          continue;
        }
        if (openTrades >= cfg.max_open_trades) { await log("rejected", `Max pozicione (${cfg.max_open_trades})`, null, null); continue; }
        // Limit REAL i humbjes ditore: realized(sot) + floating(tani).
        if (maxRisk > 0 && dayPnl <= -maxRisk) { await log("rejected", `Limit humbjeje ditore arritur (P&L ditor ${dayPnl.toFixed(2)} ≤ -${maxRisk})`, null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "daily_loss_limit" }); continue; }

        // CLAUDE SI PORTË — me kontekstin e grafikut MT5.
        const gate = await claudeConfirm(db, sig, action, { entry: entryPx, sl: stopLoss, tp: takeProfit, confidence: Number(sig.confidence) || 0 }, ctx);
        if (!gate.agree) { await log("rejected", `Claude s'pajtohet: ${gate.reason}`.slice(0, 200), null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "claude_rejected" }); continue; }

        const tradeBody: Record<string, unknown> = {
          actionType: isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
          symbol: sig.symbol, volume,
        };
        if (stopLoss != null) tradeBody.stopLoss = stopLoss;
        if (takeProfit != null) tradeBody.takeProfit = takeProfit;

        try {
          const r = await maTrade(cfg, tradeBody);
          if (!r.ok) { await log("error", `trade ${r.status}`, null, r.body); summary.push({ user: cfg.user_id, signal: sig.id, status: "error" }); continue; }
          const br = brokerResult(r.body);
          if (!br.ok) {
            await log("rejected", `Brokeri: ${br.msg || "refuzuar"} (${br.code})`, null, r.body);
            summary.push({ user: cfg.user_id, signal: sig.id, status: "broker_rejected", code: br.code });
            continue;
          }
          await log("executed", `auto (${cfg.mode}, ${dataSrc})`, br.orderId, r.body);
          openTrades += 1;
          summary.push({ user: cfg.user_id, signal: sig.id, status: "executed", order: br.orderId, src: dataSrc });
        } catch (e) {
          await log("error", (e as Error).message, null, null);
          summary.push({ user: cfg.user_id, signal: sig.id, status: "error" });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
