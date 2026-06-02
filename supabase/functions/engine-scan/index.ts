import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// engine-scan — porton motorin matematik në server. Çdo X minuta llogarit sinjale
// reale (EMA/RSI/MACD/Bollinger/ATR) për simbolet që përdoruesit e auto-trade duan,
// dhe i ruan te `signals` (source='engine'). auto-trade-runner i ekzekuton më pas.
// Kjo bën që auto-trade të punojë mbi sinjalet e motorit edhe kur app-i është mbyllur.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------- Indikatorë (port nga src/ai-trader/core/indicators.ts) ----------
function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) { sum += values[i]; if (i >= period) sum -= values[i - period]; if (i >= period - 1) out[i] = sum / period; }
  return out;
}
function rsi(values: number[], period = 14): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const ch = values[i] - values[i - 1]; if (ch >= 0) g += ch; else l -= ch; }
  let ag = g / period, al = l / period;
  const rf = (ag: number, al: number) => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[period] = rf(ag, al);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    ag = (ag * (period - 1) + (ch > 0 ? ch : 0)) / period;
    al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    out[i] = rf(ag, al);
  }
  return out;
}
function macd(values: number[], fast = 12, slow = 26, sig = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (Number.isNaN(ef[i]) || Number.isNaN(es[i]) ? NaN : ef[i] - es[i]));
  const first = line.findIndex((v) => !Number.isNaN(v));
  const signal = new Array(values.length).fill(NaN);
  if (first !== -1) { const s = ema(line.slice(first), sig); for (let i = 0; i < s.length; i++) signal[first + i] = s[i]; }
  const hist = values.map((_, i) => (Number.isNaN(line[i]) || Number.isNaN(signal[i]) ? NaN : line[i] - signal[i]));
  return { macd: line, signal, histogram: hist };
}
function bollinger(values: number[], period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(NaN), lower = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]; let v = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = values[j] - mean; v += d * d; }
    const sd = Math.sqrt(v / period); upper[i] = mean + mult * sd; lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}
function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= period) return out;
  const tr = new Array(n).fill(NaN); tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  let sum = 0; for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period; out[period] = prev;
  for (let i = period + 1; i < n; i++) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
  return out;
}

// ---------- Motori (port nga signal-engine.ts + trade-plan.ts, profil 'short') ----------
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface EngineResult { action: "BUY" | "SELL" | "HOLD"; confidence: number; entry: number; stopLoss: number; takeProfit: number; reasons: string[]; }

function generateShort(candles: Candle[]): EngineResult | null {
  if (candles.length < 40) return null;
  const closes = candles.map((c) => c.close), highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
  const i = candles.length - 1;
  const ef = ema(closes, 9)[i], es = ema(closes, 21)[i], r = rsi(closes, 14)[i];
  const m = macd(closes), bb = bollinger(closes), a = atr(highs, lows, closes)[i];
  const price = closes[i], mh = m.histogram[i], bu = bb.upper[i], bl = bb.lower[i];

  const rules: { w: number; pass: boolean; reason: string }[] = [];
  if (!Number.isNaN(ef) && !Number.isNaN(es)) rules.push({ w: 2.5, pass: ef > es, reason: ef > es ? "EMA9>EMA21 (trend rritës)" : "EMA9<EMA21 (trend rënës)" });
  if (!Number.isNaN(mh)) rules.push({ w: 1.5, pass: mh > 0, reason: mh > 0 ? "MACD pozitiv" : "MACD negativ" });
  if (!Number.isNaN(es)) rules.push({ w: 1, pass: price > es, reason: price > es ? "Çmimi mbi EMA21" : "Çmimi nën EMA21" });
  if (!Number.isNaN(r)) {
    if (r < 30) rules.push({ w: 1, pass: true, reason: `RSI ${r.toFixed(1)} (mbishitur)` });
    else if (r > 70) rules.push({ w: 1, pass: false, reason: `RSI ${r.toFixed(1)} (mbiblerë)` });
    else rules.push({ w: 0.5, pass: r >= 50, reason: `RSI ${r.toFixed(1)}` });
  }
  if (!Number.isNaN(bl) && !Number.isNaN(bu)) {
    if (price < bl) rules.push({ w: 0.75, pass: true, reason: "Poshtë Bollinger-it" });
    else if (price > bu) rules.push({ w: 0.75, pass: false, reason: "Mbi Bollinger-in" });
  }
  const score = rules.reduce((s, x) => s + (x.pass ? x.w : -x.w), 0);
  const maxScore = rules.reduce((s, x) => s + x.w, 0) || 1;
  const confidence = Math.min(1, Math.abs(score) / maxScore);
  let action: EngineResult["action"] = "HOLD";
  if (confidence >= 0.25) action = score > 0 ? "BUY" : "SELL";

  const stopDist = Number.isFinite(a) && a > 0 ? a * 1.5 : price * 0.015;
  const isBuy = action === "BUY";
  return {
    action, confidence,
    entry: price,
    stopLoss: action === "HOLD" ? NaN : Math.max(0, isBuy ? price - stopDist : price + stopDist),
    takeProfit: action === "HOLD" ? NaN : Math.max(0, isBuy ? price + stopDist * 2 : price - stopDist * 2),
    reasons: rules.map((x) => x.reason),
  };
}

// ---------- Candles nga Binance (XAUUSD→PAXGUSDT) ----------
const PAIRS: Record<string, string> = {
  BTCUSD: "BTCUSDT", ETHUSD: "ETHUSDT", SOLUSD: "SOLUSDT", BNBUSD: "BNBUSDT", XRPUSD: "XRPUSDT",
  ADAUSD: "ADAUSDT", DOGEUSD: "DOGEUSDT", AVAXUSD: "AVAXUSDT", LINKUSD: "LINKUSDT", DOTUSD: "DOTUSDT",
  XAUUSD: "PAXGUSDT",
};
async function fetchCandles(symbol: string): Promise<Candle[] | null> {
  const pair = PAIRS[symbol.toUpperCase()];
  if (!pair) return null; // simbol pa burim real (p.sh. indeks/aksion) — anashkalohet
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=260`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Binance ${resp.status}`);
  const raw = (await resp.json()) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]), open: +(k[1] as string), high: +(k[2] as string),
    low: +(k[3] as string), close: +(k[4] as string), volume: +(k[5] as string),
  }));
}

interface CfgRow { user_id: string; auto_symbols: string; min_confidence: number; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Array<Record<string, unknown>> = [];

  try {
    const { data: configs } = await db
      .from("metaapi_config")
      .select("user_id, auto_symbols, min_confidence")
      .eq("auto_trade", true)
      .eq("kill_switch", false);

    // Simbol → lista e përdoruesve (me pragun e tyre).
    const symbolUsers = new Map<string, CfgRow[]>();
    for (const c of (configs ?? []) as CfgRow[]) {
      for (const s of (c.auto_symbols || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) {
        if (!symbolUsers.has(s)) symbolUsers.set(s, []);
        symbolUsers.get(s)!.push(c);
      }
    }
    if (symbolUsers.size === 0) return json({ success: true, scanned: 0, note: "Asnjë përdorues me auto-trade." });

    const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    for (const [symbol, users] of symbolUsers) {
      let candles: Candle[] | null;
      try { candles = await fetchCandles(symbol); } catch (e) { out.push({ symbol, error: (e as Error).message }); continue; }
      if (!candles) { out.push({ symbol, skipped: "pa burim real candlesh" }); continue; }

      const sig = generateShort(candles);
      if (!sig || sig.action === "HOLD") { out.push({ symbol, action: sig?.action ?? "n/a" }); continue; }
      const confPct = Math.round(sig.confidence * 100);

      for (const u of users) {
        if (confPct < (u.min_confidence ?? 70)) continue;
        // Dedup: a ka tashmë sinjal motori për këtë (user, symbol) 30 min e fundit?
        const { data: existing } = await db
          .from("signals")
          .select("id")
          .eq("user_id", u.user_id)
          .eq("symbol", symbol)
          .eq("source", "engine")
          .gte("created_at", sinceIso)
          .limit(1);
        if (existing && existing.length > 0) continue;

        await db.from("signals").insert({
          user_id: u.user_id, symbol, type: sig.action.toLowerCase(),
          entry_price: sig.entry, target_price: sig.takeProfit, stop_loss: sig.stopLoss,
          confidence: confPct, timeframe: "1h",
          analysis: `Motori: ${sig.reasons.slice(0, 3).join("; ")}`,
          source: "engine", status: "active",
          expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        });
        out.push({ symbol, user: u.user_id, action: sig.action, confidence: confPct, created: true });
      }
    }
    return json({ success: true, processed: out });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
