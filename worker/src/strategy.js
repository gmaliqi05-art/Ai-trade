// ─────────────────────────────────────────────────────────────────────────────
// Truri i FastT — "arsyetimi" mbi pamjen 1-minutëshe LIVE, ashtu si një njeri që
// e shikon ekranin. KONCEPT KOMPLET I PAVARUR (s'ka lidhje me motorin ekzistues).
//
// IDEJA (pikërisht si u kërkua):
//  • HYRJE: vetëm NË DREJTIM të trendit 1m, dhe vetëm pas një PULLBACK-u te EMA9
//    (jo duke ndjekur majat/fundet, jo në çdo dridhje). Kjo shmang "të nxjerr nga
//    loja qysh në hyrje".
//  • DALJE (trailing mbi STRUKTURË): NUK del për një kthim të vogël mbrapa. E mban
//    pozicionin sa kohë trendi është i paprekur (çmimi në anën e duhur të EMA9).
//    Del VETËM kur fillon kthesa reale (çmimi thyen mbrapsht EMA9 me një buffer),
//    ose kur siguron një fitim të madh pas një vrapimi.
//  • SL "katastrofe" i gjerë te brokeri mbetet vetëm si rrjetë sigurie.
// ─────────────────────────────────────────────────────────────────────────────
import { ema, atrLast } from './indicators.js';

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

/**
 * Vendim HYRJEJE. `candles` = qirinjtë 1m të mbyllur + qiriri që po formohet (live).
 * `price` = çmimi live (mid). `tickBias` > 0 = po ngjitet tani, < 0 = po bie tani.
 * Kthen { action, reason } ose null.
 */
export function entryDecision({ candles, price, tickBias }, p) {
  const { dir, e9, atr } = analyzeTrend(candles);
  if (dir === 'flat' || !Number.isFinite(e9)) return null;
  const atrv = Number.isFinite(atr) && atr > 0 ? atr : 0.3;

  // Mbrojtje nga mbi-shtrirja: mos hyr kur çmimi është shumë larg EMA9 (i ndjekur vonë).
  if (Math.abs(price - e9) > p.overExtAtr * atrv) return null;

  // A pati PULLBACK te EMA9 në qirinjtë e fundit? (blej dip-in në trend↑, shit kthimin në trend↓)
  const recent = candles.slice(-p.pullbackLookback);

  if (dir === 'up') {
    const pulledBack = recent.some((c) => c.low <= e9 + 0.05 * atrv);
    // Rifillim: çmimi është mbi EMA9 DHE po ngjitet tani (tick-at konfirmojnë).
    if (pulledBack && price > e9 && tickBias > 0) {
      return { action: 'BUY', reason: `trend 1m↑ + pullback te EMA9 + rifillim live` };
    }
  } else {
    const pulledBack = recent.some((c) => c.high >= e9 - 0.05 * atrv);
    if (pulledBack && price < e9 && tickBias < 0) {
      return { action: 'SELL', reason: `trend 1m↓ + pullback te EMA9 + rifillim live` };
    }
  }
  return null;
}

/**
 * Vendim DALJEJE (menaxhim live). Kthen një string-arsye për ta mbyllur, ose null për ta MBAJTUR.
 * `position` = { type, openPrice }. `peak` = lëvizja maksimale në favor deri tani ($).
 */
export function exitDecision({ candles, price, position, peak }, p) {
  const { e9, atr } = analyzeTrend(candles);
  const isBuy = String(position.type).includes('BUY');
  const entry = Number(position.openPrice);
  const moved = isBuy ? price - entry : entry - price;
  const atrv = Number.isFinite(atr) && atr > 0 ? atr : 0.3;
  const buffer = Math.max(0.05, p.exitBufferAtr * atrv);

  // (1) KTHESË REALE: çmimi thyen mbrapsht EMA9 me një buffer → trendi u prish, dil.
  //     Derisa çmimi rri në anën e duhur të EMA9, NUK dalim (mbajmë trendin — ç'u kërkua).
  if (Number.isFinite(e9)) {
    if (isBuy && price <= e9 - buffer) return `kthesë: çmimi ra nën EMA9 (${moved.toFixed(2)})`;
    if (!isBuy && price >= e9 + buffer) return `kthesë: çmimi mbi EMA9 (${moved.toFixed(2)})`;
  }

  // (2) SIGURO FITIMIN E MADH: pas një vrapimi (peak ≥ lockProfit), mos lejo të kthehet shumë.
  if (peak >= p.lockProfit && moved <= peak - p.giveback) {
    return `fitim i siguruar (+${moved.toFixed(2)} nga maja +${peak.toFixed(2)})`;
  }
  return null; // MBAJE
}
