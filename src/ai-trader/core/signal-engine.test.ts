import { describe, expect, it } from 'vitest';
import { generateSignal, minCandles } from './signal-engine';
import type { Candle } from './types';

function buildCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60_000,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

describe('generateSignal', () => {
  it('kërkon mjaftueshëm qirinj', () => {
    const few = buildCandles(new Array(10).fill(100));
    expect(() => generateSignal(few, 'long')).toThrow();
  });

  it('jep bias rritës (score > 0) në një trend rritës', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 1.5);
    const sig = generateSignal(buildCandles(closes), 'long');
    expect(sig.score).toBeGreaterThan(0);
    expect(sig.confidence).toBeGreaterThanOrEqual(0);
    expect(sig.confidence).toBeLessThanOrEqual(1);
    expect(['BUY', 'SELL', 'HOLD']).toContain(sig.action);
  });

  it('jep bias rënës (score < 0) në një trend rënës', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 250 - i * 0.5 + Math.sin(i) * 1.5);
    const sig = generateSignal(buildCandles(closes), 'long');
    expect(sig.score).toBeLessThan(0);
  });

  it('mbush snapshot-in e indikatorëve', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.3);
    const sig = generateSignal(buildCandles(closes), 'short');
    expect(sig.indicators.price).toBeCloseTo(closes[closes.length - 1]);
    expect(Number.isNaN(sig.indicators.rsi)).toBe(false);
    expect(sig.reasons.length).toBeGreaterThan(0);
  });
});

describe('minCandles', () => {
  it('horizonti afatgjatë kërkon më shumë se afatshkurtri', () => {
    expect(minCandles('long')).toBeGreaterThan(minCandles('short'));
  });
});
