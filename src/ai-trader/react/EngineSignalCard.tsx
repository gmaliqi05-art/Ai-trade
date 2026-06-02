// Karta e sinjalit të motorit për një aktiv: shfaq horizontin afatshkurtër dhe
// afatgjatë me veprimin (BLEJ/SHIT/PRIT), besueshmërinë, planet dhe arsyet.

import { useState } from 'react';
import { Target, Shield, TrendingUp, ChevronDown, ChevronUp, Clock, Activity } from 'lucide-react';
import type { AssetAnalysis, HorizonAnalysis } from '../analyze';
import { actionClasses, actionLabel, fmtPct, fmtPrice } from './format';

function HorizonBlock({ title, data }: { title: string; data: HorizonAnalysis | null }) {
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

export function EngineSignalCard({ analysis }: { analysis: AssetAnalysis }) {
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
          {analysis.source === 'live' ? `LIVE · ${analysis.provider}` : 'DEMO'}
        </span>
      </div>

      <HorizonBlock title="Afatshkurtër" data={analysis.short} />
      <HorizonBlock title="Afatgjatë" data={analysis.long} />
    </div>
  );
}
