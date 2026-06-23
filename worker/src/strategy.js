// ─────────────────────────────────────────────────────────────────────────────
// Truri i FastT — TICK-DRIVEN REAL-TIME (i njëjti koncept si edge function-i, por në
// streaming 250ms). Drejtimi vjen nga TICK-u LIVE, jo nga EMA-ja e vonuar.
//
//  • HYRJE (tickStart): regjim trendi (ADX + ndarje EMA, anti-chop) + drejtim nga tick-u
//    live me shpejtësi + përshpejtim + efikasitet net/path (anti-chop) + freski + thyerje
//    mikro-strukture. Kap FILLIMIN e lëvizjes, jo majën; s'hyn kundër lëvizjes.
//  • DALJE (reversalExit + rezervat): del në çastin që çmimi tenton kthesën (retrace +
//    shpejtësia kthehet), kap fitimin te ndalesa, pret humbjen shpejt, lë fituesit të vrapojnë.
//  • SL "katastrofe" i gjerë te brokeri si rrjetë sigurie.
// ─────────────────────────────────────────────────────────────────────────────
import { ema, atrLast, adxLast } from './indicators.js';

/** Drejtimi i mikro-trendit 1m: EMA9 vs EMA21 + pjerrësia e EMA9. */
export function analyzeTrend(candles) {
  const closes = candles.map((c) => c.close);
  if (closes.length < 25) return { dir: 'flat', e9: NaN, e21: NaN, slope: 0, atr: NaN };
  const e9arr = ema(closes, 9);
  const e21arr = ema(closes, 21);
  const i = closes.length - 1;
  const e9 = e9arr[i];
  const e21 = e21arr[i];
  const slope = e9 - e9arr[i - 3];
  const atr = atrLast(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  let dir = 'flat';
  if (e9 > e21 && slope > 0) dir = 'up';
  else if (e9 < e21 && slope < 0) dir = 'down';
  return { dir, e9, e21, slope, atr };
}

/** Filtri i REGJIMIT: trend real (ADX≥18 + ndarje EMA9/EMA21), JO treg anësor/chop. */
export function regimeOk(candles) {
  const { dir, e9, e21, atr } = analyzeTrend(candles);
  if (dir === 'flat' || !Number.isFinite(e9)) return false;
  const atrv = Number.isFinite(atr) && atr > 0 ? atr : 0.3;
  const adxv = adxLast(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14);
  if (!Number.isFinite(adxv) || adxv < 23) return false;                       // ADX i ulët = chop (23: vetëm trend real)
  if (!Number.isFinite(e21) || Math.abs(e9 - e21) < 0.18 * atrv) return false; // EMA të ngjitura = flat
  return true;
}

/** DREJTIM REAL-TIME nga tick-u LIVE — kthen 'BUY'/'SELL' vetëm kur lëvizja po FILLON vërtet TANI. */
export function tickStart(ticks, atrv, candles) {
  const n = ticks.length;
  if (n < 5 || !(atrv > 0)) return null;
  const now = ticks[n - 1];
  const priceAt = (ageMs) => {
    const target = now.t - ageMs;
    let pick = ticks[0];
    for (const x of ticks) { if (x.t >= target) { pick = x; break; } }
    return pick.p;
  };
  const pNow = now.p, p2 = priceAt(2200), p4 = priceAt(4400), p6 = priceAt(6600);
  const pushNow = pNow - p2, pushPrev = p2 - p4;
  const dir = pushNow > 0 ? 1 : pushNow < 0 ? -1 : 0;
  if (dir === 0) return null;
  // (1) SHPEJTËSIA: push-i i ~2s të fundit duhet të kalojë dyshemenë e zhurmës.
  if (Math.abs(pushNow) < Math.max(0.06, 0.18 * atrv)) return null;
  // (1b) PËRSHPEJTIM: lëvizja po shpejtohet (ose po thyhet nga qetësia) — jo push që po shuhet.
  const accelerating = (Math.sign(pushPrev) !== dir) || (Math.abs(pushNow) >= 1.15 * Math.abs(pushPrev));
  if (!accelerating) return null;
  // (2) ANTI-CHOP: efikasiteti net/path i ~6s të fundit (1 = vijë e drejtë, ~0 = lëkundje).
  let path = 0, prev = null;
  for (const x of ticks) { if (x.t >= now.t - 6600) { if (prev) path += Math.abs(x.p - prev.p); prev = x; } }
  const net = Math.abs(pNow - p6);
  if (path <= 0 || net / path < 0.62) return null;
  // (3) FRESKI: lëvizja sapo nisi (jo e shtrirë mbi 1.6·ATR) + impulsi i përqendruar te ~2s e fundit.
  if (net > 1.6 * atrv) return null;
  if (Math.abs(pushNow) < 0.5 * net) return null;
  // (4) KONFIRMIM MIKRO-STRUKTURE: çmimi thyen majën/fundin e 2 qirinjve të mbyllur në atë drejtim.
  const m = candles.length;
  if (m < 3) return null;
  const microHigh = Math.max(candles[m - 2].high, candles[m - 3].high);
  const microLow = Math.min(candles[m - 2].low, candles[m - 3].low);
  const tol = 0.05 * atrv;
  if (dir > 0 && pNow < microHigh - tol) return null;
  if (dir < 0 && pNow > microLow + tol) return null;
  return dir > 0 ? 'BUY' : 'SELL';
}

/**
 * Vendim HYRJEJE. `candles` = qirinjtë 1m (+ qiriri live). `ticks` = histori tick ~ 15-20s.
 * Kthen { action, reason } ose null.
 */
export function entryDecision({ candles, ticks, spread = 0 }, _p) {
  if (!regimeOk(candles)) return null;
  const { atr } = analyzeTrend(candles);
  const atrv = Number.isFinite(atr) && atr > 0 ? atr : 0.3;
  // FILTËR KOSTOJE (i butë për fazën e të dhënave): bllokon vetëm kur spread-i është absurd
  // kundrejt lëvizjes tipike 1m. Pragu i saktë do rikalibrohet nga spread-et REALE që logohen më poshtë.
  if (spread > 0 && spread > 1.2 * atrv) return null;
  const dir = tickStart(ticks, atrv, candles);
  if (!dir) return null;
  return { action: dir, reason: `tick-start ${dir} (fresh + efikasitet + mikro-thyerje, spread ${spread.toFixed(2)})` };
}

/** DALJE REAL-TIME në kthesë (tick): del në çastin që çmimi tenton kahjen e kundërt. */
export function reversalExit(ticks, isBuy, moved, peak, atrv, ageMs, cost = 0) {
  if (ticks.length < 3) return null;
  const noise = Math.max(0.04, 0.10 * atrv);
  const swingBack = Math.max(0.10, 0.22 * atrv);
  const cur = ticks[ticks.length - 1].p;
  const favExtreme = isBuy ? Math.max(...ticks.map((t) => t.p)) : Math.min(...ticks.map((t) => t.p));
  const retrace = isBuy ? (favExtreme - cur) : (cur - favExtreme);
  const tgt = ticks[ticks.length - 1].t - 4000;
  let older = ticks[0];
  for (const x of ticks) { if (x.t >= tgt) { older = x; break; } }
  const vel = isBuy ? (cur - older.p) : (older.p - cur);
  if (!(retrace >= swingBack && vel < -noise)) return null;
  // Kap fitimin VETËM kur maja ka kaluar koston (përndryshe "fitimi" është iluzion nga mid-i).
  if (peak >= Math.max(0.35, cost + 0.20) && moved > cost) {
    return `kthesë live — fitim i kapur te ndalesa (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
  }
  // Prerje e hershme VETËM te lëvizje vërtet kundër nesh (përtej spread-it), jo te vetë spread-i.
  if (moved <= -(cost + Math.max(0.08, 0.12 * atrv))) {
    if (ageMs < 12000) return null; // hapësirë ~12s pas hapjes — mos u tremb nga zhurma fillestare
    return `kthesë live kundër nesh — prerje e hershme (${moved.toFixed(2)})`;
  }
  return null;
}

/**
 * Vendim DALJEJE i plotë: parashutë → dalje real-time → qirinj/floor/EMA/ngecje (rezervë).
 * `ticks` = histori tick e kufizuar te ~10s (vendoset nga thirrësi). `ageMs` = mosha e pozicionit.
 */
export function exitDecision({ candles, price, ticks, position, peak, ageMs, spread = 0 }, p) {
  const isBuy = String(position.type).includes('BUY');
  const entry = Number(position.openPrice);
  // `price` është çmimi REAL i daljes (bid për BUY, ask për SELL) — thirrësi e jep ashtu.
  const moved = isBuy ? price - entry : entry - price;
  const { e9, atr } = analyzeTrend(candles);
  const atrv = Number.isFinite(atr) && atr > 0 ? atr : 0.3;
  const cost = Math.max(0, spread);                         // kostoja që duhet kaluar para fitimit real
  const hardStop = Math.max(0.5, Math.min(p.catastrophe ?? 1.5, 0.7));

  // (0) Parashutë e fortë — asnjëherë humbje e madhe.
  if (moved <= -hardStop) return `ndalim i fortë (${moved.toFixed(2)})`;
  // (a) DALJE REAL-TIME në kthesë (tick) — e para, më e shpejtë se qiriri 1m.
  const rev = reversalExit(ticks, isBuy, moved, peak, atrv, ageMs, cost);
  if (rev) return rev;
  // (R) KTHESË QIRINJSH në fitim (vetëm pasi fitimi real ka kaluar koston).
  if (moved > Math.max(0.10, cost) && candles.length >= 2) {
    const lo = Math.min(candles[candles.length - 1].low, candles[candles.length - 2].low);
    const hi = Math.max(candles[candles.length - 1].high, candles[candles.length - 2].high);
    if (isBuy && price < lo) return `kthesë qirinjsh — fitim i marrë (+${moved.toFixed(2)})`;
    if (!isBuy && price > hi) return `kthesë qirinjsh — fitim i marrë (+${moved.toFixed(2)})`;
  }
  // (P) MBRO FITIMIN — jep pas ~22% të majës (lë fituesit të vrapojnë).
  if (peak >= 0.25) {
    const floor = Math.max(0.03, peak - Math.max(0.20, 0.22 * peak));
    if (moved <= floor) return `fitim i mbrojtur (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
  }
  // (1) EMA9 — prerje për humbësit / prishje e plotë trendi.
  const buffer = Math.max(0.05, 0.15 * atrv);
  if (Number.isFinite(e9)) {
    const onRight = isBuy ? price > e9 - buffer : price < e9 + buffer;
    if (!onRight) return `kthesë reale: ${isBuy ? 'çmimi nën EMA9' : 'çmimi mbi EMA9'} (${moved.toFixed(2)})`;
  }
  // (S) NGECJE — nëse rri > 4 min pa u bërë fitues i fortë, liro vendin.
  if (Number.isFinite(ageMs) && ageMs > 240000 && peak < 1.0) return `scalp ngeci — mbyll (${moved.toFixed(2)})`;
  return null; // MBAJE
}
