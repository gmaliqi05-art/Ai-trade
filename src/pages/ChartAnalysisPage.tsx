import { useState, useEffect, useCallback } from 'react';
import { Brain, Loader2, AlertCircle, Activity, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useAssetAnalysis } from '../ai-trader/react/useAssetAnalysis';
import { EngineSignalCard } from '../ai-trader/react/EngineSignalCard';
import { requestEngineReasoning } from '../services/aiReasoning';
import type { Timeframe } from '../ai-trader/market/candles';
import TradingViewChart from '../components/TradingViewChart';
import { isGoldSessionActive, goldWindowLocal } from '../lib/goldSession';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  category?: string;
  type?: string;
}

// Periudhat e analizës live.
const LIVE_TIMEFRAMES: { v: Timeframe; label: string }[] = [
  { v: '1m', label: '1 min' },
  { v: '5m', label: '5 min' },
  { v: '15m', label: '15 min' },
  { v: '30m', label: '30 min' },
  { v: '1h', label: '1 orë' },
  { v: '4h', label: '4 orë' },
  { v: '1d', label: '1 ditë' },
];

export default function ChartAnalysisPage() {
  const { user, profile } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [liveTimeframe, setLiveTimeframe] = useState<Timeframe>('1h');

  // Tik çdo minutë për sesionin e arit (09:00–23:00 Frankfurt).
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const goldSessionOn = isGoldSessionActive(new Date(nowTick));
  const goldWin = goldWindowLocal(new Date(nowTick));

  const fetchData = useCallback(async () => {
    const { data } = await supabase
      .from('assets')
      .select('id, symbol, name, current_price, category, type')
      .order('symbol');
    if (data) {
      setAssets(data as Asset[]);
      const gold = (data as Asset[]).find(a => a.symbol === 'XAUUSD');
      setSelectedAsset(gold?.id || (data as Asset[])[0]?.id || '');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const assetObj = assets.find(a => a.id === selectedAsset) || null;
  const liveCategory = assetObj?.category || assetObj?.type;
  const isGold = assetObj?.symbol === 'XAUUSD';
  // Për arin, jashtë sesionit nuk gjenerojmë analizë (rezultate të dobëta).
  const blockedOutOfSession = isGold && !goldSessionOn;

  const liveInput = assetObj && assetObj.current_price > 0 && !blockedOutOfSession
    ? { symbol: assetObj.symbol, category: liveCategory, currentPrice: assetObj.current_price, timeframe: liveTimeframe }
    : null;
  const { analysis: liveAnalysis, loading: liveLoading, error: liveError, refresh: refreshLive } = useAssetAnalysis(liveInput);
  const accountBalance = Number(profile?.balance) || 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-amber-400" />Analizë e Robotit
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Roboti gjeneron analizë automatikisht nga të dhënat live të tregut — indikatorë realë teknikë, pa nevojë për foto.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />Cilësimet e analizës
            </h3>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Aktivi / Simboli</label>
              <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                {assets.map(a => <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Periudha e analizës</label>
              <div className="flex flex-wrap gap-2">
                {LIVE_TIMEFRAMES.map(t => (
                  <button key={t.v} onClick={() => setLiveTimeframe(t.v)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${liveTimeframe === t.v ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => refreshLive()}
              disabled={liveLoading || !assetObj || blockedOutOfSession}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-bold py-3 rounded-xl text-sm transition-all"
            >
              {liveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              {liveLoading ? 'Roboti po analizon…' : 'Gjenero analizë'}
            </button>

            <div className="text-[11px] text-gray-500 bg-gray-800/40 border border-gray-700/50 rounded-xl p-3 leading-relaxed">
              Roboti lexon çmime reale (ari/XAUUSD përmes PAXG) dhe llogarit indikatorët teknikë automatikisht (EMA, RSI, MACD, Bollinger, ATR, ADX). Pastaj mund të kërkosh arsyetimin e plotë të robotit brenda kartës.
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          {assetObj && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden h-[340px]">
              <TradingViewChart symbol={assetObj.symbol} timeframe={liveTimeframe} />
            </div>
          )}

          {blockedOutOfSession ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
              <Clock className="w-10 h-10 text-gray-600" />
              <p className="text-white font-medium">Jashtë orarit të tregtimit të arit 🌙</p>
              <p className="text-gray-400 text-sm max-w-sm">Analiza e arit gjenerohet vetëm {goldWin.open}–{goldWin.close} {goldWin.sameAsFrankfurt ? '(Frankfurt)' : '(koha jote)'} — sesioni London/New York me likuiditet të lartë.</p>
            </div>
          ) : liveLoading ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-amber-400 text-sm animate-pulse">Roboti po lexon çmimet live dhe po llogarit indikatorët…</p>
            </div>
          ) : liveError ? (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium text-sm">S'u gjenerua dot analiza</p>
                <p className="text-red-400/70 text-xs mt-1">{liveError}</p>
              </div>
            </div>
          ) : liveAnalysis ? (
            <EngineSignalCard
              analysis={liveAnalysis}
              category={liveCategory}
              accountBalance={accountBalance}
              askAI={(an) => requestEngineReasoning(an, { assetId: selectedAsset || undefined })}
            />
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Activity className="w-10 h-10 text-amber-400/50" />
              <p className="text-gray-400 text-sm max-w-xs">Zgjidh një aktiv dhe periudhën, pastaj kliko “Gjenero analizë”.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
