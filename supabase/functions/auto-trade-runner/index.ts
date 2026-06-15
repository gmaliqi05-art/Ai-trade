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
  lot_conf_t1?: number; lot_conf_t2?: number; lot_conf_t3?: number; // pragjet e besueshmërisë (default 70/80/90)
  risk_per_trade_pct?: number; // % e kapitalit për trade (fixed-fractional); default 1%
  // Dy strategjitë: afat-gjatë (swing, sinjale 15m/1h/4h) dhe afat-shkurt (scalp, momentum 1m/5m).
  strategy_swing?: boolean;  // default true
  strategy_scalp?: boolean;  // default false
  scalp_sl_usd?: number;     // distanca e SL në çmim ($) për ar, default 2
  scalp_tp_usd?: number;     // distanca e TP në çmim ($) për ar, default 4
  scalp_sl_pct?: number;     // SL i scalp-it për CRYPTO si % e çmimit, default 0.3
  scalp_tp_pct?: number;     // TP i scalp-it për CRYPTO si % e çmimit, default 0.6
  scalp_sl_pct_oil?: number; // SL i scalp-it për NAFTË si % e çmimit, default 0.4
  scalp_tp_pct_oil?: number; // TP i scalp-it për NAFTË si % e çmimit, default 0.8
  scalp_max_trades?: number; // pozicione scalp njëkohësisht, default 2
  scalp_small_moves?: boolean; // hyn edhe në lëvizje të vogla (kushte më të lehta); default false
  auto_sltp?: boolean;       // OPT-IN: SL/TP llogariten krejt nga analiza (ATR + balanca); default false = sjellja ekzistuese
  // Trailing i SL (ndjekja e fitimit) — i konfigurueshëm nga përdoruesi.
  trail_enabled?: boolean;   // ndez/fik trailing-un; default true
  trail_lock_pct?: number;   // % e fitimit që mbahet (SL ndjek këtë fraksion); default 50
  trail_start_usd?: number;  // profit minimal ($) para se të fillojë trailing-u; default 1
  broker_trailing?: boolean; // trailing në anë të MT5/MetaApi (tick-by-tick); default false
  be_enabled?: boolean;      // break-even auto: SL → hyrja ± offset kur fitimi rritet; default false
  be_offset_usd?: number;    // offset-i i break-even në çmim ($); default 0.9 (≈ 9 pips ari)
  day_start_equity?: number; // ekuiteti në fillim të ditës UTC (për limitin ditor të humbjes)
  day_start_date?: string;   // data UTC e ruajtjes së day_start_equity
  experimental_filters?: boolean; // opt-in per-përdorues: spread-guard + cool-off pas serie humbjesh
  risk_reset_at?: string;    // pikë rinisjeje e numëruesve të rrezikut (humbja/seria) — injoro trade-t para saj
}

interface Signal {
  id: string; symbol: string; type: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  analysis: string | null;
}

interface Position {
  id: string; type?: string; symbol?: string; volume?: number; openPrice?: number; currentPrice?: number;
  stopLoss?: number; takeProfit?: number; profit?: number; comment?: string; clientId?: string;
  trailingStopLoss?: unknown; // i vendosur kur trailing-u server-side është aktiv
}

// Shenja që dallon pozicionet e hapura nga strategjia scalp (vendoset te `comment`/`clientId`).
const SCALP_TAG = "SCALP";
function isScalpPosition(p: Position): boolean {
  return /SCALP/i.test(String(p.comment ?? "")) || /SCALP/i.test(String(p.clientId ?? ""));
}

interface Candle { time: number; open: number; high: number; low: number; close: number; }

function host(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}
function marketDataHost(region: string) {
  return `https://mt-market-data-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

// Tregu FX/metale i HAPUR tani? Mbyllur fundjavën: E premte pas 21:00 UTC → E diel 22:00 UTC.
// Roboti hap trade TË REJA për arin sa herë tregu është i hapur (jo më vetëm 09:00–23:00 Frankfurt).
// Trailing/break-even vazhdon 24/7 te blloku i menaxhimit (s'preket nga kjo portë).
// Përdoret për të dërguar porositë në radhë para-hapjeje pikërisht kur rihapet tregu.
function isMarketOpen(d = new Date()): boolean {
  const day = d.getUTCDay(), h = d.getUTCHours();
  if (day === 6) return false;            // E shtunë
  if (day === 0 && h < 22) return false;  // E diel para 22:00 UTC
  if (day === 5 && h >= 21) return false; // E premte pas 21:00 UTC
  return true;
}
// Crypto tregtohet 24/7 → s'i nënshtrohet sesionit të arit.
function isCrypto(symbol: string): boolean {
  return /^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test((symbol || "").toUpperCase());
}
// Naftë (WTI/Brent) — tregtohet ~23h/ditë pune (jo vetëm sesioni i arit).
function isOil(symbol: string): boolean {
  return /^(USOIL|UKOIL|WTI|XTI|XBR|BRENT|UKO|USO|CL)/i.test((symbol || "").toUpperCase());
}
// EIA Weekly Petroleum Status Report: e mërkurë 10:30 ET → bllokim 10:00–11:00 ET për naftën.
function eiaBlackout(d = new Date()): boolean {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  if (p.find((x) => x.type === "weekday")?.value !== "Wed") return false;
  const hh = parseInt(p.find((x) => x.type === "hour")?.value || "0", 10) % 24;
  const mm = parseInt(p.find((x) => x.type === "minute")?.value || "0", 10);
  const mins = hh * 60 + mm;
  return mins >= 10 * 60 && mins < 11 * 60;
}

function valuePerPrice(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU")) return 100;
  if (s.includes("XAG")) return 5000;
  if (/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test(s)) return 1;
  if (isOil(s)) return 1000; // naftë: kontrata standarde 1000 fuçi → $1 lëvizje = $1000/lot
  if (s.length === 6) return 100000;
  return 100;
}

// Madhësia e pozicionit sipas % të analizës (≥70/≥80/≥90), e kapur te max_lot.
function lotForConfidence(cfg: Cfg, conf: number): number {
  let lot: number;
  if (cfg.dynamic_lot === false) {
    lot = Number(cfg.default_lot) || 0.01;
  } else {
    const t1 = Number(cfg.lot_conf_t1 ?? 70), t2 = Number(cfg.lot_conf_t2 ?? 80), t3 = Number(cfg.lot_conf_t3 ?? 90);
    lot = Number(cfg.lot_conf_70 ?? 0.01); // banda bazë (besueshmëri ≥ t1)
    if (conf >= t2) lot = Number(cfg.lot_conf_80 ?? 0.02);
    if (conf >= t3) lot = Number(cfg.lot_conf_90 ?? 0.05);
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

// ---------- MOTORI SCALP (afat-shkurt) ----------
// Momentum i shpejtë: drejtimi nga 5m (EMA9 vs EMA21), hyrja konfirmohet nga thyerja
// (breakout/breakdown) në 1m me qiri në drejtim + RSI me hapësirë + MACD hist pajtohet.
// Nuk përdor Claude (është strategji e shpejtë reagimi brenda çiklit 1-minutësh).
function scalpSignal(c1m: Candle[], c5m: Candle[], loose = false): { action: "BUY" | "SELL"; reason: string } | null {
  if (c1m.length < 35 || c5m.length < 30) return null;
  const cl1 = c1m.map((c) => c.close), cl5 = c5m.map((c) => c.close);
  const i1 = cl1.length - 1, i5 = cl5.length - 1;

  // Drejtimi i tregut nga 5m.
  const e9_5 = ema(cl5, 9)[i5], e21_5 = ema(cl5, 21)[i5];
  if (!Number.isFinite(e9_5) || !Number.isFinite(e21_5)) return null;
  const dir5 = e9_5 > e21_5 ? "up" : e9_5 < e21_5 ? "down" : "flat";
  if (dir5 === "flat") return null;

  // Momentum në 1m.
  const e9_1 = ema(cl1, 9)[i1], e21_1 = ema(cl1, 21)[i1];
  const r1 = rsi(cl1, 14)[i1];
  const mh1 = macdHist(cl1)[i1];
  const price = cl1[i1];
  const last = c1m[i1];
  if (!Number.isFinite(e9_1) || !Number.isFinite(e21_1) || !Number.isFinite(r1) || !Number.isFinite(mh1)) return null;

  // ---- HYRJE NË LËVIZJE TË VOGLA (loose): PULLBACK në trend, jo ndjekje rraskapitjeje ----
  // Përmirësim: (1) kërkon trend real 5m (jo chop); (2) çmimi pranë EMA9(1m) = pullback, jo i
  // shtrirë; (3) RSI në zonë trendi, JO në klimaks oversold/overbought (ku ndodh kthimi).
  if (loose) {
    const hi5 = c5m.map((c) => c.high), lo5 = c5m.map((c) => c.low);
    const hi1 = c1m.map((c) => c.high), lo1 = c1m.map((c) => c.low);
    const e9_5arr = ema(cl5, 9);
    const slope5 = e9_5arr[i5] - e9_5arr[i5 - 2]; // drejtimi REAL i EMA9(5m) mbi 2 qirinj
    const atr5 = atr(hi5, lo5, cl5, 14)[i5];
    const atr1 = atr(hi1, lo1, cl1, 14)[i1];
    // (1) Trend i fortë: EMA9/EMA21 (5m) të ndara mjaftueshëm — përndryshe është treg i sheshtë.
    if (Number.isFinite(atr5) && atr5 > 0 && Math.abs(e9_5 - e21_5) < 0.30 * atr5) return null;
    // (2) Jo i shtrirë: çmimi brenda ~1.2×ATR(1m) nga EMA9(1m) — hyn në pullback, jo pas lëvizjes.
    const band = Number.isFinite(atr1) && atr1 > 0 ? 1.2 * atr1 : 1.5;
    if (Math.abs(price - e9_1) > band) return null;
    // (3) SELL: trend↓ DHE EMA9(5m) ende po bie (jo rikuperim), qiri rënës, RSI 38–68 (jo klimaks).
    if (dir5 === "down" && slope5 < 0 && last.close < last.open && r1 >= 38 && r1 <= 68)
      return { action: "SELL", reason: "Scalp (lëvizje të vogla): pullback në trend 5m↓" };
    // BUY: pasqyrë — trend↑ DHE EMA9(5m) po ngrihet, RSI 32–62 (jo overbought-klimaks).
    if (dir5 === "up" && slope5 > 0 && last.close > last.open && r1 >= 32 && r1 <= 62)
      return { action: "BUY", reason: "Scalp (lëvizje të vogla): pullback në trend 5m↑" };
    return null;
  }

  // ---- HYRJE STANDARDE (strict): kërkon breakout të qartë + MACD që pajtohet ----
  // BUY: trend 5m↑, 1m EMA9>EMA21, çmimi mbi EMA9, qiri ngjitës, RSI<75, MACD hist>0,
  //      dhe çmimi thyen maksimumin e 3 qirinjve të mëparshëm (breakout).
  if (dir5 === "up" && e9_1 > e21_1 && price > e9_1 && last.close > last.open && r1 < 75 && mh1 > 0) {
    const recentHigh = Math.max(c1m[i1 - 1].high, c1m[i1 - 2].high, c1m[i1 - 3].high);
    if (price >= recentHigh) return { action: "BUY", reason: "Scalp: momentum 1m↑ në trend 5m↑ (breakout)" };
  }
  // SELL: pasqyrë e BUY.
  if (dir5 === "down" && e9_1 < e21_1 && price < e9_1 && last.close < last.open && r1 > 25 && mh1 < 0) {
    const recentLow = Math.min(c1m[i1 - 1].low, c1m[i1 - 2].low, c1m[i1 - 3].low);
    if (price <= recentLow) return { action: "SELL", reason: "Scalp: momentum 1m↓ në trend 5m↓ (breakdown)" };
  }
  return null;
}

// A po kthehet momentum-i kundër pozicionit scalp (sinjal për dalje që të mbahet profiti)?
// Për BUY: qiri i fundit 1m mbyllet poshtë EMA9 ose është qiri rënës i fortë → dil.
function scalpReversal(c1m: Candle[], isBuy: boolean): boolean {
  if (c1m.length < 12) return false;
  const cl = c1m.map((c) => c.close);
  const i = cl.length - 1;
  const e9 = ema(cl, 9)[i];
  if (!Number.isFinite(e9)) return false;
  const last = c1m[i];
  if (isBuy) return last.close < e9 && last.close < last.open;   // theu poshtë EMA9 me qiri rënës
  return last.close > e9 && last.close > last.open;              // theu mbi EMA9 me qiri ngjitës
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
  const url = `${marketDataHost(cfg.region)}/users/current/accounts/${cfg.account_id}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${tf}/candles?limit=${limit}`;
  // Riprovo te 429 (rate-limit i llogarisë)/502/503 — që scalp-i të mund të vlerësojë edhe nën ngarkesë.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(12000) });
      if (resp.status === 429 || resp.status === 502 || resp.status === 503) {
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
        return null;
      }
      if (!resp.ok) return null;
      const arr = await resp.json();
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr.map((k: Record<string, unknown>) => ({
        time: new Date((k.time ?? k.brokerTime) as string).getTime(),
        open: +(k.open as number), high: +(k.high as number), low: +(k.low as number), close: +(k.close as number),
      }));
    } catch { /* gabim rrjeti → riprovo */ }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return null;
}

async function maGet(cfg: Cfg, path: string) {
  // RIPROVË për gabime KALIMTARE: 429 (TooManyRequests — kur llogaria e përdoruesit po bën shumë
  // thirrje njëkohësisht) dhe 502/503 (MetaApi po sinkronizon). Pa këtë, një 429 i vetëm e hiqte
  // përdoruesin nga cikli i robotit. Vetëm GET-e (idempotentë); urdhrat e tregtisë S'riprovohen kurrë.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
        headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(15000),
      });
      const txt = await resp.text();
      let body: unknown = txt; try { body = JSON.parse(txt); } catch { /* */ }
      if (resp.status === 429 || resp.status === 502 || resp.status === 503) {
        lastErr = new Error(`MetaApi ${resp.status} (kalimtar)`); // riprovo me prapakthim
      } else if (!resp.ok) {
        throw new Error(`MetaApi ${resp.status}`); // jo-kalimtar → dil
      } else {
        return body;
      }
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/^MetaApi \d{3}$/.test(msg)) throw e; // përgjigje e qartë jo-OK → mos riprovo
      lastErr = e as Error; // gabim rrjeti (timeout/DNS) → riprovo
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw lastErr || new Error("MetaApi unreachable");
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

// Disa brokerë (p.sh. Vantage) e quajnë arin me prapashtesë (XAUUSD+, XAUUSD., GOLD…).
// Gjen emrin REAL te lista e brokerit (me cache) — rregullon "Unknown symbol 4301".
const _symCache = new Map<string, string>();
async function resolveSymbol(cfg: Cfg, requested: string): Promise<string> {
  const key = `${cfg.account_id}:${requested.toUpperCase()}`;
  const cached = _symCache.get(key);
  if (cached) return cached;
  try {
    const list = await maGet(cfg, `/symbols`) as unknown;
    if (Array.isArray(list) && list.length > 0) {
      const names = list.map(String);
      const req = requested.toUpperCase();
      // NAFTË: familja e simbolit te brokeri (USOIL↔XTIUSD/WTI/CL; UKOIL↔XBRUSD/BRENT).
      // E njëjta logjikë si te engine-scan, që sinjali dhe ekzekutimi të gjejnë të NJËJTIN simbol.
      const oilReq = /^(USOIL|UKOIL|WTI|XTI|XBR|BRENT|UKO|USO|CL)/i.test(req);
      const oilFam = /^(UKOIL|XBR|BRENT|UKO)/i.test(req)
        ? /^(UKOIL|XBRUSD|XBR|BRENT|UKO)/i
        : /^(USOIL|XTIUSD|XTI|WTI|CL|USO)/i;
      const found = names.find(s => s.toUpperCase() === req)
        || names.find(s => s.toUpperCase().startsWith(req))
        || (req.includes("XAU") ? (names.find(s => /xau.*usd/i.test(s)) || names.find(s => /^gold/i.test(s.trim()))) : undefined)
        || (oilReq ? names.find(s => oilFam.test(s)) : undefined);
      const resolved = found || requested;
      _symCache.set(key, resolved);
      return resolved;
    }
  } catch { /* */ }
  return requested;
}

// Fillimi i ditës sipas Frankfurt (Europe/Berlin) si instant UTC — që "dita" e humbjes
// të përkojë me sesionin/ditën lokale (jo me 00:00 UTC). DST-i trajtohet automatik.
function frankfurtDayStart(now = new Date()): Date {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value || "0");
  const y = g("year"), mo = g("month"), d = g("day"), h = g("hour"), mi = g("minute"), se = g("second");
  const offset = Date.UTC(y, mo - 1, d, h, mi, se) - now.getTime();
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - offset);
}
// Data e ditës sipas Frankfurt (YYYY-MM-DD) — për day_start_date.
function frankfurtDateStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Fillimi i dritares së rrezikut: mesnata e Frankfurtit, OSE pika e rinisjes manuale (risk_reset_at)
// nëse është më e vonë — që pas ndryshimeve të cilësimeve numëruesit e humbjes/serisë të fillojnë nga zero.
function riskWindowStart(cfg: Cfg): Date {
  const dayStart = frankfurtDayStart();
  const reset = cfg.risk_reset_at ? new Date(cfg.risk_reset_at) : null;
  return (reset && Number.isFinite(reset.getTime()) && reset.getTime() > dayStart.getTime()) ? reset : dayStart;
}

// P&L i REALIZUAR i ditës (që nga mesnata e Frankfurtit) — shuma e fitim/humbjeve të trade-ve
// të mbyllura sot (profit+commission+swap). Përdoret për limitin REAL të humbjes ditore.
async function realizedToday(cfg: Cfg): Promise<number> {
  try {
    const start = frankfurtDayStart();
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await maGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number }>;
    if (!Array.isArray(deals)) return 0;
    return deals.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0);
  } catch { return 0; }
}

// Humbja BRUTO e ditës — shuma e trade-ve HUMBËSE sot (pa i kompensuar me fitimet).
// Përdoret për ndalues më të rreptë: "kur humbjet kalojnë X, ndalo" (pavarësisht fitimeve).
async function grossLossToday(cfg: Cfg): Promise<number> {
  try {
    const start = riskWindowStart(cfg);
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await maGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number }>;
    if (!Array.isArray(deals)) return 0;
    let loss = 0;
    for (const d of deals) {
      const net = (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0);
      if (net < 0) loss += -net;
    }
    return loss;
  } catch { return 0; }
}

// ===== FILTRA EKSPERIMENTALË (opt-in per-përdorues: experimental_filters) =====
// Spread-guard: spread-i aktual (ask-bid) i një simboli. Kthen null nëse s'merret.
async function symbolSpread(cfg: Cfg, sym: string): Promise<number | null> {
  try {
    const p = await maGet(cfg, `/symbols/${encodeURIComponent(sym)}/current-price`) as { ask?: number; bid?: number };
    const ask = Number(p?.ask), bid = Number(p?.bid);
    if (Number.isFinite(ask) && Number.isFinite(bid) && ask > 0 && bid > 0) return Math.abs(ask - bid);
  } catch { /* */ }
  return null;
}
// Spread-i "i gjerë" për arin — pragu mbi të cilin shmangim hyrjet (orë të holla/lajme). Të tjerët: pa kufi.
const GOLD_SPREAD_MAX = 0.50;
function spreadTooWide(sym: string, spread: number | null): boolean {
  if (spread == null) return false; // s'e dimë → mos blloko
  if (/XAU/i.test(sym)) return spread > GOLD_SPREAD_MAX;
  return false;
}

// Cool-off: numëron humbjet RADHAZI (trailing) sot dhe kohën e humbjes së fundit, nga deal-et e mbyllura.
async function lossStreakToday(cfg: Cfg): Promise<{ consecutive: number; lastLossAt: number }> {
  try {
    const start = riskWindowStart(cfg);
    const path = `/history-deals/time/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(new Date().toISOString())}`;
    const deals = await maGet(cfg, path) as Array<{ profit?: number; commission?: number; swap?: number; time?: string; entryType?: string }>;
    if (!Array.isArray(deals)) return { consecutive: 0, lastLossAt: 0 };
    const closes = deals
      .filter((d) => d.entryType == null || /OUT/i.test(String(d.entryType))) // vetëm mbylljet (P&L real)
      .map((d) => ({ net: (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), t: new Date(d.time || 0).getTime() }))
      .filter((d) => Number.isFinite(d.t) && d.t > 0)
      .sort((a, b) => b.t - a.t);
    let consecutive = 0, lastLossAt = 0;
    for (const d of closes) {
      if (Math.abs(d.net) < 0.01) continue; // injoro break-even
      if (d.net < 0) { consecutive++; if (lastLossAt === 0) lastLossAt = d.t; } else break;
    }
    return { consecutive, lastLossAt };
  } catch { return { consecutive: 0, lastLossAt: 0 }; }
}

// TRAILING I SHPEJTË: ndjek SL-në te ÇDO pozicion duke mbajtur një PJESË të fitimit (trail_lock_pct),
// pasi profiti kalon trail_start_usd. I lehtë (vetëm /positions + modifikim) — thirret disa herë/minutë
// që SL-ja të ndjekë lëvizjen sa më shpejt që lejon sistemi.
async function trailPositions(cfg: Cfg): Promise<number> {
  if (cfg.trail_enabled === false) return 0;
  let positions: Position[] = [];
  try { positions = (await maGet(cfg, "/positions") as Position[]) ?? []; } catch { return 0; }
  if (!Array.isArray(positions) || positions.length === 0) return 0;
  const startUsd = Math.max(0.1, Number(cfg.trail_start_usd ?? 1));
  const lockFrac = Math.min(0.95, Math.max(0.05, Number(cfg.trail_lock_pct ?? 50) / 100));
  let moves = 0;
  for (const p of positions) {
    const isBuy = String(p.type || "").includes("BUY");
    const entry = Number(p.openPrice), cur = Number(p.currentPrice);
    const sl = p.stopLoss != null ? Number(p.stopLoss) : null;
    if (!Number.isFinite(entry) || !Number.isFinite(cur) || sl == null) continue;
    const moved = isBuy ? cur - entry : entry - cur;
    if (moved < startUsd) continue;
    const newSL = isBuy ? entry + moved * lockFrac : entry - moved * lockFrac;
    const better = isBuy ? newSL > sl : newSL < sl;
    if (better) {
      const beSL = Math.round(newSL * 100) / 100;
      try { await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: beSL, takeProfit: p.takeProfit ?? undefined }); moves++; } catch { /* */ }
    }
  }
  return moves;
}

// TRAILING NË ANË TË MT5/MetaApi (server-side, tick-by-tick). Vendos një trailing-stop me distancë
// fikse (në çmim) që MetaApi e mban automatik pas çdo tiku — ndjekje vërtet e vazhdueshme.
// Distanca = sa $ rri SL-ja pas çmimit (p.sh. = distanca fillestare e SL). Kthen true nëse u vendos.
async function setBrokerTrailing(cfg: Cfg, positionId: string, distancePrice: number, stopLoss?: number | null): Promise<boolean> {
  const dist = Math.max(0.1, Math.round(distancePrice * 100) / 100);
  try {
    const body: Record<string, unknown> = {
      actionType: "POSITION_MODIFY",
      positionId,
      trailingStopLoss: { distance: { distance: dist, units: "RELATIVE_PRICE" } },
    };
    // Mbaj edhe një SL statike si DYSHEME — që pozicioni të mos mbetet kurrë pa SL nëse brokeri s'e mban trailing-un.
    if (stopLoss != null && Number.isFinite(stopLoss)) body.stopLoss = Math.round(stopLoss * 100) / 100;
    const r = await maTrade(cfg, body);
    return r.ok;
  } catch { return false; }
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

// Njoftim Web Push (best-effort) — thërret funksionin web-push-send me service-role (internal).
// S'duhet të ndalë KURRË robotin: timeout i shkurtër + gabimet injorohen.
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

// Bias-i i dollarit përmes EURUSD (proxy i DXY: ari ka korrelacion negativ me dollarin).
// "weak" = dollar i dobët → mbështet ar BLEJ; "strong" = dollar i fortë → mbështet ar SHIT.
async function dollarBias(cfg: Cfg): Promise<"weak" | "strong" | "neutral"> {
  try {
    const c = await fetchMt5Candles(cfg, "EURUSD", "1h", 120);
    if (!c || c.length < 60) return "neutral";
    const closes = c.map((x) => x.close);
    const e50 = ema(closes, 50);
    const i = closes.length - 1;
    const price = closes[i], m = e50[i];
    if (!Number.isFinite(m) || !(m > 0)) return "neutral";
    const diff = (price - m) / m;
    if (diff > 0.0025) return "weak";    // EURUSD qartë mbi EMA50 → dollar i dobët
    if (diff < -0.0025) return "strong"; // EURUSD qartë nën EMA50 → dollar i fortë
    return "neutral";
  } catch { return "neutral"; }
}

// Filtër lajmesh: bllokon hapjen e trade-ve rreth lajmeve USD me ndikim TË LARTË
// (NFP/CPI/FOMC). Burim falas pa çelës: faireconomy (kalendari javor i ForexFactory).
const NEWS_BEFORE_MIN = 15, NEWS_AFTER_MIN = 30;
let newsCache: { at: number; times: number[] } | null = null;
async function usdHighImpactTimes(): Promise<number[]> {
  if (newsCache && Date.now() - newsCache.at < 30 * 60 * 1000) return newsCache.times;
  try {
    const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) { newsCache = { at: Date.now(), times: [] }; return []; }
    const arr = await resp.json() as Array<{ country?: string; impact?: string; date?: string }>;
    const times = (Array.isArray(arr) ? arr : [])
      .filter((e) => e.country === "USD" && /high/i.test(e.impact || "") && e.date)
      .map((e) => new Date(e.date as string).getTime())
      .filter((t) => Number.isFinite(t));
    newsCache = { at: Date.now(), times };
    return times;
  } catch { return []; }
}
async function inNewsBlackout(): Promise<boolean> {
  const now = Date.now();
  const times = await usdHighImpactTimes();
  return times.some((t) => now >= t - NEWS_BEFORE_MIN * 60000 && now <= t + NEWS_AFTER_MIN * 60000);
}

const MAX_HEAT_PCT = 6; // rreziku total i hapur (portfolio heat) s'kalon 6% të kapitalit

// ===== RRUGA B: porositë në RADHË para-hapjeje → dërgo te brokeri sapo hapet tregu =====
// Vetëm porositë 'queued' (kur Rruga A — pending te brokeri — dështoi). Dërgohen si porosi TREGU
// me çmimin real të hapjes + SL/TP të ruajtura. ('placed' i menaxhon brokeri → nuk preken këtu,
// kështu shmanget hyrja e DYFISHTË.) Kërkon SL (siguri). Skadon porositë e vjetra.
async function submitQueuedOrders(db: DB, cfg: Cfg): Promise<void> {
  if (!isMarketOpen()) return; // tregu ende i mbyllur → prit hapjen
  let queued: Array<Record<string, unknown>> = [];
  try {
    const { data } = await db.from("pre_open_orders")
      .select("id, symbol, action, volume, stop_loss, take_profit, expires_at")
      .eq("user_id", cfg.user_id).eq("status", "queued").limit(20);
    queued = (data ?? []) as Array<Record<string, unknown>>;
  } catch { return; }
  for (const q of queued) {
    const id = q.id as string;
    const exp = q.expires_at ? new Date(q.expires_at as string).getTime() : 0;
    if (exp && Date.now() > exp) { try { await db.from("pre_open_orders").update({ status: "expired" }).eq("id", id); } catch { /* */ } continue; }
    const sym = String(q.symbol || ""), action = String(q.action || "");
    const volume = Number(q.volume) || 0;
    const sl = q.stop_loss != null ? Number(q.stop_loss) : null;
    const tp = q.take_profit != null ? Number(q.take_profit) : null;
    if (!(volume >= 0.01) || (action !== "BUY" && action !== "SELL")) { try { await db.from("pre_open_orders").update({ status: "failed", reason: "parametra të pavlefshëm" }).eq("id", id); } catch { /* */ } continue; }
    // SIGURI: mos dërgo pa stop-loss (njësoj si rregulli i robotit).
    if (!(sl != null && sl > 0)) { try { await db.from("pre_open_orders").update({ status: "failed", reason: "pa stop-loss — refuzuar (siguri)" }).eq("id", id); } catch { /* */ } continue; }
    const body: Record<string, unknown> = { actionType: action === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: sym, volume, stopLoss: sl };
    if (tp != null) body.takeProfit = tp;
    try {
      const r = await maTrade(cfg, body);
      const br = brokerResult(r.body);
      if (br.ok) {
        await db.from("pre_open_orders").update({ status: "submitted", broker_order_id: br.orderId, submitted_at: new Date().toISOString() }).eq("id", id);
        try { await db.from("trade_executions").insert({ user_id: cfg.user_id, symbol: sym, action, volume, stop_loss: sl, take_profit: tp, mode: cfg.mode, status: "executed", reason: "Porosi para-hapjeje — hyri në hapje të tregut", metaapi_order_id: br.orderId, raw_response: r.body }); } catch { /* */ }
      } else {
        await db.from("pre_open_orders").update({ status: "failed", reason: `Brokeri: ${(br.msg || "refuzuar").slice(0, 150)} (${br.code})` }).eq("id", id);
      }
    } catch (e) {
      try { await db.from("pre_open_orders").update({ status: "failed", reason: (e as Error).message.slice(0, 150) }).eq("id", id); } catch { /* */ }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: Array<Record<string, unknown>> = [];
  const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    // Filtri i lajmeve (një herë për ekzekutim): a jemi rreth një lajmi USD me ndikim të lartë?
    const newsBlock = await inNewsBlackout();

    // RRUGA B: sapo hapet tregu, dërgo porositë në radhë para-hapjeje — për ÇDO përdorues me radhë
    // (jo vetëm ata me auto-trade; një porosi manuale para-hapjeje duhet të hyjë edhe pa auto-trade).
    if (isMarketOpen()) {
      try {
        const { data: qUsers } = await db.from("pre_open_orders").select("user_id").eq("status", "queued").limit(200);
        const uids = [...new Set((qUsers ?? []).map((r) => (r as { user_id: string }).user_id))];
        for (const uid of uids) {
          const { data: ucfg } = await db.from("metaapi_config").select("*").eq("user_id", uid).maybeSingle();
          const c = ucfg as Cfg | null;
          if (c && c.account_id && c.token && c.kill_switch !== true) {
            try { await submitQueuedOrders(db, c); } catch { /* */ }
          }
        }
      } catch { /* */ }
    }

    const { data: configs } = await db
      .from("metaapi_config").select("*").eq("auto_trade", true).eq("kill_switch", false);

    for (const raw of (configs ?? [])) {
      const cfg = raw as Cfg;
      if (!cfg.account_id || !cfg.token) continue;

      let positions: Position[] = [];
      let dayPnl = 0; // P&L i ditës = equity_tani − equity_fillimi (përfshin realized + floating)
      let grossLoss = 0; // humbja BRUTO e ditës (vetëm trade-t humbëse)
      let equity = 0; // kapitali aktual (për position sizing 1%)
      try {
        positions = (await maGet(cfg, "/positions") as Position[]) ?? [];
        if (!Array.isArray(positions)) positions = [];
        const info = await maGet(cfg, "/account-information") as { balance?: number; equity?: number };
        const bal = Number(info?.balance), eq = Number(info?.equity);
        equity = Number.isFinite(eq) ? eq : (Number.isFinite(bal) ? bal : 0);
        // SAFE-MODE për kapital të vogël (< €50): detyro vetëm lot-in MINIMAL (0.01), pavarësisht
        // cilësimeve manuale → roboti vazhdon të tregtojë, por me rrezik minimal për trade.
        if (equity > 0 && equity < 50) { cfg.max_lot = 0.01; cfg.default_lot = 0.01; }
        // LIMITI DITOR I HUMBJES — i bazuar te EKUITETI (i besueshëm; s'dështon në heshtje si
        // thirrja history-deals). Ruajmë ekuitetin në fillim të ditës UTC; humbja = equity − fillimi.
        if (equity > 0) {
          const todayUtc = frankfurtDateStr();
          let dayStartEq = Number((cfg as { day_start_equity?: number }).day_start_equity);
          const dsd = (cfg as { day_start_date?: string }).day_start_date
            ? String((cfg as { day_start_date?: string }).day_start_date).slice(0, 10) : "";
          if (dsd !== todayUtc || !Number.isFinite(dayStartEq) || dayStartEq <= 0) {
            dayStartEq = equity;
            try { await db.from("metaapi_config").update({ day_start_equity: equity, day_start_date: todayUtc }).eq("user_id", cfg.user_id); } catch { /* */ }
          }
          dayPnl = (Number.isFinite(dayStartEq) && dayStartEq > 0) ? equity - dayStartEq : 0;
        }
        // Humbja BRUTO e ditës — ndalues më i rreptë (kur humbjet kalojnë limitin, pavarësisht fitimeve).
        grossLoss = await grossLossToday(cfg);
      } catch (e) {
        summary.push({ user: cfg.user_id, error: `metaapi: ${(e as Error).message}` });
        continue;
      }
      // NDALUES DITOR: ndalon kur humbja NETO (ekuiteti) OSE humbja BRUTO kalon kufirin.
      const maxDailyRisk = Number(cfg.max_daily_loss) || 0;
      const dailyStop = maxDailyRisk > 0 && (dayPnl <= -maxDailyRisk || grossLoss >= maxDailyRisk);
      // DUKSHMËRI: kur roboti ndalet nga limiti ditor, shëno NJË rresht + push (një herë në ditë), që
      // përdoruesi ta dijë pse s'po hapen trade (më parë heshtte → dukej sikur s'punon).
      if (dailyStop) {
        try {
          const { data: alreadyStopped } = await db.from("trade_executions").select("id")
            .eq("user_id", cfg.user_id).eq("status", "info").ilike("reason", "Roboti u ndal për sot%")
            .gte("created_at", frankfurtDayStart().toISOString()).limit(1);
          if (!alreadyStopped || alreadyStopped.length === 0) {
            const which = grossLoss >= maxDailyRisk ? `bruto ${grossLoss.toFixed(2)}` : `neto ${dayPnl.toFixed(2)}`;
            await db.from("trade_executions").insert({
              user_id: cfg.user_id, symbol: "XAUUSD", action: "BUY", volume: 0.01, mode: cfg.mode, status: "info",
              reason: `Roboti u ndal për sot — limiti ditor i humbjes (${maxDailyRisk}) u arrit (${which}). Tregtitë e reja u pauzuan deri nesër.`,
            });
            await pushNotify({ user_id: cfg.user_id, title: "Roboti u ndal për sot", body: `Limiti ditor i humbjes (${maxDailyRisk}€) u arrit (${which}). Tregtitë e reja u pauzuan deri nesër.`, url: "/", tag: "daily-stop" });
          }
        } catch { /* njoftimi s'duhet të ndalë robotin */ }
      }
      let openTrades = positions.length;
      const scalpOn = cfg.strategy_scalp === true;
      const swingOn = cfg.strategy_swing !== false; // default ON
      let scalpOpen = positions.filter(isScalpPosition).length;

      // FILTRA EKSPERIMENTALË (opt-in): vetëm spread-guard (zbatohet brenda lak-eve të hyrjes).
      // Cool-off pas serie humbjesh u HOQ me kërkesë të përdoruesit — roboti NUK ndalon vetë pas humbjesh
      // radhazi. Nëse përdoruesi do të ndalet, fik vetë auto-trade.
      const expOn = cfg.experimental_filters === true;
      const expBlockOpens = false; // pa ndalim automatik pas humbjesh radhazi
      // Cache spread-i (një thirrje për simbol) për spread-guard-in eksperimental.
      const spreadCache = new Map<string, number | null>();
      const getSpread = async (s: string) => { if (!spreadCache.has(s)) spreadCache.set(s, await symbolSpread(cfg, s)); return spreadCache.get(s) ?? null; };

      // PORTFOLIO HEAT (Tier-2): rreziku total i hapur (distanca te SL × vlerë × lot).
      let openHeat = 0;
      for (const p of positions) {
        const op = Number(p.openPrice), sl = p.stopLoss != null ? Number(p.stopLoss) : null, vol = Number(p.volume) || 0;
        if (Number.isFinite(op) && sl != null && vol > 0) openHeat += Math.abs(op - sl) * valuePerPrice(p.symbol || "XAUUSD") * vol;
      }

      // Cache i qirinjve (një herë për simbol) — për menaxhimin scalp + hyrjet scalp.
      const c1mCache = new Map<string, Candle[] | null>();
      const c5mCache = new Map<string, Candle[] | null>();
      const get1m = async (s: string) => { if (!c1mCache.has(s)) c1mCache.set(s, await fetchMt5Candles(cfg, s, "1m", 120)); return c1mCache.get(s) ?? null; };
      const get5m = async (s: string) => { if (!c5mCache.has(s)) c5mCache.set(s, await fetchMt5Candles(cfg, s, "5m", 120)); return c5mCache.get(s) ?? null; };

      // MENAXHIMI I POZICIONEVE TË HAPURA
      for (const p of positions) {
        const isBuy = String(p.type || "").includes("BUY");
        const entry = Number(p.openPrice), cur = Number(p.currentPrice);
        const sl = p.stopLoss != null ? Number(p.stopLoss) : null;
        if (!Number.isFinite(entry) || !Number.isFinite(cur)) continue;

        // ---- MENAXHIM I PËRBASHKËT: trailing progresiv për ÇDO pozicion ----
        const moved = isBuy ? cur - entry : entry - cur; // $ në favor
        const scalp = isScalpPosition(p);

        // 1) SCALP: dil shpejt nëse momentum-i 1m kthehet ndërsa je në profit (mbylle në fitim).
        if (scalp && moved > 0.3) {
          const c1 = await get1m((p.symbol || "XAUUSD").toUpperCase());
          if (c1 && scalpReversal(c1, isBuy)) {
            try {
              const r = await maTrade(cfg, { actionType: "POSITION_CLOSE_ID", positionId: p.id });
              if (r.ok) await pushNotify({ user_id: cfg.user_id, title: "Roboti mbylli një trade", body: `${(p.symbol || "XAUUSD")} ${isBuy ? "BLEJ" : "SHIT"} • mbyllur në fitim (${moved >= 0 ? "+" : ""}${moved.toFixed(2)}$)`, url: "/", tag: "trade-close" });
              summary.push({ user: cfg.user_id, scalp_exit: p.id, reason: "reversal_lock_profit", ok: r.ok });
            } catch { /* */ }
            continue;
          }
        }

        // 2a) BROKER TRAILING (server-side, tick-by-tick): vendoset NJË herë; MetaApi e ndjek vetë
        //     pas çdo tiku (ndjekje vërtet e vazhdueshme). Distanca = distanca fillestare e SL-së.
        if (cfg.broker_trailing && sl != null) {
          // Vendoset NJË herë për pozicion: kontrollojmë te log-u (që mos të ripërsëritet çdo minutë).
          const { data: already } = await db.from("trade_executions").select("id")
            .eq("user_id", cfg.user_id).eq("metaapi_order_id", p.id).ilike("reason", "Broker-trailing%").limit(1);
          if (!already || already.length === 0) {
            const dist = Math.max(0.3, Math.abs(entry - sl));
            const ok = await setBrokerTrailing(cfg, p.id, dist, sl);
            // LOG I DUKSHËM te "Ekzekutimet e fundit" — që përdoruesi ta konfirmojë nëse punoi.
            try {
              await db.from("trade_executions").insert({
                user_id: cfg.user_id, symbol: p.symbol || "XAUUSD", action: isBuy ? "BUY" : "SELL",
                volume: p.volume ?? 0.01, stop_loss: sl, take_profit: p.takeProfit ?? null, mode: cfg.mode,
                status: ok ? "info" : "rejected",
                reason: ok ? `Broker-trailing AKTIV (MT5 ndjek SL-në çdo tik, distancë ${dist.toFixed(2)}$)` : "Broker-trailing DËSHTOI — brokeri s'e mbështet (përdor trailing-un e robotit)",
                metaapi_order_id: p.id, raw_response: null,
              });
            } catch { /* */ }
            summary.push({ user: cfg.user_id, broker_trail: p.id, dist, ok });
          }
        }
        // 2b) MENAXHIM I SL-së (polling) — Break-even+offset DHE/OSE trailing me %. Të dyja e ngrenë
        //     SL-në vetëm PËRPARA. Përdoret kur broker-trailing-u është OFF. Vlen për ÇDO pozicion
        //     (auto OSE manual — të gjitha pozicionet e hapura në llogari).
        else if (sl != null && (cfg.trail_enabled !== false || cfg.be_enabled === true)) {
          let target = sl;
          // BREAK-EVEN + offset: kur fitimi (lëvizja në favor) kalon 2× offset, ngul SL te hyrja ± offset
          // → mbyll rrezikun dhe bllokon offset-in (p.sh. +9 pips). Aktivizimi te 2× siguron SL të vlefshëm.
          if (cfg.be_enabled === true) {
            const off = Math.max(0, Number(cfg.be_offset_usd ?? 0.9));
            if (off > 0 && moved >= off * 2) {
              const beTarget = isBuy ? entry + off : entry - off;
              if (isBuy ? beTarget > target : beTarget < target) target = beTarget;
            }
          }
          // TRAILING me %: SL mban një fraksion (trail_lock_pct) të fitimit, pasi profiti kalon trail_start_usd.
          if (cfg.trail_enabled !== false) {
            const startUsd = Math.max(0.1, Number(cfg.trail_start_usd ?? 1));
            const lockFrac = Math.min(0.95, Math.max(0.05, Number(cfg.trail_lock_pct ?? 50) / 100));
            if (moved >= startUsd) {
              const newSL = isBuy ? entry + moved * lockFrac : entry - moved * lockFrac;
              if (isBuy ? newSL > target : newSL < target) target = newSL;
            }
          }
          const better = isBuy ? target > sl : target < sl;
          if (better) {
            const beSL = Math.round(target * 100) / 100;
            try { const r = await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: beSL, takeProfit: p.takeProfit ?? undefined }); summary.push({ user: cfg.user_id, trail: p.id, sl: beSL, ok: r.ok }); } catch { /* */ }
          }
        }
      }

      const allowed = new Set((cfg.auto_symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
      if (allowed.size === 0) continue;

      // ARI tregtohet SA HERË tregu është i HAPUR (rihapja e së dielës ~22:00 UTC → mbyllja e së premtes
      // 21:00 UTC), JO vetëm 09:00–23:00 Frankfurt. Kërkesë e përdoruesit: roboti të fillojë sapo hapet
      // tregu të dielën në mbrëmje. (Crypto 24/7 & naftë ~23h kalojnë gjithsesi; trailing/break-even
      // vazhdon 24/7 te blloku i menaxhimit më sipër — kjo portë prek vetëm HYRJET E REJA.)
      if (!isMarketOpen()) {
        for (const s of [...allowed]) { if (!isCrypto(s) && !isOil(s)) allowed.delete(s); }
        if (allowed.size === 0) { summary.push({ user: cfg.user_id, status: "treg_i_mbyllur" }); continue; }
      }
      // NAFTË: bllokim rreth raportit javor EIA (e mërkurë 10:00–11:00 ET) — hiq naftën nga lista atëherë.
      if (eiaBlackout()) {
        for (const s of [...allowed]) { if (isOil(s)) allowed.delete(s); }
        if (allowed.size === 0) { summary.push({ user: cfg.user_id, status: "eia_blackout" }); continue; }
      }
      // Filtri i lajmeve: pauzë rreth NFP/CPI/FOMC.
      if (newsBlock) { summary.push({ user: cfg.user_id, status: "news_blackout" }); continue; }

      // ============ HYRJET SCALP (afat-shkurt: momentum 1m/5m, SL/TP të ngushtë) ============
      if (scalpOn) {
        const scalpMax = Math.max(1, Number(cfg.scalp_max_trades ?? 2));
        const maxRisk = Number(cfg.max_daily_loss) || 0;
        for (const rawSym of allowed) {
          if (openTrades >= cfg.max_open_trades || scalpOpen >= scalpMax) break;
          if (dailyStop) break; // limit humbjeje ditore (neto te ekuiteti OSE bruto e trade-ve humbëse)
          if (expBlockOpens) break; // EKSPERIMENTAL: cool-off pas serie humbjesh
          // Emri REAL i simbolit te brokeri (rregullon "Unknown symbol 4301").
          const sym = await resolveSymbol(cfg, rawSym);
          if (positions.some((p) => isScalpPosition(p) && (p.symbol || "").toUpperCase() === sym.toUpperCase())) continue; // një scalp për simbol
          // EKSPERIMENTAL: spread-guard — mos hap kur spread-i i arit është i gjerë (orë të holla/lajme).
          if (expOn && spreadTooWide(sym, await getSpread(sym))) { summary.push({ user: cfg.user_id, scalp: sym, status: "spread_too_wide" }); continue; }
          // COOLDOWN: mos hap scalp të ri brenda 3 min nga scalp-i i fundit (shmang grumbullimin në ekstreme).
          const { data: lastSc } = await db.from("trade_executions").select("created_at")
            .eq("user_id", cfg.user_id).eq("symbol", sym).eq("status", "executed")
            .ilike("reason", "Scalp auto%").order("created_at", { ascending: false }).limit(1);
          const lastT = lastSc && lastSc[0] ? new Date((lastSc[0] as { created_at: string }).created_at).getTime() : 0;
          if (lastT > 0 && Date.now() - lastT < 3 * 60 * 1000) continue;
          const [c1, c5] = await Promise.all([get1m(sym), get5m(sym)]);
          if (!c1 || !c5) continue;
          const sgl = scalpSignal(c1, c5, cfg.scalp_small_moves === true);
          if (!sgl) continue;

          const isBuyS = sgl.action === "BUY";
          const entryPx = c1[c1.length - 1].close;

          // SL/TP BAZË: ar → $ fiks; CRYPTO & NAFTË → % e çmimit ($-i fiks s'i përshtatet
          // shkallës së çmimit → SL i gabuar). Të gjitha të konfigurueshme nga përdoruesi.
          const cry = isCrypto(rawSym), oil = isOil(rawSym);
          const baseSL = cry
            ? Math.max(entryPx * (Number(cfg.scalp_sl_pct ?? 0.3) / 100), 0.0001)
            : oil
            ? Math.max(entryPx * (Number(cfg.scalp_sl_pct_oil ?? 0.4) / 100), 0.01)
            : Math.max(0.3, Number(cfg.scalp_sl_usd ?? 2));
          const baseTP = cry
            ? Math.max(baseSL, entryPx * (Number(cfg.scalp_tp_pct ?? 0.6) / 100))
            : oil
            ? Math.max(baseSL, entryPx * (Number(cfg.scalp_tp_pct_oil ?? 0.8) / 100))
            : Math.max(baseSL, Number(cfg.scalp_tp_usd ?? 4));
          const scalpRR = baseSL > 0 ? baseTP / baseSL : 2; // R:R nga cilësimet

          // SL/TP sipas ATR(5m): jashtë zhurmës momentale; R:R ruhet; kapet në [0.7×, 2×] të bazës.
          const a5 = atr(c5.map((c) => c.high), c5.map((c) => c.low), c5.map((c) => c.close), 14);
          const atr5v = a5[a5.length - 1];
          let slUsd = baseSL;
          let rrUsed = scalpRR;
          if (cfg.auto_sltp === true) {
            // AUTO SL/TP (opt-in): SL/TP dalin KREJT nga analiza e tregut — ATR(5m) × 1.2 jashtë
            // zhurmës — me dysheme/tavan nga çmimi dhe nga BALANCA (rreziku i lotit minimal 0.01
            // kapet te ~2.5% e ekuitetit). Vlerat manuale injorohen; R:R fiks 1:2 (standardi i
            // provuar i swing-ut). OFF (default) → dega tjetër = sjellja ekzistuese e pandryshuar.
            const floorSL = Math.max(entryPx * 0.0004, 1);
            const balCap = equity > 0 ? Math.max(entryPx * 0.0005, equity * 0.025) : entryPx * 0.006;
            const capSL = Math.max(floorSL, Math.min(entryPx * 0.008, balCap));
            const atrSL = Number.isFinite(atr5v) && atr5v > 0 ? atr5v * 1.2 : baseSL;
            slUsd = Math.min(Math.max(atrSL, floorSL), capSL);
            rrUsed = 2;
          } else if (Number.isFinite(atr5v) && atr5v > 0) {
            slUsd = Math.min(Math.max(atr5v, 0.7 * baseSL), 2 * baseSL);
          }
          slUsd = Math.round(slUsd * 100) / 100;
          const tpUsd = Math.round(slUsd * rrUsed * 100) / 100;
          const stopLoss = Math.round((isBuyS ? entryPx - slUsd : entryPx + slUsd) * 100) / 100;
          const takeProfit = Math.round((isBuyS ? entryPx + tpUsd : entryPx - tpUsd) * 100) / 100;

          // POSITION SIZING (fixed-fractional, si swing): lot nga rreziku real i SL ($).
          const vpp = valuePerPrice(sym);
          const riskPct = Number(cfg.risk_per_trade_pct) || 1;
          const equityRisk = equity > 0 ? equity * (riskPct / 100) : 0;
          let perTradeRisk = equityRisk > 0 ? equityRisk : maxRisk;
          if (maxRisk > 0) perTradeRisk = Math.min(perTradeRisk || maxRisk, maxRisk);
          let volume = lotForConfidence(cfg, 70);
          if (perTradeRisk > 0) { const lotByRisk = Math.floor((perTradeRisk / (slUsd * vpp)) * 100) / 100; if (lotByRisk < volume) volume = lotByRisk; }
          volume = Math.round(volume * 100) / 100;
          // Lejo lotin minimal 0.01 edhe nëse 1% del nën të — mjafton që rreziku i tij të mos e kalojë kufirin DITOR.
          const minLotRisk = slUsd * vpp * 0.01;
          if (volume < 0.01) volume = (maxRisk <= 0 || minLotRisk <= maxRisk) ? 0.01 : 0;

          const slog = (status: string, reason: string, orderId: string | null, raw: unknown) =>
            db.from("trade_executions").insert({ user_id: cfg.user_id, symbol: sym, action: sgl.action, volume: Math.max(volume, 0.01),
              entry_price: entryPx, stop_loss: stopLoss, take_profit: takeProfit, mode: cfg.mode, status, reason: reason.slice(0, 200), metaapi_order_id: orderId, raw_response: raw ?? null });

          if (volume < 0.01) { await slog("rejected", `Scalp: edhe 0.01 lot rrezikon $${minLotRisk.toFixed(2)} > kufiri ditor ($${maxRisk}) — rrit kufirin ditor`, null, null); summary.push({ user: cfg.user_id, scalp: sym, status: "too_risky" }); continue; }
          const thisRisk = slUsd * vpp * volume;
          // Mbrojtja 6% (portfolio heat) vlen për lote të mëdha. Lotin MINIMAL e lejojmë sa kohë
          // rreziku total i hapur mbetet brenda kufirit DITOR (max_daily_loss) — mbrojtja reale për llogari të vogël.
          const heatCap = equity * (MAX_HEAT_PCT / 100);
          const withinDaily = maxRisk <= 0 || (openHeat + thisRisk) <= maxRisk;
          if (equity > 0 && (openHeat + thisRisk) > heatCap && !(volume <= 0.01 && withinDaily)) { await slog("rejected", `Scalp portfolio heat: rreziku total do kalonte ${MAX_HEAT_PCT}%`, null, null); summary.push({ user: cfg.user_id, scalp: sym, status: "portfolio_heat" }); continue; }

          // SIGURI: asnjë trade pa stop-loss (mbron nga humbje e pakufizuar). S'ekzekuton pa SL të vlefshëm.
          if (!(stopLoss > 0)) { await slog("rejected", "Scalp pa stop-loss — refuzuar (siguri)", null, null); summary.push({ user: cfg.user_id, scalp: sym, status: "no_sl" }); continue; }

          const body: Record<string, unknown> = { actionType: isBuyS ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: sym, volume, stopLoss, takeProfit, comment: SCALP_TAG };
          try {
            const r = await maTrade(cfg, body);
            if (!r.ok) { await slog("error", `Scalp trade ${r.status}`, null, r.body); summary.push({ user: cfg.user_id, scalp: sym, status: "error" }); continue; }
            const br = brokerResult(r.body);
            if (!br.ok) { await slog("rejected", `Scalp brokeri: ${br.msg || "refuzuar"} (${br.code})`, null, r.body); summary.push({ user: cfg.user_id, scalp: sym, status: "broker_rejected", code: br.code }); continue; }
            await slog("executed", `Scalp auto (${cfg.mode}${cfg.auto_sltp === true ? ", SL/TP auto" : ""}): ${sgl.reason}`, br.orderId, r.body);
            openTrades += 1; scalpOpen += 1; openHeat += thisRisk;
            await pushNotify({ user_id: cfg.user_id, title: "Roboti hapi një trade", body: `${isBuyS ? "BLEJ" : "SHIT"} ${sym} • ${volume} lot (scalp, ${cfg.mode})`, url: "/", tag: "trade-open" });
            summary.push({ user: cfg.user_id, scalp: sym, status: "executed", order: br.orderId });
          } catch (e) { await slog("error", `Scalp: ${(e as Error).message}`, null, null); summary.push({ user: cfg.user_id, scalp: sym, status: "error" }); }
        }
      }

      // ============ HYRJET SWING (afat-gjatë: sinjalet 15m/1h/4h nga motori) ============
      if (!swingOn) continue;

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

      // Bias-i i dollarit (një herë për përdorues) — për konfirmim ar↔dollar.
      const dxy = candidates.length > 0 ? await dollarBias(cfg) : "neutral";

      for (const sig of candidates) {
        const { data: existing } = await db
          .from("trade_executions").select("id").eq("user_id", cfg.user_id).eq("signal_id", sig.id).limit(1);
        if (existing && existing.length > 0) continue;

        const action = sig.type === "buy" ? "BUY" : "SELL";
        const isBuy = action === "BUY";
        // Emri REAL i simbolit te brokeri (rregullon "Unknown symbol 4301").
        const tradeSym = await resolveSymbol(cfg, sig.symbol);

        // ---- ANKORIM te çmimi REAL MT5 (zgjidh bug-un PAXG→MT5) + konteksti i grafikut ----
        let entryPx: number | undefined;
        let stopLoss: number | undefined;
        let takeProfit: number | undefined;
        let slDist = 0;
        let tpDist = 0;
        let ctx: Record<string, unknown> | null = null;
        let dataSrc = "mt5";

        const [m15, m1h, m4h] = await Promise.all([
          fetchMt5Candles(cfg, tradeSym, "15m", 300),
          fetchMt5Candles(cfg, tradeSym, "1h", 300),
          fetchMt5Candles(cfg, tradeSym, "4h", 300),
        ]);

        if (m15 && m1h && m4h && m15.length > 30 && m1h.length > 30 && m4h.length > 30) {
          const t15 = buildTF(m15, "15m"), t1h = buildTF(m1h, "1h"), t4h = buildTF(m4h, "4h");
          entryPx = t15.price; // çmimi më i freskët MT5
          // NAFTË: SL më i gjerë (ATR×2.0) — më volatile se ari; RR 1:2 ruhet.
          const stopMult = isOil(sig.symbol) ? 2.0 : 1.5;
          slDist = t1h.atr > 0 ? t1h.atr * stopMult : entryPx * (isOil(sig.symbol) ? 0.02 : 0.015);
          tpDist = slDist * 2;
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
          tpDist = entryPx != null && takeProfit != null ? Math.abs(takeProfit - entryPx) : slDist * 2;
        }

        // POSITION SIZING (fixed-fractional): rreziku per-trade = % e kapitalit (default 1%),
        // i kapur te kufiri ditor; lot-i del nga distanca REALE e SL.
        let volume = lotForConfidence(cfg, Number(sig.confidence) || 0);
        const maxRisk = Number(cfg.max_daily_loss) || 0;
        const riskPct = Number(cfg.risk_per_trade_pct) || 1;
        const equityRisk = equity > 0 ? equity * (riskPct / 100) : 0;
        // perTradeRisk = min(kapital×rrezik%, kufiri ditor) — që një trade s'e kalon buxhetin ditor.
        let perTradeRisk = equityRisk > 0 ? equityRisk : maxRisk;
        if (maxRisk > 0) perTradeRisk = Math.min(perTradeRisk || maxRisk, maxRisk);
        let tooRisky = false;
        if (slDist > 0 && perTradeRisk > 0) {
          const vpp = valuePerPrice(sig.symbol);
          const lotByRisk = Math.floor((perTradeRisk / (slDist * vpp)) * 100) / 100;
          if (lotByRisk < volume) volume = lotByRisk;
          if (volume < 0.01) {
            // Lejo lotin minimal 0.01 nëse rreziku i tij s'e kalon kufirin DITOR (përndryshe refuzo).
            const minLotRisk = slDist * vpp * 0.01;
            if (maxRisk <= 0 || minLotRisk <= maxRisk) volume = 0.01; else tooRisky = true;
          }
        }
        volume = Math.round(volume * 100) / 100;

        // PORTA R:R NETO — pas kostos së përafërt (spread/slippage), refuzo nëse R:R < 1.5.
        const spreadCost = entryPx != null ? entryPx * 0.00008 : 0; // ~0.008% (≈ $0.32 te $4000)
        const netRR = slDist + spreadCost > 0 ? (tpDist - spreadCost) / (slDist + spreadCost) : 0;

        const log = (status: string, reason: string, orderId: string | null, rawResp: unknown) =>
          db.from("trade_executions").insert({
            user_id: cfg.user_id, signal_id: sig.id, symbol: tradeSym, action, volume: Math.max(volume, 0.01),
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
        if (dailyStop) { await log("rejected", `Limit humbjeje ditore arritur (neto ${dayPnl.toFixed(2)}, bruto ${grossLoss.toFixed(2)}, kufi ${maxDailyRisk})`, null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "daily_loss_limit" }); continue; }
        // EKSPERIMENTAL: cool-off pas serie humbjesh — ndal edhe sinjalet swing.
        if (expBlockOpens) { summary.push({ user: cfg.user_id, signal: sig.id, status: "cooloff" }); continue; }
        // PORTA R:R NETO — refuzo setup-et me raport të dobët pas kostove.
        if (netRR > 0 && netRR < 1.5) { await log("rejected", `R:R neto i dobët (${netRR.toFixed(2)} < 1.5) pas kostove`, null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "low_rr" }); continue; }
        // KONFIRMIM DOLLARI (DXY via EURUSD) — refuzo kur dollari shkon qartë kundër arit.
        if (isBuy && dxy === "strong") { await log("rejected", "Dollari i fortë (kundër BLEJ ari) — konfirmim DXY", null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "dollar_veto" }); continue; }
        if (!isBuy && dxy === "weak") { await log("rejected", "Dollari i dobët (kundër SHIT ari) — konfirmim DXY", null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "dollar_veto" }); continue; }
        // PORTFOLIO HEAT — rreziku total i hapur + ky trade s'duhet të kalojë MAX_HEAT_PCT të kapitalit.
        if (equity > 0 && perTradeRisk > 0 && (openHeat + perTradeRisk) > equity * (MAX_HEAT_PCT / 100)) {
          await log("rejected", `Portfolio heat: rreziku total i hapur do kalonte ${MAX_HEAT_PCT}% të kapitalit`, null, null);
          summary.push({ user: cfg.user_id, signal: sig.id, status: "portfolio_heat" }); continue;
        }

        // SIGURI: asnjë trade pa stop-loss (mbron nga humbje e pakufizuar). S'ekzekuton pa SL të vlefshëm.
        if (!(Number(stopLoss) > 0)) { await log("rejected", "Trade pa stop-loss — refuzuar (siguri)", null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "no_sl" }); continue; }

        // EKSPERIMENTAL: spread-guard — mos hap kur spread-i i arit është i gjerë (orë të holla/lajme).
        if (expOn && spreadTooWide(tradeSym, await getSpread(tradeSym))) { summary.push({ user: cfg.user_id, signal: sig.id, status: "spread_too_wide" }); continue; }

        // CLAUDE SI PORTË — me kontekstin e grafikut MT5.
        const gate = await claudeConfirm(db, sig, action, { entry: entryPx, sl: stopLoss, tp: takeProfit, confidence: Number(sig.confidence) || 0 }, ctx);
        if (!gate.agree) { await log("rejected", `Claude s'pajtohet: ${gate.reason}`.slice(0, 200), null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "claude_rejected" }); continue; }

        const tradeBody: Record<string, unknown> = {
          actionType: isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
          symbol: tradeSym, volume,
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
          await pushNotify({ user_id: cfg.user_id, title: "Roboti hapi një trade", body: `${isBuy ? "BLEJ" : "SHIT"} ${tradeSym} • ${volume} lot (${cfg.mode})`, url: "/", tag: "trade-open" });
          summary.push({ user: cfg.user_id, signal: sig.id, status: "executed", order: br.orderId, src: dataSrc });
        } catch (e) {
          await log("error", (e as Error).message, null, null);
          summary.push({ user: cfg.user_id, signal: sig.id, status: "error" });
        }
      }
    }

    // TRAILING I SHPEJTË: brenda kësaj minute, ndjek SL-në disa herë (~çdo 13s) që të reagojë
    // sa më shpejt që lejon sistemi (kufiri i cron-it është 1 min). SL ndjek % e fitimit live.
    // Vetëm përdoruesit pa broker-trailing (ata me broker-trailing i ndjek MetaApi vetë, tick-by-tick).
    const trailCfgs = (configs ?? []).map((r) => r as Cfg).filter((c) => c.account_id && c.token && c.trail_enabled !== false && c.broker_trailing !== true);
    if (trailCfgs.length > 0) {
      // ~8 kontrolle brenda minutës (çdo ~7s) → SL ndjek lëvizjen pothuajse në kohë reale.
      // (Më shpejt do rrezikonte limitet e MetaApi/brokerit.) Ndalon ~52s për të mos kaluar minutën.
      const deadline = Date.now() + 52_000;
      for (let i = 0; i < 8 && Date.now() < deadline; i++) {
        await new Promise((r) => setTimeout(r, 7000));
        for (const c of trailCfgs) {
          try { const m = await trailPositions(c); if (m > 0) summary.push({ user: c.user_id, fast_trail: m, pass: i + 1 }); } catch { /* */ }
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
