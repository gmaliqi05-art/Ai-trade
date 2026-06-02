import { describe, expect, it } from 'vitest';
import { analyzeAsset } from './analyze';
import { syntheticCandles } from './market/candles';

describe('syntheticCandles', () => {
  it('jep numrin e kërkuar dhe përfundon te çmimi aktual', () => {
    const candles = syntheticCandles('XAUUSD', 2000, '1h', 260);
    expect(candles).toHaveLength(260);
    expect(candles[259].close).toBeCloseTo(2000);
  });

  it('është i riprodhueshëm për të njëjtin simbol', () => {
    const a = syntheticCandles('BTCUSD', 50000, '1h', 100);
    const b = syntheticCandles('BTCUSD', 50000, '1h', 100);
    expect(a[50].close).toBe(b[50].close);
  });
});

describe('analyzeAsset (demo, pa rrjet)', () => {
  it('prodhon analizë afatshkurtër + afatgjatë për një mall', async () => {
    const res = await analyzeAsset({ symbol: 'XAUUSD', category: 'commodity', currentPrice: 2000 });
    expect(res.source).toBe('demo');
    expect(res.short).not.toBeNull();
    expect(res.long).not.toBeNull();
    expect(['BUY', 'SELL', 'HOLD']).toContain(res.short!.signal.action);
    // Plani: për veprim aktiv, stop-i ekziston; për HOLD është NaN.
    if (res.short!.signal.action !== 'HOLD') {
      expect(Number.isFinite(res.short!.plan.stopLoss)).toBe(true);
    }
  });
});
