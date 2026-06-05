// Motori i sinjaleve: kombinon indikatorët në një vendim BLEJ / SHIT / PRIT.
// Logjika është e ndarë nga UI dhe burimet e të dhënave, që të jetë e testueshme.

import { atr, bollinger, ema, macd, rsi } from './indicators';
import type { Candle, Horizon, IndicatorSnapshot, Signal } from './types';
import { tr } from '../../i18n/tr';

interface Profile {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
}

// Afatshkurtër = reagim i shpejtë; afatgjatë = trend më i qëndrueshëm.
const PROFILES: Record<Horizon, Profile> = {
  short: { emaFast: 9, emaSlow: 21, rsiPeriod: 14 },
  long: { emaFast: 50, emaSlow: 200, rsiPeriod: 14 },
};

/** Numri minimal i qirinjve i nevojshëm për një profil. */
export function minCandles(horizon: Horizon): number {
  const p = PROFILES[horizon];
  // +5 si marzh sigurie mbi periudhën më të madhe.
  return Math.max(p.emaSlow, 26 + 9, 20) + 5;
}

interface Rule {
  weight: number;
  passed: boolean;
  reason: string;
}

/** Prodhon një sinjal nga qirinjtë për horizontin e dhënë. */
export function generateSignal(candles: Candle[], horizon: Horizon): Signal {
  const profile = PROFILES[horizon];
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  if (candles.length < minCandles(horizon)) {
    throw new Error(
      `Nevojiten të paktën ${minCandles(horizon)} qirinj për horizontin "${horizon}", u dhanë ${candles.length}.`,
    );
  }

  const emaFastArr = ema(closes, profile.emaFast);
  const emaSlowArr = ema(closes, profile.emaSlow);
  const rsiArr = rsi(closes, profile.rsiPeriod);
  const macdRes = macd(closes);
  const bb = bollinger(closes);
  const atrArr = atr(highs, lows, closes);

  const i = candles.length - 1;
  const snap: IndicatorSnapshot = {
    emaFast: emaFastArr[i],
    emaSlow: emaSlowArr[i],
    rsi: rsiArr[i],
    macd: macdRes.macd[i],
    macdSignal: macdRes.signal[i],
    macdHist: macdRes.histogram[i],
    bbUpper: bb.upper[i],
    bbMiddle: bb.middle[i],
    bbLower: bb.lower[i],
    atr: atrArr[i],
    price: closes[i],
  };

  const rules: Rule[] = [];

  // --- Sinjale TREND-NDJEKËSE (parësore, peshë e lartë) ---

  // 1) Kryqëzimi i trendit (EMA e shpejtë vs e ngadaltë).
  if (!Number.isNaN(snap.emaFast) && !Number.isNaN(snap.emaSlow)) {
    const bullish = snap.emaFast > snap.emaSlow;
    rules.push({
      weight: 2.5,
      passed: bullish,
      reason: bullish
        ? tr('EMA{fast} mbi EMA{slow} (trend rritës)', { fast: profile.emaFast, slow: profile.emaSlow })
        : tr('EMA{fast} nën EMA{slow} (trend rënës)', { fast: profile.emaFast, slow: profile.emaSlow }),
    });
  }

  // 2) MACD mbi/nën linjën e sinjalit.
  if (!Number.isNaN(snap.macdHist)) {
    const bullish = snap.macdHist > 0;
    rules.push({
      weight: 1.5,
      passed: bullish,
      reason: bullish ? tr('MACD mbi sinjal (momentum pozitiv)') : tr('MACD nën sinjal (momentum negativ)'),
    });
  }

  // 3) Çmimi mbi/nën EMA-në e ngadaltë (konfirmim trendi).
  if (!Number.isNaN(snap.emaSlow)) {
    const bullish = snap.price > snap.emaSlow;
    rules.push({
      weight: 1,
      passed: bullish,
      reason: bullish ? tr('Çmimi mbi EMA-në e ngadaltë') : tr('Çmimi nën EMA-në e ngadaltë'),
    });
  }

  // --- Sinjale MEAN-REVERSION (dytësore, kujdes — peshë e ulët) ---

  // 4) RSI: ekstremet janë paralajmërim kthimi; pjesa tjetër pjerrtësi e butë.
  if (!Number.isNaN(snap.rsi)) {
    if (snap.rsi < 30) {
      rules.push({ weight: 1, passed: true, reason: tr('RSI {v} (i mbishitur — kthim i mundshëm lart)', { v: snap.rsi.toFixed(1) }) });
    } else if (snap.rsi > 70) {
      rules.push({ weight: 1, passed: false, reason: tr('RSI {v} (i mbiblerë — kujdes nga kthimi)', { v: snap.rsi.toFixed(1) }) });
    } else {
      const lean = snap.rsi >= 50;
      rules.push({ weight: 0.5, passed: lean, reason: tr('RSI {v} ({lean})', { v: snap.rsi.toFixed(1), lean: lean ? tr('pjerrtësi lart') : tr('pjerrtësi poshtë') }) });
    }
  }

  // 5) Dalja jashtë brezave të Bollinger-it (kujdes nga teprimi).
  if (!Number.isNaN(snap.bbLower) && !Number.isNaN(snap.bbUpper)) {
    if (snap.price < snap.bbLower) {
      rules.push({ weight: 0.75, passed: true, reason: tr('Çmimi poshtë brezit të poshtëm (kthim i mundshëm lart)') });
    } else if (snap.price > snap.bbUpper) {
      rules.push({ weight: 0.75, passed: false, reason: tr('Çmimi mbi brezit të sipërm (kthim i mundshëm poshtë)') });
    }
  }

  const score = rules.reduce((s, r) => s + (r.passed ? r.weight : -r.weight), 0);
  const maxScore = rules.reduce((s, r) => s + r.weight, 0) || 1;
  const confidence = Math.min(1, Math.abs(score) / maxScore);

  // Prag: shmang sinjalet e dobëta (confidence i ulët → PRIT).
  let action: Signal['action'] = 'HOLD';
  if (confidence >= 0.25) action = score > 0 ? 'BUY' : 'SELL';

  return {
    action,
    confidence,
    score,
    horizon,
    reasons: rules.map((r) => r.reason),
    indicators: snap,
  };
}
