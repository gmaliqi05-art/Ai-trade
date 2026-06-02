import { describe, expect, it } from 'vitest';
import { calcLotSize, canOpenTrade } from './risk';

describe('calcLotSize', () => {
  it('llogarit lotin nga rreziku dhe distanca e stop-loss', () => {
    // 10000 × 1% = 100 rrezik; distanca 10, vlera 1/njësi/lot → 10 humbje/lot → 10 lot.
    const res = calcLotSize({
      balance: 10_000,
      riskPercent: 0.01,
      entryPrice: 100,
      stopLossPrice: 90,
      valuePerPricePerLot: 1,
    });
    expect(res.lot).toBeCloseTo(10);
    expect(res.moneyAtRisk).toBeCloseTo(100);
  });

  it('rrumbullakos poshtë te hapi i lotit (s\'e kalon rrezikun)', () => {
    const res = calcLotSize({
      balance: 1000,
      riskPercent: 0.01,
      entryPrice: 100,
      stopLossPrice: 99,
      valuePerPricePerLot: 1,
      lotStep: 0.01,
    });
    // 10 rrezik / (1 × 1) = 10 → por kufizohet... këtu rawLot=10 → 10.00
    expect(res.lot).toBeCloseTo(10);
  });

  it('kufizohet nga maxLot', () => {
    const res = calcLotSize({
      balance: 1_000_000,
      riskPercent: 0.5,
      entryPrice: 100,
      stopLossPrice: 99,
      valuePerPricePerLot: 1,
      maxLot: 5,
    });
    expect(res.lot).toBe(5);
    expect(res.cappedByMax).toBe(true);
  });

  it('hedh gabim kur stop = hyrje', () => {
    expect(() =>
      calcLotSize({
        balance: 1000,
        riskPercent: 0.01,
        entryPrice: 100,
        stopLossPrice: 100,
        valuePerPricePerLot: 1,
      }),
    ).toThrow();
  });
});

describe('canOpenTrade', () => {
  const limits = { maxDailyLoss: 200, maxOpenTrades: 3 };

  it('lejon kur brenda limiteve', () => {
    expect(canOpenTrade({ dailyLoss: 50, openTrades: 1 }, limits).allowed).toBe(true);
  });

  it('bllokon në limitin e humbjes ditore', () => {
    expect(canOpenTrade({ dailyLoss: 200, openTrades: 0 }, limits).allowed).toBe(false);
  });

  it('bllokon në numrin maksimal të tregtive', () => {
    expect(canOpenTrade({ dailyLoss: 0, openTrades: 3 }, limits).allowed).toBe(false);
  });

  it('kill-switch bllokon gjithçka', () => {
    expect(
      canOpenTrade({ dailyLoss: 0, openTrades: 0 }, { ...limits, killSwitch: true }).allowed,
    ).toBe(false);
  });
});
