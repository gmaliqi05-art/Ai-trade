// Plani i tregtisë: nga një sinjal + ATR ndërton hyrje / stop-loss / objektiv.
// Stop-i bazohet te paqëndrueshmëria (ATR), që distanca të jetë realiste për tregun.

import type { Signal } from './types';

export interface TradePlan {
  /** Çmimi i hyrjes (çmimi aktual). */
  entry: number;
  /** Stop-loss (mbrojtja). NaN nëse sinjali është HOLD. */
  stopLoss: number;
  /** Objektivi i parë (take-profit). NaN nëse sinjali është HOLD. */
  takeProfit: number;
  /** Raporti shpërblim/rrezik (p.sh. 2 = 1:2). */
  riskReward: number;
  /** Distanca e stop-it në njësi çmimi. */
  stopDistance: number;
}

export interface TradePlanOptions {
  /** Sa ATR larg vendoset stop-i (default 1.5). */
  atrMultiplier?: number;
  /** Raporti objektiv:rrezik (default 2 → 1:2). */
  riskRewardRatio?: number;
  /** Fallback nëse ATR s'është i vlefshëm: % e çmimit (default 1.5%). */
  fallbackPercent?: number;
  /** Distancë FIKSE e SL në njësi çmimi ($), nga cilësimet. Nëse >0, mbivendos ATR-në. */
  fixedStopDistance?: number;
  /** Distancë FIKSE e TP në njësi çmimi ($), nga cilësimet. Nëse >0, mbivendos RR-në. */
  fixedTakeProfitDistance?: number;
}

/**
 * Ndërton një plan tregtie nga sinjali. Për BUY stop-i është poshtë hyrjes dhe
 * objektivi lart; për SELL e kundërta. Për HOLD kthen NaN te nivelet.
 */
export function buildTradePlan(signal: Signal, options: TradePlanOptions = {}): TradePlan {
  const { atrMultiplier = 1.5, riskRewardRatio = 2, fallbackPercent = 0.015, fixedStopDistance, fixedTakeProfitDistance } = options;
  const entry = signal.indicators.price;

  if (signal.action === 'HOLD') {
    return { entry, stopLoss: NaN, takeProfit: NaN, riskReward: riskRewardRatio, stopDistance: NaN };
  }

  const atr = signal.indicators.atr;
  // SL: distancë fikse nga cilësimet (p.sh. scalp $), përndryshe ATR × shumëzues (ose fallback %).
  const stopDistance =
    Number.isFinite(fixedStopDistance) && (fixedStopDistance as number) > 0
      ? (fixedStopDistance as number)
      : Number.isFinite(atr) && atr > 0 ? atr * atrMultiplier : entry * fallbackPercent;
  // TP: distancë fikse nga cilësimet, përndryshe SL × raporti shpërblim/rrezik.
  const targetDistance =
    Number.isFinite(fixedTakeProfitDistance) && (fixedTakeProfitDistance as number) > 0
      ? (fixedTakeProfitDistance as number)
      : stopDistance * riskRewardRatio;

  const isBuy = signal.action === 'BUY';
  const stopLoss = isBuy ? entry - stopDistance : entry + stopDistance;
  const takeProfit = isBuy ? entry + targetDistance : entry - targetDistance;

  return {
    entry,
    stopLoss: Math.max(0, stopLoss),
    takeProfit: Math.max(0, takeProfit),
    // Raporti real (mund të mos jetë saktësisht riskRewardRatio kur përdoren distanca fikse).
    riskReward: stopDistance > 0 ? Math.round((targetDistance / stopDistance) * 10) / 10 : riskRewardRatio,
    stopDistance,
  };
}
