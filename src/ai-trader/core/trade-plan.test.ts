import { describe, expect, it } from 'vitest';
import { buildTradePlan } from './trade-plan';
import type { Signal } from './types';

function makeSignal(action: Signal['action'], price: number, atr: number): Signal {
  return {
    action,
    confidence: 0.6,
    score: action === 'BUY' ? 3 : action === 'SELL' ? -3 : 0,
    horizon: 'short',
    reasons: [],
    indicators: {
      emaFast: price, emaSlow: price, rsi: 50, macd: 0, macdSignal: 0, macdHist: 0,
      bbUpper: price, bbMiddle: price, bbLower: price, atr, price,
    },
  };
}

describe('buildTradePlan', () => {
  it('BUY: stop poshtë hyrjes, objektiv lart', () => {
    const plan = buildTradePlan(makeSignal('BUY', 100, 2), { atrMultiplier: 1.5, riskRewardRatio: 2 });
    expect(plan.entry).toBe(100);
    expect(plan.stopLoss).toBeCloseTo(97); // 100 - 2*1.5
    expect(plan.takeProfit).toBeCloseTo(106); // 100 + 3*2
    expect(plan.riskReward).toBe(2);
  });

  it('SELL: stop lart, objektiv poshtë', () => {
    const plan = buildTradePlan(makeSignal('SELL', 100, 2), { atrMultiplier: 1.5, riskRewardRatio: 2 });
    expect(plan.stopLoss).toBeCloseTo(103);
    expect(plan.takeProfit).toBeCloseTo(94);
  });

  it('HOLD: nivelet janë NaN', () => {
    const plan = buildTradePlan(makeSignal('HOLD', 100, 2));
    expect(plan.stopLoss).toBeNaN();
    expect(plan.takeProfit).toBeNaN();
  });

  it('përdor fallback % kur ATR s\'është i vlefshëm', () => {
    const plan = buildTradePlan(makeSignal('BUY', 100, NaN), { fallbackPercent: 0.02, riskRewardRatio: 2 });
    expect(plan.stopDistance).toBeCloseTo(2); // 100 * 0.02
    expect(plan.stopLoss).toBeCloseTo(98);
  });

  it('distancat FIKSE nga cilësimet mbivendosin ATR-në', () => {
    // SL fiks 3$, TP fiks 6$ (p.sh. scalp_sl_usd / scalp_tp_usd) — pavarësisht ATR-së.
    const plan = buildTradePlan(makeSignal('BUY', 100, 2), { atrMultiplier: 1.5, fixedStopDistance: 3, fixedTakeProfitDistance: 6 });
    expect(plan.stopDistance).toBeCloseTo(3);
    expect(plan.stopLoss).toBeCloseTo(97); // 100 - 3
    expect(plan.takeProfit).toBeCloseTo(106); // 100 + 6
    expect(plan.riskReward).toBe(2); // 6/3
  });
});
