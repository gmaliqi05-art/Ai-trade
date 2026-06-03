// Karta e sinjalit të motorit për një aktiv: shfaq horizontin afatshkurtër dhe
// afatgjatë me veprimin (BLEJ/SHIT/PRIT), besueshmërinë, planet dhe arsyet.

import { useState } from 'react';
import { Target, Shield, TrendingUp, ChevronDown, ChevronUp, Clock, Activity, Sparkles, Loader2, Layers } from 'lucide-react';
import type { AssetAnalysis, HorizonAnalysis } from '../analyze';
import { suggestLot } from '../core/lot';
import { actionClasses, actionLabel, fmtPct, fmtPrice } from './format';

/** Forma minimale e arsyetimit nga AI që i duhet kartës (e pajtueshme me services/aiReasoning). */
export interface CardAiReasoning {
  signal: string;
  confidence: number;
  sentiment?: string;
  analysis_text: string;
  reasoning: string;
  provider_used?: string;
}

function HorizonBlock({ title, data, category, accountBalance }: { title: string; data: HorizonAnalysis | null; category?: string; accountBalance?: number }) {
  const [open, setOpen] = useState(false);

  if (!data) {
    return (
      <div className="bg-gray-800/40 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-xs font-medium flex items-center gap-1">
            <Clock className="w-3 h-3" />{title}
          </span>
          <span className="text-gray-600 text-xs">s'ka mjaft të dhëna</span>
        </div>
      </div>
    );
  }

  const { signal, plan } = data;
  const isActionable = signal.action !== 'HOLD';
  const lot = isActionable && accountBalance
    ? suggestLot(category, accountBalance, plan.entry, plan.stopLoss)
    : null;

  return (
    <div className="bg-gray-800/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-xs font-medium flex items-center gap-1">
          <Clock className="w-3 h-3" />{title}
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${actionClasses(signal.action)}`}>
            {actionLabel(signal.action)}
          </span>
          <span className="text-amber-400 text-xs font-semibold">{fmtPct(signal.confidence)}</span>
        </div>
      </div>

      {isActionable && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="bg-gray-900/60 rounded-lg p-1.5 text-center">
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><Target className="w-2.5 h-2.5" />Hyrje</div>
            <div className="text-white text-xs font-semibold">{fmtPrice(plan.entry)}</div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-1.5 text-center">
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />Objektiv</div>
            <div className="text-green-400 text-xs font-semibold">{fmtPrice(plan.takeProfit)}</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-1.5 text-center">
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><Shield className="w-2.5 h-2.5" />Stop</div>
            <div className="text-red-400 text-xs font-semibold">{fmtPrice(plan.stopLoss)}</div>
          </div>
        </div>
      )}

      {isActionable && lot && (
        <div className="flex items-center justify-between text-[11px] bg-gray-900/40 rounded-lg px-2 py-1">
          <span className="text-gray-400 flex items-center gap-1"><Layers className="w-3 h-3 text-amber-400" />Lot i sugjeruar (rrezik 1%)</span>
          <span className="text-white font-semibold">{lot.lot} <span className="text-gray-500">· rrezik ~${lot.moneyAtRisk.toFixed(0)}</span></span>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-gray-500 hover:text-gray-300 text-[11px] transition-colors"
      >
        <span>{isActionable ? `R/R 1:${plan.riskReward}` : 'Asnjë pozicion (sinjal i dobët)'}</span>
        <span className="flex items-center gap-1">Arsyet {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
      </button>

      {open && (
        <ul className="space-y-1 pt-1 border-t border-gray-700/50">
          {signal.reasons.map((r, i) => (
            <li key={i} className="text-gray-400 text-[11px] flex gap-1.5">
              <span className="text-amber-500/70">•</span>{r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EngineSignalCardProps {
  analysis: AssetAnalysis;
  /** Nëse jepet, shfaqet butoni "Arsyeto me Claude AI" që e thërret këtë funksion. */
  askAI?: (analysis: AssetAnalysis) => Promise<CardAiReasoning>;
  /** Kategoria e aktivit (për llogaritjen e lotit). */
  category?: string;
  /** Balanca e llogarisë (për sugjerimin e lotit me rrezik 1%). */
  accountBalance?: number;
}

function AiReasoningBlock({ analysis, askAI }: { analysis: AssetAnalysis; askAI: NonNullable<EngineSignalCardProps['askAI']> }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CardAiReasoning | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await askAI(analysis));
    } catch (e) {
      setError((e as Error).message || 'Arsyetimi dështoi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-1 border-t border-gray-800">
      <button
        onClick={run}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 text-xs font-medium text-purple-300 hover:text-purple-200 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-xl py-2 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {loading ? 'Claude po analizon…' : result ? 'Rifresko arsyetimin AI' : 'Arsyeto me Claude AI'}
      </button>

      {error && (
        <p className="mt-2 text-[11px] text-red-400">
          {error === 'no_active_providers' || error.includes('provider')
            ? 'Asnjë provider AI i konfiguruar. Shto një çelës (p.sh. Anthropic) te Admin → AI Providers.'
            : error}
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-1.5 bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${actionClasses(result.signal.toUpperCase() === 'BUY' ? 'BUY' : result.signal.toUpperCase() === 'SELL' ? 'SELL' : 'HOLD')}`}>
              {result.signal.toUpperCase() === 'BUY' ? 'BLEJ' : result.signal.toUpperCase() === 'SELL' ? 'SHIT' : 'PRIT'}
            </span>
            <span className="text-purple-300 text-xs font-semibold">{Math.round(result.confidence)}% Claude</span>
          </div>
          <p className="text-gray-300 text-[11px] leading-relaxed">{result.analysis_text}</p>
          <p className="text-gray-400 text-[11px] leading-relaxed">{result.reasoning}</p>
          {result.provider_used && <p className="text-gray-600 text-[10px]">burimi: {result.provider_used}</p>}
        </div>
      )}
    </div>
  );
}

export function EngineSignalCard({ analysis, askAI, category, accountBalance }: EngineSignalCardProps) {
  const sourceBadge =
    analysis.source === 'live'
      ? 'bg-green-500/20 text-green-400 border-green-500/30'
      : 'bg-amber-500/20 text-amber-400 border-amber-500/30';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="text-white font-bold">{analysis.symbol}</span>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${sourceBadge}`}>
          {analysis.source === 'live' ? `LIVE · ${analysis.provider}` : 'VLERËSIM'}
        </span>
      </div>

      <HorizonBlock title="Afatshkurtër" data={analysis.short} category={category} accountBalance={accountBalance} />
      <HorizonBlock title="Afatgjatë" data={analysis.long} category={category} accountBalance={accountBalance} />

      {askAI && (analysis.short || analysis.long) && <AiReasoningBlock analysis={analysis} askAI={askAI} />}
    </div>
  );
}
