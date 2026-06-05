// Hook React: ekzekuton motorin për një LISTË aktivesh (p.sh. të gjitha crypto-t)
// dhe kthen analizat. I dobishëm për faqen e sinjaleve.

import { useCallback, useEffect, useState } from 'react';
import { analyzeAsset, type AssetAnalysis } from '../analyze';
import type { TradePlanOptions } from '../core/trade-plan';
import type { Timeframe } from '../market/candles';

export interface MarketAsset {
  symbol: string;
  category?: string;
  currentPrice: number;
}

/** Opsione SL/TP nga cilësimet e përdoruesit (scalp $ për afatshkurtër etj.). */
export interface MarketAnalysisOptions {
  shortPlanOptions?: TradePlanOptions;
  longPlanOptions?: TradePlanOptions;
}

interface State {
  analyses: AssetAnalysis[];
  loading: boolean;
  error: string | null;
}

export function useMarketAnalysis(assets: MarketAsset[], timeframe: Timeframe = '1h', options?: MarketAnalysisOptions) {
  const [state, setState] = useState<State>({ analyses: [], loading: false, error: null });

  // Çelës i qëndrueshëm nga simbolet + çmimet + opsionet (që të rillogaritet kur ndryshojnë cilësimet).
  const key = assets.map((a) => `${a.symbol}:${a.currentPrice}`).join(',') + `|${timeframe}` + `|${JSON.stringify(options ?? {})}`;

  const run = useCallback(async (token?: { aborted: boolean }) => {
    if (assets.length === 0) {
      setState({ analyses: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const analyses = await Promise.all(
        assets.map((a) =>
          analyzeAsset({
            symbol: a.symbol,
            category: a.category,
            currentPrice: a.currentPrice,
            timeframe,
            shortPlanOptions: options?.shortPlanOptions,
            longPlanOptions: options?.longPlanOptions,
          }).catch(
            (e): AssetAnalysis => ({
              symbol: a.symbol,
              source: 'demo',
              provider: `Gabim: ${(e as Error).message}`,
              candleCount: 0,
              short: null,
              long: null,
              generatedAt: Date.now(),
            }),
          ),
        ),
      );
      if (!token?.aborted) setState({ analyses, loading: false, error: null });
    } catch (e) {
      if (!token?.aborted) setState({ analyses: [], loading: false, error: (e as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const token = { aborted: false };
    run(token);
    return () => {
      token.aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, refresh: () => run() };
}
