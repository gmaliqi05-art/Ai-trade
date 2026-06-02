// Tipet bazë të motorit të analizës.

/** Një qiri (candlestick) i tregut. `time` është timestamp në milisekonda. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Horizonti kohor i analizës. */
export type Horizon = 'short' | 'long';

/** Veprimi i sugjeruar nga roboti. */
export type Action = 'BUY' | 'SELL' | 'HOLD';

/** Vlerat e indikatorëve të llogaritura për qiriun e fundit. */
export interface IndicatorSnapshot {
  emaFast: number;
  emaSlow: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr: number;
  price: number;
}

/** Sinjali i prodhuar nga motori. */
export interface Signal {
  action: Action;
  /** Besueshmëria 0..1 (sa i fortë është sinjali). */
  confidence: number;
  /** Pikët e papërpunuara: pozitive = blej, negative = shit. */
  score: number;
  horizon: Horizon;
  reasons: string[];
  indicators: IndicatorSnapshot;
}
