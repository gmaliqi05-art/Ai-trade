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
  // Kosto: rri jashtë vetëm kur spread-i ha thuajse gjithë lëvizjen e fundit (relativ),
  // OSE kur spread-i kalon një tavan absolut (anti-blowout: mos fillo thellë nën ujë në
  // tregje volatile ku 0.9*unit lejon spread shumë të gjerë). Default 0.30, env FASTT_MAX_SPREAD.
  const maxSpread = (_p && _p.maxSpread > 0) ? _p.maxSpread : 0.30;
  if (spread > 0 && (spread > 0.9 * unit || spread > maxSpread)) return null;

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
  // (4) HYRJE NË FILLIM TË LËVIZJES (jo në fund): hy sapo impulsi po e SULMON majën/fundin e
  //     qiriut të fundit të mbyllur — pa pritur thyerjen e plotë të 2 qirinjve (që është vonë, në
  //     fund të lëvizjes). `tol` i gjerë (0.20*unit) => hyn ndërsa çmimi ende ~0.20*unit nën nivel,
  //     i mbështetur nga shpejtësia+përshpejtimi+efikasiteti që sapo u verifikuan (impulsi i vërtetë).
  const m = candles?.length || 0;
  if (m >= 2) {
    const tol = ((_p && _p.entryTol > 0) ? _p.entryTol : 0.20) * unit;
    const hi = candles[m - 2].high;   // vetëm qiriri i fundit i mbyllur => kap fillimin, jo ekstensionin
    const lo = candles[m - 2].low;
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
  const autoTake = (p && p.autoTake > 0) ? p.autoTake : 1.70;  // fitim që merret automatikisht (€≈pikë)

  // shpejtësia e fundit (kundër nesh nëse < 0) — për të dalluar "shkon mbrapsht" nga "u ndal"
  const velOver = (ms) => { const o = priceAt(ticks, ms); return isBuy ? (price - o) : (o - price); };

  // (0) SL i fortë — rrjet i fundit (katastrofë).
  if (moved <= -hardStop) return `ndalim i fortë (${moved.toFixed(2)})`;

  // (0b) NDALIM NË VEND: sapo shkon mbrapsht përtej stop-it, prite MENJËHERË — pa pritur 4-8s.
  //      (Të dhënat: ageGate-i e linte humbjen të thellohej -0.21 -> -0.365.) Vetëm një min-age i
  //      vogël shmang tick-un e hyrjes/spread-it, dhe kërkojmë që shpejtësia të jetë ende kundër nesh
  //      (nëse po rikuperon fort e mbajmë edhe një tick).
  const minAge = 700;
  const adaptStop = -(cost + 0.08);
  if (moved <= adaptStop && ageMs >= minAge && velOver(600) <= 0)
    return `ndalim në vend (${moved.toFixed(2)})`;

  // (a) MBRO/BLLOKO FITIMIN te MAJA REALE — PRIORITET (çek PARA degës 10s-window që jepte 66% mbrapsht).
  //     Sa më e madhe maja, aq më i ngushtë lock-u. Vel-flip event-driven <750ms = kthesë e shpejtë =>
  //     mbyll në vend te maja. Mbi `autoTake` (1.7): bllokim shumë i ngushtë, POR vazhdon ndjekjen lart.
  if (peak >= cost + 0.08) {
    let giveK = Math.min(0.20, Math.max(0.06, 0.12 * peak));
    let floor = Math.max(cost + 0.02, peak - giveK);
    if (peak >= cost + 0.15) floor = Math.max(floor, peak - 0.10);   // RATCHET më herët: s'jep > 0.10
    if (peak >= autoTake)    floor = Math.max(floor, peak - 0.12);   // >1.7: banko fitimin, ndiq lart
    const v2 = velOver(750);                                         // kthesë brenda <750ms (event-driven)
    const flip = peak >= cost + 0.10 && v2 < -Math.max(0.03, 0.12 * unit);
    if (moved <= floor || flip)
      return `fitim i mbrojtur (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
  }

  // (b) KTHESË TICK-U (rrjet dytësor): tërheqje nga maja 10s + shpejtësi kundër — kap prerjen e humbësit.
  if (ticks && ticks.length >= 3) {
    const cur = ticks[ticks.length - 1].p;
    const favExtreme = isBuy ? Math.max(...ticks.map((t) => t.p)) : Math.min(...ticks.map((t) => t.p));
    const retrace = isBuy ? (favExtreme - cur) : (cur - favExtreme);
    const vel = velOver(3000);
    const swingBack = (peak >= cost + 0.15) ? Math.max(0.06, 0.18 * unit) : Math.max(0.08, 0.30 * unit);
    const noise = Math.max(0.04, 0.15 * unit);
    if (retrace >= swingBack && vel < -noise) {
      if (peak >= cost + 0.08 && moved > cost) return `kthesë tick — fitim i kapur (+${moved.toFixed(2)}, maja +${peak.toFixed(2)})`;
      if (moved <= -(cost + Math.max(0.06, 0.15 * unit)) && ageMs >= minAge) return `kthesë tick kundër — prerje (${moved.toFixed(2)})`;
    }
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
