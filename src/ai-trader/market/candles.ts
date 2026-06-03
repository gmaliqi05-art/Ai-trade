// Shtresa e të dhënave të tregut: siguron qirinj (candles) për motorin e sinjaleve.
//
// FAZA 1 (demo i pari):
//  - Crypto  → qirinj REALË nga Binance (API publik, pa çelës).
//  - Të tjerët (ari/mallra, indekse/aksione, forex) → qirinj DEMO të riprodhueshëm,
//    të mbjellë nga simboli + çmimi aktual. Faza 3 do sjellë feed real për të gjitha.

import type { Candle } from '../core/types';

export type CandleSource = 'live' | 'demo';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface CandleResult {
  candles: Candle[];
  source: CandleSource;
  /** Etiketë e lexueshme për UI (p.sh. "Binance" ose "Demo (i riprodhueshëm)"). */
  provider: string;
}

export interface FetchCandlesInput {
  symbol: string;
  /** Kategoria nga DB: 'crypto' | 'commodity' | 'forex' | 'stock'. */
  category?: string;
  /** Çmimi aktual — pikënisja për qirinjtë demo. */
  currentPrice: number;
  timeframe?: Timeframe;
  /** Sa qirinj të kthehen (default 260 — mjafton për profilin afatgjatë). */
  limit?: number;
}

// Hartë simbolesh të platformës → çifte Binance.
// Ari (XAUUSD) hartëzohet te PAXGUSDT — PAX Gold është token i mbështetur me ar
// fizik (1 token ≈ 1 ons), prandaj ndjek nga afër çmimin spot të arit. Kjo na jep
// qirinj realë për arin pa pasur nevojë për një API me çelës.
const BINANCE_PAIRS: Record<string, string> = {
  BTCUSD: 'BTCUSDT', BTCUSDT: 'BTCUSDT',
  ETHUSD: 'ETHUSDT', ETHUSDT: 'ETHUSDT',
  SOLUSD: 'SOLUSDT', BNBUSD: 'BNBUSDT', XRPUSD: 'XRPUSDT',
  ADAUSD: 'ADAUSDT', DOGEUSD: 'DOGEUSDT', AVAXUSD: 'AVAXUSDT',
  MATICUSD: 'MATICUSDT', DOTUSD: 'DOTUSDT', LINKUSD: 'LINKUSDT',
  XAUUSD: 'PAXGUSDT',
};

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d',
};

/** Kohëzgjatja e një qiriu në milisekonda (për qirinjtë demo). */
const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/**
 * Kthen qirinj për një aktiv. Provon së pari burimin real (crypto via Binance);
 * nëse dështon ose s'mbulohet, bie te qirinj demo të riprodhueshëm.
 */
export async function fetchCandles(input: FetchCandlesInput): Promise<CandleResult> {
  const { symbol, currentPrice, timeframe = '1h', limit = 260 } = input;
  const pair = BINANCE_PAIRS[symbol.toUpperCase()];

  // Çdo simbol me një çift Binance të hartëzuar (crypto ose ari via PAXG) merr qirinj realë.
  if (pair) {
    try {
      const candles = await fetchBinanceCandles(pair, timeframe, limit);
      if (candles.length >= 60) {
        const provider = pair === 'PAXGUSDT' ? 'Treg live · ari (PAXG)' : 'Treg live';
        return { candles, source: 'live', provider };
      }
    } catch {
      // Bie te demo më poshtë.
    }
  }

  return {
    candles: syntheticCandles(symbol, currentPrice, timeframe, limit),
    source: 'demo',
    provider: 'Demo (i riprodhueshëm)',
  };
}

/** Merr qirinj realë nga Binance (klines publik). */
export async function fetchBinanceCandles(
  pair: string,
  timeframe: Timeframe,
  limit: number,
): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${BINANCE_INTERVAL[timeframe]}&limit=${Math.min(limit, 1000)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Binance ${resp.status}`);
  const raw = (await resp.json()) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

/**
 * Gjenerues i thjeshtë pseudo-rastësor i mbjellë (mulberry32) — i njëjti simbol jep
 * gjithmonë të njëjtën seri, që sinjalet demo të jenë të qëndrueshme mes rifreskimeve.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Ndërton një ecje rasti (random walk) realiste me trend + zhurmë, që përfundon
 * afër çmimit aktual. Vetëm për DEMO; nuk është e dhënë reale tregu.
 */
export function syntheticCandles(
  symbol: string,
  currentPrice: number,
  timeframe: Timeframe,
  count: number,
): Candle[] {
  const rnd = seededRandom(hashString(symbol));
  const price = currentPrice > 0 ? currentPrice : 100;
  const step = TIMEFRAME_MS[timeframe];
  const now = Date.now();

  // Paqëndrueshmëria për qiri si % e çmimit (varion lehtë sipas simbolit).
  const vol = 0.004 + rnd() * 0.012;
  // Trend i lehtë i përgjithshëm (mund të jetë lart ose poshtë).
  const drift = (rnd() - 0.5) * vol * 0.6;

  // Punojmë mbrapsht nga çmimi aktual për ta përfunduar serinë saktësisht aty.
  const closes: number[] = new Array(count);
  closes[count - 1] = price;
  for (let i = count - 2; i >= 0; i--) {
    const shock = (rnd() - 0.5) * 2 * vol;
    // close[i+1] = close[i] * (1 + drift + shock)  →  close[i] = close[i+1] / (1+...)
    closes[i] = closes[i + 1] / (1 + drift + shock);
  }

  const candles: Candle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const close = closes[i];
    const open = i === 0 ? close * (1 - drift) : closes[i - 1];
    const wick = close * vol;
    const high = Math.max(open, close) + rnd() * wick;
    const low = Math.min(open, close) - rnd() * wick;
    candles[i] = {
      time: now - (count - 1 - i) * step,
      open,
      high,
      low,
      close,
      volume: 1000 + rnd() * 9000,
    };
  }
  return candles;
}
