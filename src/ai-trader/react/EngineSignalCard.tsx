// Karta e sinjalit të motorit për një aktiv: shfaq horizontin afatshkurtër dhe
// afatgjatë me veprimin (BLEJ/SHIT/PRIT), besueshmërinë, planet dhe arsyet.

import { useState } from 'react';
import { Target, Shield, TrendingUp, ChevronDown, ChevronUp, Clock, Activity, Sparkles, Loader2, Layers, LogIn, CheckCircle, AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n/i18n';
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

/** Të dhënat e dërguara kur klikohet "Hyr" mbi një horizont të sinjalit. */
export interface EngineEnterInput {
  symbol: string;
  action: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lot?: number;
  horizon: 'short' | 'long';
}

function HorizonBlock({ title, data, category, accountBalance, riskPercent, symbol, horizon, onEnter }: {
  title: string; data: HorizonAnalysis | null; category?: string; accountBalance?: number; riskPercent?: number;
  symbol?: string; horizon: 'short' | 'long';
  onEnter?: (i: EngineEnterInput) => Promise<{ ok: boolean; msg: string }>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const [enterMsg, setEnterMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!data) {
    return (
      <div className="bg-gray-800/40 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-xs font-medium flex items-center gap-1">
            <Clock className="w-3 h-3" />{title}
          </span>
          <span className="text-gray-600 text-xs">{t('s\'ka mjaft të dhëna')}</span>
        </div>
      </div>
    );
  }

  const { signal, plan } = data;
  const isActionable = signal.action !== 'HOLD';
  const riskPct = riskPercent && riskPercent > 0 ? riskPercent : 0.01;
  const lot = isActionable && accountBalance
    ? suggestLot(category, accountBalance, plan.entry, plan.stopLoss, riskPct)
    : null;

  const doEnter = async () => {
    if (!onEnter || !symbol || (signal.action !== 'BUY' && signal.action !== 'SELL')) return;
    setEntering(true); setEnterMsg(null);
    try {
      const res = await onEnter({
        symbol, action: signal.action, entry: plan.entry, stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfit, lot: lot?.lot, horizon,
      });
      setEnterMsg(res);
    } catch (e) {
      setEnterMsg({ ok: false, msg: (e as Error).message });
    } finally {
      setEntering(false);
    }
  };

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
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><Target className="w-2.5 h-2.5" />{t('Hyrje')}</div>
            <div className="text-white text-xs font-semibold">{fmtPrice(plan.entry)}</div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-1.5 text-center">
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />{t('Objektiv')}</div>
            <div className="text-green-400 text-xs font-semibold">{fmtPrice(plan.takeProfit)}</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-1.5 text-center">
            <div className="text-gray-500 text-[10px] flex items-center justify-center gap-0.5"><Shield className="w-2.5 h-2.5" />{t('Stop')}</div>
            <div className="text-red-400 text-xs font-semibold">{fmtPrice(plan.stopLoss)}</div>
          </div>
        </div>
      )}

      {isActionable && lot && (
        <div className="flex items-center justify-between text-[11px] bg-gray-900/40 rounded-lg px-2 py-1">
          <span className="text-gray-400 flex items-center gap-1"><Layers className="w-3 h-3 text-amber-400" />{t('Lot i sugjeruar (rrezik {pct}%)', { pct: +(riskPct * 100).toFixed(2) })}</span>
          <span className="text-white font-semibold">{lot.lot} <span className="text-gray-500">· {t('rrezik ~${money}', { money: lot.moneyAtRisk.toFixed(0) })}</span></span>
        </div>
      )}

      {/* Butoni HYR — ekzekuton trade-in direkt nga gjenerimi (porosi tregu ose në pritje). */}
      {isActionable && onEnter && symbol && (
        <>
          <button onClick={doEnter} disabled={entering}
            className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-60 ${signal.action === 'BUY' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
            {entering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
            {t('Hyr {dir}', { dir: signal.action === 'BUY' ? t('BLEJ') : t('SHIT') })}
          </button>
          {enterMsg && (
            <div className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2 py-1.5 ${enterMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {enterMsg.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />}<span>{enterMsg.msg}</span>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-gray-500 hover:text-gray-300 text-[11px] transition-colors"
      >
        <span>{isActionable ? `R/R 1:${plan.riskReward}` : t('Asnjë pozicion (sinjal i dobët)')}</span>
        <span className="flex items-center gap-1">{t('Arsyet')} {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
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
  /** Nëse jepet, shfaqet butoni "Kërko arsyetimin e Robotit" që e thërret këtë funksion. */
  askAI?: (analysis: AssetAnalysis) => Promise<CardAiReasoning>;
  /** Kategoria e aktivit (për llogaritjen e lotit). */
  category?: string;
  /** Balanca e llogarisë (për sugjerimin e lotit). */
  accountBalance?: number;
  /** Rreziku per-trade si fraksion (p.sh. 0.01 = 1%), nga cilësimet. Default 1%. */
  riskPercent?: number;
  /** Nëse jepet, shfaqet butoni "Hyr" që ekzekuton trade-in direkt. */
  onEnter?: (i: EngineEnterInput) => Promise<{ ok: boolean; msg: string }>;
}

function AiReasoningBlock({ analysis, askAI }: { analysis: AssetAnalysis; askAI: NonNullable<EngineSignalCardProps['askAI']> }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CardAiReasoning | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await askAI(analysis));
    } catch (e) {
      setError((e as Error).message || t('Arsyetimi dështoi'));
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
        {loading ? t('Roboti po analizon…') : result ? t('Rifresko arsyetimin') : t('Kërko arsyetimin e Robotit')}
      </button>

      {error && (
        <p className="mt-2 text-[11px] text-red-400">
          {error === 'no_active_providers' || error.includes('provider')
            ? t('Arsyetimi i robotit s\'është i disponueshëm tani. Provo më vonë.')
            : error}
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-1.5 bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${actionClasses(result.signal.toUpperCase() === 'BUY' ? 'BUY' : result.signal.toUpperCase() === 'SELL' ? 'SELL' : 'HOLD')}`}>
              {result.signal.toUpperCase() === 'BUY' ? t('BLEJ') : result.signal.toUpperCase() === 'SELL' ? t('SHIT') : t('PRIT')}
            </span>
            <span className="text-purple-300 text-xs font-semibold">{t('{confidence}% Robot', { confidence: Math.round(result.confidence) })}</span>
          </div>
          <p className="text-gray-300 text-[11px] leading-relaxed">{result.analysis_text}</p>
          <p className="text-gray-400 text-[11px] leading-relaxed">{result.reasoning}</p>
        </div>
      )}
    </div>
  );
}

export function EngineSignalCard({ analysis, askAI, category, accountBalance, riskPercent, onEnter }: EngineSignalCardProps) {
  const { t } = useI18n();
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
          {analysis.source === 'live' ? t('LIVE') : t('VLERËSIM')}
        </span>
      </div>

      <HorizonBlock title={t('Afatshkurtër')} data={analysis.short} category={category} accountBalance={accountBalance} riskPercent={riskPercent} symbol={analysis.symbol} horizon="short" onEnter={onEnter} />
      <HorizonBlock title={t('Afatgjatë')} data={analysis.long} category={category} accountBalance={accountBalance} riskPercent={riskPercent} symbol={analysis.symbol} horizon="long" onEnter={onEnter} />

      {askAI && (analysis.short || analysis.long) && <AiReasoningBlock analysis={analysis} askAI={askAI} />}
    </div>
  );
}
