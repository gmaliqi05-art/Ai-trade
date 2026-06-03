import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, Search, Star, StarOff, ChevronUp, ChevronDown, RefreshCw, Loader2, Cloud, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useAssetAnalysis } from '../ai-trader/react/useAssetAnalysis';
import { EngineSignalCard } from '../ai-trader/react/EngineSignalCard';
import { requestEngineReasoning } from '../services/aiReasoning';
import TradingViewChart from '../components/TradingViewChart';
import { executeTrade, loadMetaApiConfig, checkMetaApiConnection } from '../services/metaapi';

// Përkthen kodet e gabimit të MetaApi në mesazhe shqip.
function errText(code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: 'Lidh llogarinë MT5 te MetaTrader / Auto-Trade para se të tregtosh.',
    metaapi_unreachable: 'S\'u arrit MetaApi — kontrollo lidhjen te MetaTrader / Auto-Trade.',
    kill_switch: 'Kill-switch është aktiv — çaktivizoje te MetaTrader / Auto-Trade.',
    max_open_trades: 'Arritur limiti i pozicioneve të hapura.',
    max_daily_loss: 'Arritur limiti i humbjes ditore.',
    trade_failed: 'MetaApi e refuzoi urdhrin.',
  };
  return map[code] || message || code;
}

// Rendit aktivet me arin (XAUUSD) të parin — platforma është GOLDTRADE.
const goldFirst = <T extends { symbol: string; category?: string }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => {
    const rank = (x: { symbol: string; category?: string }) =>
      x.symbol === 'XAUUSD' ? 0 : x.category === 'commodity' ? 1 : 2;
    return rank(a) - rank(b);
  });

interface Asset {
  id: string; symbol: string; name: string; type: string; category: string;
  current_price: number; price_change_24h: number; price_change_pct: number; price_change_pct_24h: number;
  volume_24h: number; high_24h: number; low_24h: number;
}

type TradeType = 'buy' | 'sell';
type CategoryFilter = 'all' | 'commodity' | 'forex' | 'crypto' | 'stock';

export default function TradingPage() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Asset | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [tradeType, setTradeType] = useState<TradeType>('buy');
  const [lot, setLot] = useState('0.01');
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Gjendja e lidhjes reale MT5 (MetaApi).
  const [metaConfigured, setMetaConfigured] = useState(false);
  const [mtBalance, setMtBalance] = useState<number | null>(null);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');

  useEffect(() => {
    fetchAssets();
    if (user) { fetchWatchlist(); loadMeta(); }
  }, [user]);

  // Lexon konfigurimin MetaApi dhe balancën reale të MT5.
  const loadMeta = useCallback(async () => {
    if (!user) return;
    const cfg = await loadMetaApiConfig(user.id);
    const configured = !!(cfg.account_id && cfg.token);
    setMetaConfigured(configured);
    setMtMode(cfg.mode);
    if (configured) {
      const r = await checkMetaApiConnection();
      const bal = (r.account as { balance?: number } | undefined)?.balance;
      if (typeof bal === 'number') setMtBalance(bal);
    }
  }, [user]);

  const fetchAssets = async () => {
    const { data } = await supabase.from('assets').select('*').order('category');
    if (data) { const sorted = goldFirst(data as Asset[]); setAssets(sorted); if (!selected && sorted.length > 0) setSelected(sorted[0]); }
    setLoading(false);
  };

  const fetchWatchlist = async () => {
    if (!user) return;
    const { data } = await supabase.from('watchlist').select('asset_id').eq('user_id', user.id);
    if (data) setWatchlist(new Set(data.map((w: { asset_id: string }) => w.asset_id)));
  };

  const toggleWatchlist = async (assetId: string) => {
    if (!user) return;
    if (watchlist.has(assetId)) {
      await supabase.from('watchlist').delete().eq('user_id', user.id).eq('asset_id', assetId);
      setWatchlist(prev => { const n = new Set(prev); n.delete(assetId); return n; });
    } else {
      await supabase.from('watchlist').insert({ user_id: user.id, asset_id: assetId });
      setWatchlist(prev => new Set([...prev, assetId]));
    }
  };

  // Dërgon urdhër REAL në MT5 përmes MetaApi (jo simulim).
  const handleTrade = async () => {
    if (!selected) return;
    const vol = parseFloat(lot);
    if (isNaN(vol) || vol <= 0) { setTradeMsg({ type: 'error', text: 'Vendos një lot të vlefshëm (p.sh. 0.01).' }); return; }
    if (!metaConfigured) { setTradeMsg({ type: 'error', text: errText('metaapi_not_configured') }); return; }
    setTradeLoading(true);
    setTradeMsg(null);
    const r = await executeTrade({ action: tradeType === 'buy' ? 'BUY' : 'SELL', symbol: selected.symbol, volume: vol });
    if (r.error) {
      setTradeMsg({ type: 'error', text: errText(r.error, r.message) });
    } else {
      setTradeMsg({ type: 'success', text: `Urdhër ${tradeType === 'buy' ? 'BLEJ' : 'SHIT'} ${selected.symbol} (${vol} lot) dërguar në MT5 (${r.mode}). Order: ${r.order_id ?? 'n/a'}` });
      loadMeta();
    }
    setTradeLoading(false);
  };

  const { analysis: engineAnalysis, loading: engineLoading } = useAssetAnalysis(
    selected ? { symbol: selected.symbol, category: selected.category, currentPrice: selected.current_price, timeframe: '1h' } : null,
  );

  const filtered = goldFirst(assets.filter(a => (category === 'all' || a.category === category) && (a.symbol.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase()))));
  const fp = (a: Asset) => a.category === 'forex' ? a.current_price.toFixed(4) : a.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 });
  const cc: Record<string, string> = { commodity: 'text-amber-400', forex: 'text-blue-400', crypto: 'text-orange-400', stock: 'text-green-400' };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-64 lg:w-72 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-800">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kërko..."
              className="w-full bg-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-500 border border-gray-700" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {([['all','Të gjitha'],['commodity','Mallra'],['forex','Forex'],['crypto','Crypto'],['stock','Aksione']] as const).map(([cat, lbl]) => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`text-xs px-2 py-1 rounded-lg transition-colors ${category === cat ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-3 space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-gray-800 rounded-lg animate-pulse" />)}</div> : (
            filtered.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)}
                className={`w-full flex items-center justify-between px-3 py-3 hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 ${selected?.id === a.id ? 'bg-amber-500/10 border-l-2 border-l-amber-500' : ''}`}>
                <div className="text-left">
                  <div className={`text-sm font-semibold ${cc[a.category] || 'text-white'}`}>{a.symbol}</div>
                  <div className="text-gray-500 text-xs truncate max-w-[100px]">{a.name.split('/')[0].trim()}</div>
                </div>
                <div className="text-right">
                  <div className="text-white text-xs font-medium">{fp(a)}</div>
                  <div className={`text-xs flex items-center gap-0.5 justify-end ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {a.price_change_pct >= 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {Math.abs(a.price_change_pct).toFixed(2)}%
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="bg-gray-900/50 border-b border-gray-800 px-6 py-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className={`text-2xl font-bold ${cc[selected.category] || 'text-white'}`}>{selected.symbol}</h2>
                      <button onClick={() => toggleWatchlist(selected.id)} className="text-gray-500 hover:text-amber-400 transition-colors">
                        {watchlist.has(selected.id) ? <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> : <StarOff className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-gray-400 text-sm">{selected.name}</p>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-white">{fp(selected)}</div>
                    <div className={`flex items-center gap-1 text-sm font-medium ${selected.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selected.price_change_pct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {selected.price_change_24h >= 0 ? '+' : ''}{selected.price_change_24h.toFixed(selected.category === 'forex' ? 4 : 2)} ({selected.price_change_pct >= 0 ? '+' : ''}{selected.price_change_pct.toFixed(2)}%)
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  {[{ l: 'Maks 24h', v: selected.high_24h.toFixed(selected.category === 'forex' ? 4 : 2) }, { l: 'Min 24h', v: selected.low_24h.toFixed(selected.category === 'forex' ? 4 : 2) }, { l: 'Vëllimi', v: `$${(selected.volume_24h / 1e9).toFixed(2)}B` }].map(s => (
                    <div key={s.l} className="text-center"><div className="text-gray-500 text-xs">{s.l}</div><div className="text-white font-medium">{s.v}</div></div>
                  ))}
                </div>
                <button onClick={fetchAssets} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"><RefreshCw className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 p-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl h-full overflow-hidden">
                  <TradingViewChart symbol={selected.symbol} />
                </div>
              </div>

              <div className="w-72 bg-gray-900 border-l border-gray-800 p-5 flex flex-col gap-4 overflow-y-auto">
                <div>
                  <h3 className="text-white font-semibold mb-2">Sinjali AI</h3>
                  {engineLoading || !engineAnalysis ? (
                    <div className="h-40 bg-gray-800 rounded-2xl animate-pulse" />
                  ) : (
                    <>
                      <EngineSignalCard
                        analysis={engineAnalysis}
                        category={selected?.category}
                        accountBalance={mtBalance ?? 0}
                        askAI={(an) => requestEngineReasoning(an, { assetId: selected?.id })}
                      />
                      {engineAnalysis.short && engineAnalysis.short.signal.action !== 'HOLD' && (
                        <button
                          onClick={() => setTradeType(engineAnalysis.short!.signal.action === 'BUY' ? 'buy' : 'sell')}
                          className="mt-2 w-full text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl py-2 transition-colors"
                        >
                          Apliko te porosia: {engineAnalysis.short.signal.action === 'BUY' ? 'BLEJ' : 'SHIT'}
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">Vendos porosi <span className="text-gray-500 text-xs font-normal">(LIVE në MT5)</span></h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    !metaConfigured ? 'bg-gray-700/50 text-gray-400 border-gray-600'
                    : mtMode === 'live' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                    : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                  }`}>
                    {!metaConfigured ? 'PA LIDHJE' : mtMode === 'live' ? 'LIVE' : 'DEMO'}
                  </span>
                </div>
                <div className="flex rounded-xl overflow-hidden border border-gray-700">
                  <button onClick={() => setTradeType('buy')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>BLEJ</button>
                  <button onClick={() => setTradeType('sell')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>SHIT</button>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1"><span className="text-gray-400 text-xs">Çmimi i tregut</span><span className="text-amber-400 text-xs">TREG</span></div>
                  <div className="text-white font-bold text-lg">{fp(selected)}</div>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">Lot (madhësia e porosisë)</label>
                  <input type="number" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="0.01" min="0.01" step="0.01"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {['0.01', '0.05', '0.10', '0.25'].map((v) => (
                    <button key={v} onClick={() => setLot(v)}
                      className={`text-xs py-1.5 rounded-lg transition-colors ${lot === v ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}>{v}</button>
                  ))}
                </div>

                {mtBalance != null && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Cloud className="w-3 h-3 text-amber-400" />Balanca reale MT5: <span className="text-amber-400 font-medium">${mtBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {!metaConfigured && (
                  <div className="flex items-start gap-2 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Lidh llogarinë tënde MT5 te <strong>MetaTrader / Auto-Trade</strong> për të tregtuar manual me para reale.
                  </div>
                )}

                {tradeMsg && (
                  <div className={`text-xs rounded-xl px-3 py-2 ${tradeMsg.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-red-900/30 text-red-400 border border-red-800/50'}`}>{tradeMsg.text}</div>
                )}
                <button onClick={handleTrade} disabled={tradeLoading || !metaConfigured || !lot || parseFloat(lot) <= 0}
                  className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
                  {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {tradeType === 'buy' ? 'BLEJ' : 'SHIT'} {selected.symbol}
                </button>
                <p className="text-[10px] text-gray-600 text-center">Porosia dërgohet direkt në MT5 përmes MetaApi. Mbylle te MetaTrader / Auto-Trade.</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">Zgjidh një aktiv për të nisur tregtimin</div>
        )}
      </div>
    </div>
  );
}
