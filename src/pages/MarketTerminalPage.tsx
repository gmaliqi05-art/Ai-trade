import { useEffect, useState, useCallback } from 'react';
import {
  Activity, RefreshCw, Loader2, TrendingUp, Zap, Brain,
  Wallet, AlertCircle, History,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage } from '../App';
import TradingViewChart from '../components/TradingViewChart';
import OpenPositionsPanel from '../components/OpenPositionsPanel';
import {
  loadMetaApiConfig, checkMetaApiConnection, executeTrade, loadTradeHistory,
  type AccountInfo, type HistoryDeal,
} from '../services/metaapi';

interface Asset { id: string; symbol: string; name: string; category: string; current_price: number; }
interface Signal {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  source: string; created_at: string;
}

function errText(code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: 'Lidh llogarinë MT5 te Lidhja & Konfigurimi para se të tregtosh.',
    metaapi_unreachable: "S'u arrit MetaApi — kontrollo lidhjen.",
    kill_switch: 'Kill-switch është aktiv — çaktivizoje te Lidhja & Konfigurimi.',
    max_open_trades: 'Arritur limiti i pozicioneve të hapura.',
    max_daily_loss: 'Arritur limiti i humbjes ditore.',
  };
  return map[code] || message || code;
}

export default function MarketTerminalPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selected, setSelected] = useState('XAUUSD');
  const [tf, setTf] = useState('15m');

  const [metaConfigured, setMetaConfigured] = useState(false);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<HistoryDeal[]>([]);

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [lot, setLot] = useState('0.01');
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const goldFirst = (arr: Asset[]) =>
    [...arr].sort((a, b) => (a.symbol === 'XAUUSD' ? 0 : a.category === 'commodity' ? 1 : 2) - (b.symbol === 'XAUUSD' ? 0 : b.category === 'commodity' ? 1 : 2));

  const fetchBase = useCallback(async () => {
    const now = new Date().toISOString();
    const [ar, sr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, category, current_price').gt('current_price', 0),
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at')
        .eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${now}`).order('confidence', { ascending: false }).limit(8),
    ]);
    if (ar.data) setAssets(goldFirst(ar.data as Asset[]));
    if (sr.data) setSignals(sr.data as Signal[]);
  }, []);

  // Lexon gjendjen reale të MT5: llogaria + historiku.
  const fetchMeta = useCallback(async () => {
    if (!user) return;
    const cfg = await loadMetaApiConfig(user.id);
    const configured = !!(cfg.account_id && cfg.token);
    setMetaConfigured(configured);
    setMtMode(cfg.mode);
    if (configured) {
      const [acc, hist] = await Promise.all([checkMetaApiConnection(), loadTradeHistory()]);
      if (!acc.error && acc.account) setAccount(acc.account);
      if (!hist.error && Array.isArray(hist.deals)) {
        const closed = hist.deals
          .filter(d => d.entryType === 'DEAL_ENTRY_OUT' || (d.profit != null && d.profit !== 0))
          .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        setHistory(closed);
      }
    }
    setLastUpdated(new Date());
  }, [user]);

  useEffect(() => {
    fetchBase();
    fetchMeta();
    const id = setInterval(() => { fetchBase(); fetchMeta(); }, 20000);
    return () => clearInterval(id);
  }, [fetchBase, fetchMeta]);

  const handleTrade = async () => {
    const vol = parseFloat(lot);
    if (isNaN(vol) || vol <= 0) { setTradeMsg({ type: 'error', text: 'Vendos një lot të vlefshëm (p.sh. 0.01).' }); return; }
    if (!metaConfigured) { setTradeMsg({ type: 'error', text: errText('metaapi_not_configured') }); return; }
    setTradeLoading(true); setTradeMsg(null);
    const r = await executeTrade({ action: tradeType === 'buy' ? 'BUY' : 'SELL', symbol: selected, volume: vol });
    if (r.error) setTradeMsg({ type: 'error', text: errText(r.error, r.message) });
    else { setTradeMsg({ type: 'success', text: `Urdhër ${tradeType === 'buy' ? 'BLEJ' : 'SHIT'} ${selected} (${vol} lot) dërguar (${r.mode}).` }); fetchMeta(); }
    setTradeLoading(false);
  };

  const money = (n?: number) => (n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const cur = account?.currency || '$';

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-400" />MetaTrader 5 — Live
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Llogaria jote reale MT5, grafiku, tregtimi dhe trade-t — live
            {lastUpdated && <span className="ml-2 text-gray-600 text-xs">· {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
            !metaConfigured ? 'bg-gray-700/50 text-gray-400 border-gray-600'
            : mtMode === 'live' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
          }`}>{!metaConfigured ? 'PA LIDHJE' : mtMode === 'live' ? '● LIVE' : '● DEMO'}</span>
          <button onClick={() => { fetchBase(); fetchMeta(); }} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {!metaConfigured && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-medium text-sm">MT5 s'është i lidhur</p>
            <p className="text-amber-400/80 text-xs mt-0.5">Lidh llogarinë tënde MT5 (Vantage) te <strong>Lidhja & Konfigurimi</strong> për ta parë live këtu.</p>
            <button onClick={() => onNavigate('metatrader')} className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline">Shko te Lidhja & Konfigurimi</button>
          </div>
        </div>
      )}

      {/* Gjendja e llogarisë */}
      {metaConfigured && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Balanca', value: `${money(account?.balance)} ${cur}`, icon: Wallet, cls: 'text-white' },
            { label: 'Equity', value: `${money(account?.equity)} ${cur}`, icon: Activity, cls: 'text-white' },
            { label: 'Fitim/Humbje', value: `${(account?.profit ?? 0) >= 0 ? '+' : ''}${money(account?.profit)}`, icon: TrendingUp, cls: (account?.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: 'Marzh i lirë', value: `${money(account?.freeMargin)} ${cur}`, icon: Wallet, cls: 'text-white' },
          ].map(c => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-1"><Icon className="w-3.5 h-3.5" />{c.label}</div>
                <div className={`font-bold text-base ${c.cls}`}>{c.value}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grafik + porosi */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {assets.slice(0, 7).map(a => (
                  <button key={a.id} onClick={() => setSelected(a.symbol)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${selected === a.symbol ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {a.symbol}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
                {['1m', '5m', '15m', '1h', '4h', '1d'].map(t => (
                  <button key={t} onClick={() => setTf(t)} className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${tf === t ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>{t === '1d' ? '1D' : t}</button>
                ))}
              </div>
            </div>
            <div className="h-[380px]"><TradingViewChart symbol={selected} timeframe={tf} /></div>
          </div>
        </div>

        {/* Porosia BLEJ/SHIT */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3 h-fit">
          <h3 className="text-white font-semibold text-sm">Porosi e re — {selected}</h3>
          <div className="flex rounded-xl overflow-hidden border border-gray-700">
            <button onClick={() => setTradeType('buy')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>BLEJ</button>
            <button onClick={() => setTradeType('sell')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>SHIT</button>
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Lot (madhësia)</label>
            <input type="number" value={lot} onChange={e => setLot(e.target.value)} min="0.01" step="0.01"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {['0.01', '0.05', '0.10', '0.25'].map(v => (
              <button key={v} onClick={() => setLot(v)} className={`text-xs py-1.5 rounded-lg transition-colors ${lot === v ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}>{v}</button>
            ))}
          </div>
          {tradeMsg && (
            <div className={`text-xs rounded-xl px-3 py-2 ${tradeMsg.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-red-900/30 text-red-400 border border-red-800/50'}`}>{tradeMsg.text}</div>
          )}
          <button onClick={handleTrade} disabled={tradeLoading || !metaConfigured}
            className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
            {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}{tradeType === 'buy' ? 'BLEJ' : 'SHIT'} {selected}
          </button>
          <button onClick={() => onNavigate('chart_analysis')} className="w-full flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl py-2 text-xs font-medium transition-colors">
            <Brain className="w-3.5 h-3.5" />Analizë AI për {selected}
          </button>
        </div>
      </div>

      {/* Sinjalet që vijnë */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Sinjalet</h3>
          <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300">Të gjitha</button>
        </div>
        {signals.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">Asnjë sinjal aktiv tani.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {signals.map(s => (
              <button key={s.id} onClick={() => setSelected(s.symbol)} className="text-left bg-gray-800/40 rounded-xl px-3 py-2 hover:bg-gray-800 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{s.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? 'BLEJ' : 'SHIT'}</span>
                  </span>
                  <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                </div>
                <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                  {s.entry_price && <span>Hyrje: <span className="text-white">{Number(s.entry_price).toLocaleString()}</span></span>}
                  {s.target_price && <span>Objektiv: <span className="text-green-400">{Number(s.target_price).toLocaleString()}</span></span>}
                  {s.stop_loss && <span>Stop: <span className="text-red-400">{Number(s.stop_loss).toLocaleString()}</span></span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pozicionet e hapura (live) + mbyllje */}
      <OpenPositionsPanel configured={metaConfigured} />

      {/* Trade-t e mbyllura (historiku real nga MT5) */}
      {metaConfigured && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><History className="w-4 h-4 text-amber-400" />Trade-t e mbyllura (7 ditët e fundit)</h3>
          {history.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-3">Asnjë trade i mbyllur ende.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-medium py-2">Simboli</th>
                    <th className="text-left font-medium py-2">Lloji</th>
                    <th className="text-right font-medium py-2">Lot</th>
                    <th className="text-right font-medium py-2">Çmimi</th>
                    <th className="text-right font-medium py-2">Fitim/Humbje</th>
                    <th className="text-right font-medium py-2">Koha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {history.slice(0, 25).map(d => {
                    const isBuy = (d.type || '').includes('BUY');
                    const profit = Number(d.profit ?? 0);
                    return (
                      <tr key={d.id} className="hover:bg-gray-800/30">
                        <td className="py-2 text-white font-medium">{d.symbol || '—'}</td>
                        <td className="py-2"><span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? 'BLEJ' : 'SHIT'}</span></td>
                        <td className="py-2 text-right text-gray-300">{d.volume ?? '—'}</td>
                        <td className="py-2 text-right text-gray-300">{d.price ?? '—'}</td>
                        <td className={`py-2 text-right font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{profit >= 0 ? '+' : ''}{profit.toFixed(2)}</td>
                        <td className="py-2 text-right text-gray-500">{d.time ? new Date(d.time).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
