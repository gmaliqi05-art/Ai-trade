// Ura mes të dhënave të tregut dhe motorit: jep analizë të plotë për një aktiv,
// me sinjale afatshkurtër + afatgjatë dhe planet përkatëse të tregtisë.

import { generateSignal, minCandles } from './core/signal-engine';
import { buildTradePlan, type TradePlan, type TradePlanOptions } from './core/trade-plan';
import type { Horizon, Signal } from './core/types';
import { fetchCandles, type CandleResult, type Timeframe } from './market/candles';

export interface HorizonAnalysis {
  horizon: Horizon;
  signal: Signal;
  plan: TradePlan;
}

export interface AssetAnalysis {
  symbol: string;
  source: CandleResult['source'];
  provider: string;
  /** Numri i qirinjve i përdorur. */
  candleCount: number;
  short: HorizonAnalysis | null;
  long: HorizonAnalysis | null;
  generatedAt: number;
}

export interface AnalyzeAssetInput {
  symbol: string;
  category?: string;
  currentPrice: number;
  timeframe?: Timeframe;
  planOptions?: TradePlanOptions;
  /** Opsione plani vetëm për horizontin afatshkurtër (p.sh. SL/TP fikse të scalp-it). */
  shortPlanOptions?: TradePlanOptions;
  /** Opsione plani vetëm për horizontin afatgjatë (swing). */
  longPlanOptions?: TradePlanOptions;
}

/** Llogarit sinjalin + planin për një horizont, ose null nëse s'ka mjaft qirinj. */
function analyzeHorizon(
  candles: Parameters<typeof generateSignal>[0],
  horizon: Horizon,
  planOptions?: TradePlanOptions,
): HorizonAnalysis | null {
  if (candles.length < minCandles(horizon)) return null;
  const signal = generateSignal(candles, horizon);
  const plan = buildTradePlan(signal, planOptions);
  return { horizon, signal, plan };
}

/** Merr qirinjtë për aktivin dhe prodhon analizën afatshkurtër + afatgjatë. */
export async function analyzeAsset(input: AnalyzeAssetInput): Promise<AssetAnalysis> {
  const { symbol, category, currentPrice, timeframe = '1h', planOptions, shortPlanOptions, longPlanOptions } = input;
  const { candles, source, provider } = await fetchCandles({
    symbol,
    category,
    currentPrice,
    timeframe,
    limit: 260,
  });

  return {
    symbol,
    source,
    provider,
    candleCount: candles.length,
    short: analyzeHorizon(candles, 'short', shortPlanOptions ?? planOptions),
    long: analyzeHorizon(candles, 'long', longPlanOptions ?? planOptions),
    generatedAt: Date.now(),
  };
}
