// Shërbim që lidh motorin matematik (src/ai-trader) me arsyetimin cilësor të Claude AI
// përmes edge function-it `ai-analyze`. Frontend-i dërgon indikatorët + verdiktin e
// motorit; Claude kthen një vlerësim cilësor + besueshmëri.

import { supabase } from '../lib/supabase';
import type { AssetAnalysis } from '../ai-trader/analyze';

export interface AiReasoning {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  analysis_text: string;
  reasoning: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  key_levels?: string[];
  provider_used?: string;
}

export class AiReasoningError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiReasoningError';
  }
}

/** Ndërton payload-in `engine` nga analiza e motorit për një aktiv. */
function buildEnginePayload(analysis: AssetAnalysis) {
  const snap = analysis.short?.signal.indicators ?? analysis.long?.signal.indicators;
  const horizon = (h: AssetAnalysis['short']) =>
    h ? { action: h.signal.action, confidence: h.signal.confidence, reasons: h.signal.reasons } : undefined;
  return {
    source: analysis.source,
    indicators: snap
      ? {
          emaFast: snap.emaFast, emaSlow: snap.emaSlow, rsi: snap.rsi,
          macd: snap.macd, macdSignal: snap.macdSignal, macdHist: snap.macdHist,
          bbUpper: snap.bbUpper, bbMiddle: snap.bbMiddle, bbLower: snap.bbLower, atr: snap.atr,
        }
      : undefined,
    short: horizon(analysis.short),
    long: horizon(analysis.long),
  };
}

/**
 * Kërkon arsyetimin e Claude AI mbi sinjalin e motorit për një aktiv.
 * Hedh `AiReasoningError` me kod kuptimplotë kur s'ka provider të konfiguruar.
 */
export async function requestEngineReasoning(
  analysis: AssetAnalysis,
  opts: { assetId?: string; timeframe?: string; preferredProvider?: string } = {},
): Promise<AiReasoning> {
  const { data, error } = await supabase.functions.invoke('ai-analyze', {
    body: {
      symbol: analysis.symbol,
      asset_id: opts.assetId,
      timeframe: opts.timeframe ?? 'H1',
      preferred_provider: opts.preferredProvider,
      engine: buildEnginePayload(analysis),
    },
  });

  if (error) {
    // supabase.functions.invoke nuk e ekspozon body-n e gabimit drejtpërdrejt;
    // përpiqemi ta lexojmë nëse vjen si FunctionsHttpError.
    let detail = error.message;
    let code = 'invoke_error';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json();
        if (b?.error) code = b.error;
        if (b?.message) detail = b.message;
      }
    } catch {
      // injoro
    }
    throw new AiReasoningError(code, detail);
  }

  if (!data?.success || !data?.analysis) {
    throw new AiReasoningError(data?.error ?? 'unknown', data?.message ?? 'Përgjigje e pavlefshme nga ai-analyze');
  }
  return data.analysis as AiReasoning;
}
