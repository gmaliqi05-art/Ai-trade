// ─────────────────────────────────────────────────────────────────────────────
// Truri i FastT — VEPRIM ÇMIMI 100% REAL-TIME. ZERO indikatorë të jashtëm.
// PA EMA, PA ATR, PA ADX. Vendoset VETËM nga tick-at live + qirinjtë e papërpunuar.
//
//  • Volatiliteti për shkallëzim merret nga VARGU i tick-ave të fundit (~8-10s), LIVE —
//    jo nga indikatorë që pasqyrojnë 14-21 minuta të shkuara.
//  • HYRJE: kap impulsin që po FILLON tani (drejtim + shpejtësi + përshpejtim +
//    efikasitet lëvizjeje + thyerje e majës/fundit të 2 qirinjve të fundit).
//  • DALJE: kthesë tick-u, mbrojtje fitimi nga maja, thyerje qiriri, ose SL i fortë.
//
// Asnjë import nga indicators.js — gjithçka llogaritet drejtpërdrejt nga çmimi live.
// ─────────────────────────────────────────────────────────────────────────────

/** Volatilitet REAL-TIME nga tick-at: gama (max−min) e ~ms të fundit. Zëvendëson ATR-në. */
function liveVol(ticks, ms) {
  if (!ticks || ticks.length < 2) return 0;
  const now = ticks[ticks.length - 1].t;
  let hi = -Infinity, lo = Infinity, k = 0;
  for (const x of ticks) {
    if (x.t >= now - ms) { if (x.p > hi) hi = x.p; if (x.p < lo) lo = x.p; k++; }
  }
  if (k < 2 || !Number.isFinite(hi) || !Number.isFinite(lo)) return 0;
  return hi - lo;
}

/** Çmimi ~ageMs më parë nga tick-at live. */
function priceAt(ticks, ageMs) {
  const now = ticks[ticks.length - 1];
  const target = now.t - ageMs;
  let pick = ticks[0];
  for (const x of ticks) { if (x.t >= target) { pick = x; break; } }
  return pick.p;
}

/**
 * Vendim HYRJEJE — VETËM nga tick-at live + qirinjtë e papërpunuar.
 * `candles` = qirinjtë 1m (+ qiriri live). `ticks` = histori tick ~15-20s.
 * Kthen { action, reason } ose null.
 */
export function entryDecision({ candles, ticks, spread = 0 }, _p) {
  const n = ticks?.length || 0;
  if (n < 5) return null;
  const v = liveVol(ticks, 10000);               // volatilitet live nga tick-at (jo ATR)
  const unit = v > 0 ? v : 0.20;                 // dysheme e vogël për arin nëse tregu i fjetur
  // Kosto: rri jashtë vetëm kur spread-i ha thuajse gjithë lëvizjen e fundit.
  if (spread > 0 && spread > 0.9 * unit) return null;

  const now = ticks[n - 1];
  const pNow = now.p;
  const p2 = priceAt(ticks, 2200), p4 = priceAt(ticks, 4400), p6 = priceAt(ticks, 6600);
  const pushNow = pNow - p2, pushPrev = p2 - p4;
  const dir = pushNow > 0 ? 1 : pushNow < 0 ? -1 : 0;
  if (dir === 0) return null;

  // (1) SHPEJTËSIA: push-i i ~2s të fundit kalon dyshemenë e zhurmës (nga vol LIVE).
  // SHËNIM: banda vol 0.20-0.55 e v2.1 u HOQ — bllokonte hyrjet gjatë lëvizjeve volatile (ku janë
  // fituesit e mëdhenj, p.sh. +1.40 me vol 1.43). Hyrja kthehet te logjika e provuar aktive; përmirësimet
  // e DALJES (ndalim adaptiv, floor i ngushtë, vel-flip) + reagimi 100ms + logimi MAE MBETEN.
  if (Math.abs(pushNow) < Math.max(0.06, 0.35 * unit)) return null;
  // (2) PËRSHPEJTIM: lëvizja po shpejtohet, ose po thyhet nga qetësia (jo push që shuhet).
  const accel = (Math.sign(pushPrev) !== dir) || (Math.abs(pushNow) >= 1.1 * Math.abs(pushPrev));
  if (!accel) return null;
  // (3) ANTI-CHOP (pa indikator): efikasiteti net/path i ~6s të fundit afër vijës së drejtë.
  let path = 0, prev = null;
  for (const x of ticks) { if (x.t >= now.t - 6600) { if (prev) path += Math.abs(x.p - prev.p); prev = x; } }
  const net = Math.abs(pNow - p6);
  if (path <= 0 || net / path < 0.6) return null;
  // (4) THYERJE QIRIRI (i papërpunuar): çmimi thyen majën/fundin e 2 qirinjve të fundit.
  const m = candles?.length || 0;
  if (m >= 3) {
    const hi = Math.max(candles[m - 2].high, candles[m - 3].high);
    const lo = Math.min(candles[m - 2].low, candles[m - 3].low);
    const tol = 0.05 * unit;
    if (dir > 0 && pNow < hi - tol) return null;
    if (dir < 0 && pNow > lo + tol) return null;
  }
  const action = dir > 0 ? 'BUY' : 'SELL';
  return { action, reason: `live-tick ${action} (vol ${unit.toFixed(2)}, push ${pushNow.toFixed(2)}, spread ${spread.toFixed(2)})` };
}

/**
 * Vendim DALJEJE — VETËM tick-a live + qirinj të papërpunuar + SL i fortë.
 * `price` = çmimi REAL i daljes (bid për BUY, ask për SELL) — e jep thirrësi.
 * `ticks` = histori tick ~10s. `peak` = maja e favorit ($). `ageMs` = mosha e pozicionit.
 */
export function exitDecision({ candles, price, ticks, position, peak, ageMs, spread = 0 }, p) {
  const isBuy = String(position.type).includes('BUY');
  const entry = Number(position.openPrice);
  const moved = isBuy ? price - entry : entry - price;     // P&L real
  const cost = Math.max(0, spread);
  const hardStop = Math.max(0.4, Math.min(p.catastrophe ?? 0.6, 0.7));
  const v = liveVol(ticks, 8000);
  const unit = v > 0 ? v : 0.20;

  // (0) SL i fortë — rrjet i fundit (katastrofë).
  if (moved <= -hardStop) return `ndalim i fortë (${moved.toFixed(2)})`;
  // (0b) NDALIM ADAPTIV: pre humbësin normal te ~kosto+0.08 (shumë para hard-stop-it), pas një
  //      hapësire moshe (më e shkurtër kur vol i lartë). Kufizon humbjet në ~-0.20..-0.28 (ishin -0.49).
  const ageGate = unit >= 0.45 ? 4000 : 8000;
  const adaptStop = -(cost + 0.08);
  if (moved <= adaptStop && ageMs >= ageGate) return `ndalim adaptiv (${moved.toFixed(2)})`;

  // (a) KTHESË TICK-U: çmimi tërhiqet nga maja DHE shpejtësia kthehet kundër nesh.
  if (ticks && ticks.length >= 3) {
    const cur = ticks[ticks.length - 1].p;
    const favExtreme = isBuy ? Math.max(...ticks.map((t) => t.p)) : Math.min(...ticks.map((t) => t.p));
    const retrace = isBuy ? (favExtreme - cur) : (cur - favExtreme);
    const older = priceAt(ticks, 3000);
    const vel = isBuy ? (cur - older) : (older - cur);
    const swingBack = (peak >= cost + 0.15) ? Math.max(0.06, 0.18 * unit) : Math.max(0.08, 0.30 * unit);
    const noise = Math.max(0.04, 0.15 * unit);
    if (retrace >= swingBack && vel < -noise) {
      if (peak >= cost + 0.08 && moved > cost) return `kthesë tick — fitim i kapur (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
      if (moved <= -(cost + Math.max(0.06, 0.15 * unit)) && ageMs >= ageGate) return `kthesë tick kundër — prerje (${moved.toFixed(2)})`;
    }
  }

  // (b) MBRO FITIMIN: floor i ngushtë + RATCHET lock + trigger vel-flip (event-driven <750ms).
  //     Para: jepte pas 83% të majës (maja 0.36→0.07). Tani jep pas ~18% + kap kthesën para floor-it pasiv.
  if (peak >= cost + 0.08) {
    const giveK = Math.max(0.07, 0.18 * peak);
    let floor = Math.max(cost + 0.02, peak - giveK);
    if (peak >= cost + 0.20) floor = Math.max(floor, peak - 0.10);     // RATCHET: pas fitimi solid s'jep më shumë se 0.10
    const o750 = priceAt(ticks, 750);
    const v2 = isBuy ? (price - o750) : (o750 - price);                 // kthesë brenda <750ms (event-driven)
    if (moved <= floor || (peak >= cost + 0.10 && v2 < -Math.max(0.04, 0.15 * unit)))
      return `fitim i mbrojtur (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
  }

  // (c) THYERJE QIRIRI (i papërpunuar) në fitim — kthesë strukture.
  if (moved > Math.max(0.10, cost) && candles && candles.length >= 2) {
    const lo = Math.min(candles[candles.length - 1].low, candles[candles.length - 2].low);
    const hi = Math.max(candles[candles.length - 1].high, candles[candles.length - 2].high);
    if (isBuy && price < lo) return `thyerje qiriri — fitim i marrë (+${moved.toFixed(2)})`;
    if (!isBuy && price > hi) return `thyerje qiriri — fitim i marrë (+${moved.toFixed(2)})`;
  }

  // (d) NGECJE: rri gjatë pa u bërë fitues → liro vendin.
  if (Number.isFinite(ageMs) && ageMs > 180000 && peak < 0.5) return `ngeci — mbyll (${moved.toFixed(2)})`;
  return null; // MBAJE
}
