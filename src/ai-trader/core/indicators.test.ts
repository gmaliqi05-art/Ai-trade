import { describe, expect, it } from 'vitest';
import { atr, bollinger, ema, macd, rsi, sma } from './indicators';

describe('sma', () => {
  it('llogarit mesataren e thjeshtë me warmup NaN', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });
});

describe('ema', () => {
  it('mbillet me SMA dhe zbutet eksponencialisht', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });

  it('kthen NaN kur s\'ka mjaftueshëm të dhëna', () => {
    expect(ema([1, 2], 3).every(Number.isNaN)).toBe(true);
  });
});

describe('rsi', () => {
  it('jep 100 për seri vetëm-rritëse', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = rsi(values, 14);
    expect(out[19]).toBe(100);
  });

  it('mban vlerat brenda 0..100', () => {
    const values = [44, 44.3, 44.1, 44.6, 43.9, 44.5, 45.1, 45.4, 45, 45.6, 46.3, 46.2, 46.8, 46.4, 46.2, 45.6, 46.2, 46.2];
    const out = rsi(values, 14);
    const last = out[out.length - 1];
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(100);
  });
});

describe('macd', () => {
  it('ruan gjatësinë e hyrjes dhe jep histogramë pozitiv në rritje', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const res = macd(values);
    expect(res.macd).toHaveLength(60);
    expect(res.signal).toHaveLength(60);
    // Në një seri rritëse, EMA e shpejtë qëndron mbi atë të ngadaltë → MACD > 0.
    expect(res.macd[59]).toBeGreaterThan(0);
  });
});

describe('bollinger', () => {
  it('upper >= middle >= lower dhe kolapson kur s\'ka paqëndrueshmëri', () => {
    const flat = new Array(25).fill(5);
    const res = bollinger(flat, 20, 2);
    const i = 24;
    expect(res.upper[i]).toBeCloseTo(5);
    expect(res.middle[i]).toBeCloseTo(5);
    expect(res.lower[i]).toBeCloseTo(5);
  });
});

describe('atr', () => {
  it('jep vlerë pozitive', () => {
    const highs = Array.from({ length: 30 }, (_, i) => 10 + i + 1);
    const lows = Array.from({ length: 30 }, (_, i) => 10 + i - 1);
    const closes = Array.from({ length: 30 }, (_, i) => 10 + i);
    const out = atr(highs, lows, closes, 14);
    expect(out[29]).toBeGreaterThan(0);
  });
});
