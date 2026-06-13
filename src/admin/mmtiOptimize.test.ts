import { describe, it, expect } from 'vitest';
import { optimizeFromIntel, type TradeIntelLite, type TIGroup } from './mmtiOptimize';

// Ndihmës: ndërto një grup statistikash me n/win-rate/expectancy të dhënë.
function grp(label: string, n: number, winRate: number, expectancy: number): TIGroup {
  const wins = Math.round((n * winRate) / 100);
  return { label, n, wins, losses: n - wins, winRate, net: expectancy * n, avgWin: 2, avgLoss: -1, expectancy, profitFactor: 1 };
}

function intel(part: Partial<TradeIntelLite>): TradeIntelLite {
  return {
    total: 120,
    overall: { n: 120, wins: 54, losses: 66, winRate: 45, net: 5, avgWin: 4, avgLoss: -2, expectancy: 0.04, profitFactor: 1.1 },
    bySession: [],
    byStrategy: [],
    bySymbol: [],
    ...part,
  };
}

describe('mmtiOptimize — MMTI është për arin', () => {
  it('nuk rekomandon BTC edhe kur BTC ka expectancy më të lartë se ari', () => {
    const p = optimizeFromIntel(intel({ bySymbol: [grp('BTCUSD', 13, 30, 1.5), grp('XAUUSD', 20, 50, 0.5)] }));
    expect(p.bestSymbol?.label).toBe('XAUUSD');
  });

  it('lë bestSymbol = null kur ka vetëm crypto/naftë (kurrë s\'kalon te BTC)', () => {
    const p = optimizeFromIntel(intel({ bySymbol: [grp('BTCUSD', 13, 30, 1.5), grp('USOIL', 11, 40, 0.9)] }));
    expect(p.bestSymbol).toBeNull();
  });

  it('nuk rekomandon një simbol ari që humb para (expectancy ≤ 0)', () => {
    const p = optimizeFromIntel(intel({ bySymbol: [grp('XAUUSD', 20, 20, -0.34)] }));
    expect(p.bestSymbol).toBeNull();
  });

  it('rekomandon arin kur ari është fitimprurës', () => {
    const p = optimizeFromIntel(intel({ bySymbol: [grp('XAU/USD', 25, 55, 0.8)] }));
    expect(p.bestSymbol?.label).toBe('XAU/USD');
  });

  it('nuk rekomandon sesion ose strategji që humb', () => {
    const p = optimizeFromIntel(intel({ bySession: [grp('Azia', 15, 20, -0.5)], byStrategy: [grp('Scalp', 30, 35, -0.1)] }));
    expect(p.bestSession).toBeNull();
    expect(p.bestStrategy).toBeNull();
  });
});
