// Hook React: ekzekuton motorin AI Trader për një aktiv dhe kthen analizën.
// Menaxhon loading / error dhe shmang përditësimet pas çmontimit (unmount).

import { useCallback, useEffect, useState } from 'react';
import { analyzeAsset, type AnalyzeAssetInput, type AssetAnalysis } from '../analyze';

interface State {
  analysis: AssetAnalysis | null;
  loading: boolean;
  error: string | null;
}

export function useAssetAnalysis(input: AnalyzeAssetInput | null) {
  const [state, setState] = useState<State>({ analysis: null, loading: false, error: null });

  // Serializojmë hyrjen që efekti të rishpërndahet vetëm kur ndryshon vërtet.
  const key = input
    ? `${input.symbol}|${input.category ?? ''}|${input.currentPrice}|${input.timeframe ?? '1h'}`
    : null;

  const run = useCallback(async (signal?: { aborted: boolean }) => {
    if (!input) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const analysis = await analyzeAsset(input);
      if (!signal?.aborted) setState({ analysis, loading: false, error: null });
    } catch (e) {
      if (!signal?.aborted) {
        setState({ analysis: null, loading: false, error: (e as Error).message });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!input) {
      setState({ analysis: null, loading: false, error: null });
      return;
    }
    const token = { aborted: false };
    run(token);
    return () => {
      token.aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, refresh: () => run() };
}
