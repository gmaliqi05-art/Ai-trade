import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// engine-scan — motori matematik në server, me FOKUS 100% NË AR (XAUUSD).
// Platform-wide gjeneron sinjale vetëm për arin, me inteligjencë specifike:
//   (1) Sesionet e tregut (London/NY), (2) nivelet psikologjike, (3) filtri i
//   volatilitetit, (4) trendi ditor D1. Simbolet e tjera (kripto/forex) janë
//   PASIVE — skanohen vetëm nëse përdoruesi i shton manualisht te auto_symbols.

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
// ADX (Wilder) — forca e trendit. ADX>20-25 = trend i fortë; <20 = treg pa drejtim.
function adx(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= period * 2 + 1) return out;
  const plusDM = new Array(n).fill(0), minusDM = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1], down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let atrS = 0, plusS = 0, minusS = 0;
  for (let i = 1; i <= period; i++) { atrS += tr[i]; plusS += plusDM[i]; minusS += minusDM[i]; }
  const dx = new Array(n).fill(NaN);
  for (let i = period + 1; i < n; i++) {
    atrS = atrS - atrS / period + tr[i];
    plusS = plusS - plusS / period + plusDM[i];
    minusS = minusS - minusS / period + minusDM[i];
    const plusDI = atrS === 0 ? 0 : 100 * plusS / atrS;
    const minusDI = atrS === 0 ? 0 : 100 * minusS / atrS;
    const denom = plusDI + minusDI;
    dx[i] = denom === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / denom;
  }
  const firstDx = dx.findIndex((v) => !Number.isNaN(v));
  if (firstDx === -1 || firstDx + period >= n) return out;
  let sum = 0; for (let i = firstDx; i < firstDx + period; i++) sum += dx[i];
  let adxPrev = sum / period; out[firstDx + period - 1] = adxPrev;
  for (let i = firstDx + period; i < n; i++) { adxPrev = (adxPrev * (period - 1) + dx[i]) / period; out[i] = adxPrev; }
  return out;
}

// ---------- Motori (port nga signal-engine.ts + trade-plan.ts, profil 'short') ----------
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface EngineResult { action: "BUY" | "SELL" | "HOLD"; confidence: number; entry: number; stopLoss: number; takeProfit: number; reasons: string[]; }

const GOLD_SYMBOL = "XAUUSD";

// Ora e Frankfurt-it (Europe/Berlin), 0–23, me korrigjim automatik të orës
// verore/dimërore (DST) nga Intl. Sesioni i arit ankorohet te tregu evropian.
const GOLD_OPEN_H = 9;   // 09:00 Frankfurt — afër hapjes së Londrës
const GOLD_CLOSE_H = 23; // 23:00 Frankfurt — afër mbylljes së New York-ut
function frankfurtHour(d = new Date()): number {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(d);
  return parseInt(s, 10) || 0;
}

// Analizë e një periudhe: kthen drejtimin, besueshmërinë, EMA200 dhe ADX.
interface TFResult { action: "BUY" | "SELL" | "HOLD"; confidence: number; price: number; atr: number; ema200: number; adx: number; reasons: string[]; }
function analyzeTF(candles: Candle[]): TFResult | null {
  if (candles.length < 210) return null; // duhen ≥200 qirinj për EMA200
  const closes = candles.map((c) => c.close), highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
  const i = candles.length - 1;
  const ef = ema(closes, 9)[i], es = ema(closes, 21)[i], e200 = ema(closes, 200)[i], r = rsi(closes, 14)[i];
  const m = macd(closes), bb = bollinger(closes), a = atr(highs, lows, closes)[i], adxV = adx(highs, lows, closes)[i];
  const price = closes[i], mh = m.histogram[i], bu = bb.upper[i], bl = bb.lower[i];

  const rules: { w: number; pass: boolean; reason: string }[] = [];
  if (!Number.isNaN(ef) && !Number.isNaN(es)) rules.push({ w: 2.5, pass: ef > es, reason: ef > es ? "EMA9>EMA21" : "EMA9<EMA21" });
  if (!Number.isNaN(mh)) rules.push({ w: 1.5, pass: mh > 0, reason: mh > 0 ? "MACD pozitiv" : "MACD negativ" });
  if (!Number.isNaN(es)) rules.push({ w: 1, pass: price > es, reason: price > es ? "Çmimi mbi EMA21" : "Çmimi nën EMA21" });
  if (!Number.isNaN(r)) {
    if (r < 30) rules.push({ w: 1, pass: true, reason: `RSI ${r.toFixed(0)} mbishitur` });
    else if (r > 70) rules.push({ w: 1, pass: false, reason: `RSI ${r.toFixed(0)} mbiblerë` });
    else rules.push({ w: 0.5, pass: r >= 50, reason: `RSI ${r.toFixed(0)}` });
  }
  if (!Number.isNaN(bl) && !Number.isNaN(bu)) {
    if (price < bl) rules.push({ w: 0.75, pass: true, reason: "Poshtë Bollinger" });
    else if (price > bu) rules.push({ w: 0.75, pass: false, reason: "Mbi Bollinger" });
  }
  const score = rules.reduce((s, x) => s + (x.pass ? x.w : -x.w), 0);
  const maxScore = rules.reduce((s, x) => s + x.w, 0) || 1;
  const confidence = Math.min(1, Math.abs(score) / maxScore);
  let action: TFResult["action"] = "HOLD";
  if (confidence >= 0.25) action = score > 0 ? "BUY" : "SELL";
  return { action, confidence, price, atr: Number.isFinite(a) ? a : 0, ema200: Number.isFinite(e200) ? e200 : price, adx: Number.isFinite(adxV) ? adxV : 0, reasons: rules.map((x) => x.reason) };
}

// Gjenerues i PËRFORCUAR për auto-trade:
//  - Konfirmim shumë-periudhash: 15m + 1h + 4h duhet të pajtohen.
//  - Filtër trendi: çmimi mbi EMA200 për BLEJ, nën EMA200 për SHIT (në 1h).
//  - Filtër force: ADX(1h) ≥ 20 (vetëm trende të forta).
const ADX_MIN = 20;
async function generateStrong(symbol: string): Promise<EngineResult | null> {
  const [c15, c1h, c4h] = await Promise.all([
    fetchCandles(symbol, "15m"), fetchCandles(symbol, "1h"), fetchCandles(symbol, "4h"),
  ]);
  if (!c15 || !c1h || !c4h) return null;
  const s15 = analyzeTF(c15), s1h = analyzeTF(c1h), s4h = analyzeTF(c4h);
  if (!s15 || !s1h || !s4h) return null;

  const dir = s1h.action;
  if (dir === "HOLD") return null;
  // 1) Të treja periudhat në të njëjtin drejtim.
  if (s15.action !== dir || s4h.action !== dir) return null;
  // 2) Filtër trendi EMA200 (1h).
  const price = s1h.price;
  if (dir === "BUY" && !(price > s1h.ema200)) return null;
  if (dir === "SELL" && !(price < s1h.ema200)) return null;
  // 3) Filtër force ADX (1h).
  if (s1h.adx < ADX_MIN) return null;

  const confidence = Math.min(1, (s15.confidence + s1h.confidence + s4h.confidence) / 3);
  const stopDist = s1h.atr > 0 ? s1h.atr * 1.5 : price * 0.015;
  const isBuy = dir === "BUY";
  return {
    action: dir, confidence, entry: price,
    stopLoss: Math.max(0, isBuy ? price - stopDist : price + stopDist),
    takeProfit: Math.max(0, isBuy ? price + stopDist * 2 : price - stopDist * 2),
    reasons: [
      `Multi-TF: 15m+1h+4h pajtohen (${isBuy ? "BLEJ" : "SHIT"})`,
      `Trendi: çmimi ${isBuy ? "mbi" : "nën"} EMA200`,
      `ADX ${s1h.adx.toFixed(0)} (trend i fortë)`,
      ...s1h.reasons.slice(0, 2),
    ],
  };
}

// ============================================================================
// GJENERATORI I DEDIKUAR I ARIT — generateStrong + 4 analiza specifike për arin:
//   (1) Sesionet e tregut, (2) volatiliteti, (3) trendi ditor D1, (4) nivelet
//   psikologjike. Çdo filtër mund ta refuzojë sinjalin; harmonia i jep "boost".
// ============================================================================
async function generateGold(symbol: string): Promise<EngineResult | null> {
  const [c15, c1h, c4h, c1d] = await Promise.all([
    fetchCandles(symbol, "15m"), fetchCandles(symbol, "1h"),
    fetchCandles(symbol, "4h"), fetchCandles(symbol, "1d"),
  ]);
  if (!c15 || !c1h || !c4h) return null;
  const s15 = analyzeTF(c15), s1h = analyzeTF(c1h), s4h = analyzeTF(c4h);
  if (!s15 || !s1h || !s4h) return null;

  // Baza: e njëjta logjikë si generateStrong (multi-TF + EMA200 + ADX).
  const dir = s1h.action;
  if (dir === "HOLD") return null;
  if (s15.action !== dir || s4h.action !== dir) return null;
  const price = s1h.price;
  const isBuy = dir === "BUY";
  if (isBuy && !(price > s1h.ema200)) return null;
  if (!isBuy && !(price < s1h.ema200)) return null;
  if (s1h.adx < ADX_MIN) return null;

  const reasons: string[] = [
    `Multi-TF: 15m+1h+4h pajtohen (${isBuy ? "BLEJ" : "SHIT"})`,
    `Trendi: çmimi ${isBuy ? "mbi" : "nën"} EMA200`,
    `ADX ${s1h.adx.toFixed(0)} (trend i fortë)`,
  ];

  // (1) SESIONET — tregto vetëm gjatë sesionit evropian/amerikan, i ankoruar te
  //     Frankfurt (09:00–23:00, DST automatik). Shmang sesionin e qetë aziatik.
  const fh = frankfurtHour();
  if (!(fh >= GOLD_OPEN_H && fh < GOLD_CLOSE_H)) return null;
  const overlap = fh >= 14 && fh < 18; // mbivendosja London+NY (Frankfurt) = lëvizja më e fortë
  reasons.push(overlap ? "Sesioni London+NY (likuiditet maksimal)" : "Sesion aktiv (Frankfurt/Europë)");

  // (2) VOLATILITETI — ATR(1h) i krahasuar me mesataren e vet. Shmang tregun e
  //     ngrirë (range pa drejtim) dhe spike-t e papritura nga lajmet.
  {
    const highs = c1h.map((c) => c.high), lows = c1h.map((c) => c.low), closes = c1h.map((c) => c.close);
    const atrArr = atr(highs, lows, closes, 14).filter(Number.isFinite) as number[];
    if (atrArr.length >= 20) {
      const atrNow = atrArr[atrArr.length - 1];
      const recent = atrArr.slice(-50);
      const atrAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (atrAvg > 0) {
        const ratio = atrNow / atrAvg;
        if (ratio < 0.5) return null;  // treg i ngrirë
        if (ratio > 2.5) return null;  // spike nga lajme — rrezik i lartë
        reasons.push(`Volatilitet normal (ATR ${((atrNow / price) * 100).toFixed(2)}%)`);
      }
    }
  }

  // (3) TRENDI DITOR (D1) — busulla e madhe. Sinjali duhet në harmoni me trendin
  //     ditor (çmimi vs EMA50 ditore); përndryshe refuzohet.
  let d1Boost = 0;
  if (c1d && c1d.length >= 60) {
    const dc = c1d.map((c) => c.close);
    const e50d = ema(dc, 50)[dc.length - 1];
    if (Number.isFinite(e50d)) {
      const d1Up = price > e50d;
      if (isBuy && !d1Up) return null;   // BLEJ kundër trendit ditor rënës
      if (!isBuy && d1Up) return null;    // SHIT kundër trendit ditor rritës
      d1Boost = 0.05;
      reasons.push(`Në harmoni me trendin ditor (${d1Up ? "rritës" : "rënës"})`);
    }
  }

  // (4) NIVELET PSIKOLOGJIKE — ari respekton fort nivelet e rrumbullakëta ($10,
  //     më të forta te $50/$100). Shmang hyrjet që përplasen menjëherë me një
  //     nivel të fortë kundërshtues.
  const round10 = Math.round(price / 10) * 10;
  const nearestAbove = price <= round10 ? round10 : round10 + 10;
  const nearestBelow = price >= round10 ? round10 : round10 - 10;
  const TOO_CLOSE = 0.0012; // ~0.12% (≈ $4 te $3300)
  if (isBuy && nearestAbove % 50 === 0 && (nearestAbove - price) / price < TOO_CLOSE) return null;
  if (!isBuy && nearestBelow % 50 === 0 && (price - nearestBelow) / price < TOO_CLOSE) return null;
  reasons.push(`Nivele kyçe: mbështetje ~$${nearestBelow}, rezistencë ~$${nearestAbove}`);

  // (5) CONFLUENCE SCORING (Tier-2) — numëron faktorët e pavarur mbështetës. Sa më
  //     shumë faktorë pajtohen, aq më cilësor sinjali (përdoret për ranking + besueshmëri).
  const c1hCloses = c1h.map((c) => c.close);
  const rsi1h = rsi(c1hCloses, 14)[c1hCloses.length - 1];
  const macdH = macd(c1hCloses).histogram[c1hCloses.length - 1];
  const adxStrong = s1h.adx >= 25;
  const rsiRoom = Number.isFinite(rsi1h) && (isBuy ? rsi1h < 68 : rsi1h > 32); // hapësirë para mbiblerjes/mbishitjes
  const macdAligned = Number.isFinite(macdH) && (isBuy ? macdH > 0 : macdH < 0);
  if (adxStrong) reasons.push("ADX i fortë (≥25)");
  if (rsiRoom) reasons.push(`RSI me hapësirë (${Math.round(rsi1h)})`);
  if (macdAligned) reasons.push("MACD në harmoni");
  // 2 faktorë bazë (Multi-TF, EMA200) + 5 opsionalë (ADX≥25, sesion-overlap, D1, RSI, MACD).
  const confFactors = 2 + (adxStrong ? 1 : 0) + (overlap ? 1 : 0) + (d1Boost > 0 ? 1 : 0) + (rsiRoom ? 1 : 0) + (macdAligned ? 1 : 0);
  reasons.unshift(`Confluence ${confFactors}/7 (${Math.round((confFactors / 7) * 100)}%)`);

  // Besueshmëria me boost-et e harmonisë + confluence (bonusi s'e ul kurrë bazën → s'pakëson sinjalet).
  const base = Math.min(1, (s15.confidence + s1h.confidence + s4h.confidence) / 3);
  const confBonus = (adxStrong ? 0.02 : 0) + (rsiRoom ? 0.02 : 0) + (macdAligned ? 0.02 : 0);
  const confidence = Math.min(1, base + d1Boost + (overlap ? 0.05 : 0) + confBonus);
  const stopDist = s1h.atr > 0 ? s1h.atr * 1.5 : price * 0.015;
  return {
    action: dir, confidence, entry: price,
    stopLoss: Math.max(0, isBuy ? price - stopDist : price + stopDist),
    takeProfit: Math.max(0, isBuy ? price + stopDist * 2 : price - stopDist * 2),
    reasons,
  };
}

// Përzgjedh gjeneratorin: ari → i dedikuar me 4 analizat; të tjerat → standard.
function generateFor(symbol: string): Promise<EngineResult | null> {
  return symbol.toUpperCase() === GOLD_SYMBOL ? generateGold(symbol) : generateStrong(symbol);
}

// ---------- Candles nga Binance (XAUUSD→PAXGUSDT) ----------
const PAIRS: Record<string, string> = {
  BTCUSD: "BTCUSDT", ETHUSD: "ETHUSDT", SOLUSD: "SOLUSDT", BNBUSD: "BNBUSDT", XRPUSD: "XRPUSDT",
  ADAUSD: "ADAUSDT", DOGEUSD: "DOGEUSDT", AVAXUSD: "AVAXUSDT", LINKUSD: "LINKUSDT", DOTUSD: "DOTUSDT",
  XAUUSD: "PAXGUSDT",
};
async function fetchCandles(symbol: string, interval = "1h"): Promise<Candle[] | null> {
  const pair = PAIRS[symbol.toUpperCase()];
  if (!pair) return null; // simbol pa burim real (p.sh. indeks/aksion) — anashkalohet
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=300`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Binance ${resp.status}`);
  const raw = (await resp.json()) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]), open: +(k[1] as string), high: +(k[2] as string),
    low: +(k[3] as string), close: +(k[4] as string), volume: +(k[5] as string),
  }));
}

interface CfgRow { user_id: string; auto_symbols: string; min_confidence: number; }

// FOKUS NË AR: sinjalet platform-wide janë vetëm për XAUUSD. Kripto/forex janë
// pasive — vetëm përdoruesit që i shtojnë manualisht te auto_symbols i marrin.
const PLATFORM_WATCHLIST = [GOLD_SYMBOL];
const PLATFORM_MIN_CONF = 0.30;   // pragu i besueshmërisë (0..1)
const PLATFORM_MAX = 3;            // maksimumi i sinjaleve platform-wide aktive njëkohësisht
const PLATFORM_DEDUP_H = 4;        // mos krijo sinjal të ri për të njëjtin simbol brenda 4 orëve

/**
 * Gjeneron deri në PLATFORM_MAX sinjale REALE platform-wide (user_id = NULL),
 * me throttle: një sinjal për simbol jo më shumë se një herë në PLATFORM_DEDUP_H orë.
 * Këto janë vetëm për shfaqje te "Sinjale AI"; auto-trade-runner s'i ekzekuton (user_id NULL).
 */
async function platformPass(
  db: ReturnType<typeof createClient>,
  out: Array<Record<string, unknown>>,
) {
  const dedupIso = new Date(Date.now() - PLATFORM_DEDUP_H * 60 * 60 * 1000).toISOString();
  // Numri aktual i sinjaleve platform-wide aktive nga motori.
  const { count: activeCount } = await db
    .from("signals")
    .select("id", { count: "exact", head: true })
    .is("user_id", null)
    .eq("source", "engine")
    .eq("status", "active");
  if ((activeCount ?? 0) >= PLATFORM_MAX) return;

  // Llogarit sinjalet për watchlist-in (ari, me 4 analizat) dhe rendit sipas besueshmërisë.
  const candidates: { symbol: string; sig: EngineResult }[] = [];
  for (const symbol of PLATFORM_WATCHLIST) {
    try {
      const sig = await generateFor(symbol);
      if (sig && sig.action !== "HOLD" && sig.confidence >= PLATFORM_MIN_CONF) candidates.push({ symbol, sig });
    } catch { /* anashkalo simbolin */ }
  }
  candidates.sort((a, b) => b.sig.confidence - a.sig.confidence);

  let created = 0;
  const room = PLATFORM_MAX - (activeCount ?? 0);
  for (const { symbol, sig } of candidates) {
    if (created >= room) break;
    // Dedup: a ka sinjal platform-wide për këtë simbol brenda dritares?
    const { data: recent } = await db
      .from("signals")
      .select("id")
      .is("user_id", null)
      .eq("source", "engine")
      .eq("symbol", symbol)
      .gte("created_at", dedupIso)
      .limit(1);
    if (recent && recent.length > 0) continue;

    await db.from("signals").insert({
      user_id: null, symbol, type: sig.action.toLowerCase(),
      entry_price: sig.entry, target_price: sig.takeProfit, stop_loss: sig.stopLoss,
      confidence: Math.round(sig.confidence * 100), timeframe: "1h",
      analysis: `Motori AI: ${sig.reasons.slice(0, 3).join("; ")}`,
      source: "engine", status: "active",
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    });
    created++;
    out.push({ platform: symbol, action: sig.action, confidence: Math.round(sig.confidence * 100), created: true });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Array<Record<string, unknown>> = [];

  try {
    // 1) Sinjale platform-wide (për të gjithë klientët) — gjithmonë.
    await platformPass(db, out);

    // 2) Sinjale per-përdorues për auto-trade.
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

    const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    for (const [symbol, users] of symbolUsers) {
      // Gjenerues i PËRFORCUAR: multi-timeframe + EMA200 + ADX. Kthen sinjal vetëm
      // kur 15m/1h/4h pajtohen, çmimi në drejtim të trendit (EMA200) dhe ADX≥20.
      let sig: EngineResult | null;
      try { sig = await generateFor(symbol); } catch (e) { out.push({ symbol, error: (e as Error).message }); continue; }
      if (!sig || sig.action === "HOLD") { out.push({ symbol, action: sig?.action ?? "filtruar" }); continue; }
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
