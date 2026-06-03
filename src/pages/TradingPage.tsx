import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Search, Star, StarOff, ChevronUp, ChevronDown, RefreshCw, DollarSign, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useAssetAnalysis } from '../ai-trader/react/useAssetAnalysis';
import { EngineSignalCard } from '../ai-trader/react/EngineSignalCard';
import { requestEngineReasoning } from '../services/aiReasoning';
import TradingViewChart from '../components/TradingViewChart';

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
  const { user, profile, refreshProfile } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Asset | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [tradeType, setTradeType] = useState<TradeType>('buy');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchAssets();
    if (user) fetchWatchlist();
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

  const handleTrade = async () => {
    if (!user || !selected || !quantity) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return;
    setTradeLoading(true);
    setTradeMsg(null);
    const total = qty * selected.current_price;
    const fee = total * 0.001;

    if (tradeType === 'buy' && profile && total + fee > profile.balance) {
      setTradeMsg({ type: 'error', text: 'Balancë e pamjaftueshme për këtë tregti.' });
      setTradeLoading(false);
      return;
    }

    if (tradeType === 'sell') {
      const { data: pos } = await supabase.from('portfolio_positions').select('quantity').eq('user_id', user.id).eq('asset_id', selected.id).maybeSingle();
      const owned = pos?.quantity ?? 0;
      if (qty > owned) {
        setTradeMsg({ type: 'error', text: `Ke vetëm ${owned.toFixed(6)} ${selected.symbol}.` });
        setTradeLoading(false);
        return;
      }
    }

    const { error: te } = await supabase.from('trades').insert({ user_id: user.id, asset_id: selected.id, symbol: selected.symbol, type: tradeType, quantity: qty, price: selected.current_price, total, fee, status: 'executed', executed_at: new Date().toISOString() });
    if (te) { setTradeMsg({ type: 'error', text: 'Tregtia dështoi. Provo përsëri.' }); setTradeLoading(false); return; }

    const newBalance = tradeType === 'buy' ? (profile?.balance || 0) - total - fee : (profile?.balance || 0) + total - fee;
    await supabase.from('profiles').update({ balance: newBalance }).eq('id', user.id);

    const { data: ex } = await supabase.from('portfolio_positions').select('*').eq('user_id', user.id).eq('asset_id', selected.id).eq('status', 'open').maybeSingle();
    if (ex) {
      const nq = tradeType === 'buy' ? ex.quantity + qty : ex.quantity - qty;
      const newEntryPrice = tradeType === 'buy'
        ? (ex.entry_price * ex.quantity + selected.current_price * qty) / (ex.quantity + qty)
        : ex.entry_price;
      const unrealizedPnl = (selected.current_price - newEntryPrice) * nq;
      if (nq <= 0) {
        await supabase.from('portfolio_positions').update({ status: 'closed', closed_at: new Date().toISOString(), quantity: 0 }).eq('id', ex.id);
      } else {
        await supabase.from('portfolio_positions').update({ quantity: nq, entry_price: newEntryPrice, current_price: selected.current_price, unrealized_pnl: unrealizedPnl }).eq('id', ex.id);
      }
    } else if (tradeType === 'buy') {
      await supabase.from('portfolio_positions').insert({ user_id: user.id, asset_id: selected.id, symbol: selected.symbol, type: 'long', quantity: qty, entry_price: selected.current_price, current_price: selected.current_price, unrealized_pnl: 0, status: 'open', opened_at: new Date().toISOString() });
    }

    await refreshProfile();
    setTradeMsg({ type: 'success', text: `${tradeType === 'buy' ? 'U blenë' : 'U shitën'} ${qty} ${selected.symbol} me sukses.` });
    setQuantity('');
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
                        accountBalance={Number(profile?.balance) || 0}
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

                <h3 className="text-white font-semibold">Vendos porosi</h3>
                <div className="flex rounded-xl overflow-hidden border border-gray-700">
                  <button onClick={() => setTradeType('buy')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>BLEJ</button>
                  <button onClick={() => setTradeType('sell')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>SHIT</button>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1"><span className="text-gray-400 text-xs">Çmimi i tregut</span><span className="text-amber-400 text-xs">TREG</span></div>
                  <div className="text-white font-bold text-lg">{fp(selected)}</div>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">Sasia</label>
                  <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.00" min="0" step="any"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {['25%', '50%', '75%', '100%'].map((pct) => (
                    <button key={pct} onClick={() => { const p = parseFloat(pct) / 100; setQuantity(((profile?.balance || 0) * p / selected.current_price).toFixed(6)); }}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs py-1.5 rounded-lg transition-colors">{pct}</button>
                  ))}
                </div>
                {quantity && parseFloat(quantity) > 0 && (
                  <div className="bg-gray-800/50 rounded-xl p-3 space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Nëntotali</span><span className="text-white">${(parseFloat(quantity) * selected.current_price).toFixed(2)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Tarifa (0.1%)</span><span className="text-white">${(parseFloat(quantity) * selected.current_price * 0.001).toFixed(2)}</span></div>
                    <div className="flex justify-between text-xs font-semibold border-t border-gray-700 pt-1.5"><span className="text-gray-300">Totali</span><span className="text-white">${(parseFloat(quantity) * selected.current_price * 1.001).toFixed(2)}</span></div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <DollarSign className="w-3 h-3" />Balanca: <span className="text-amber-400 font-medium">${(profile?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                {tradeMsg && (
                  <div className={`text-xs rounded-xl px-3 py-2 ${tradeMsg.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-red-900/30 text-red-400 border border-red-800/50'}`}>{tradeMsg.text}</div>
                )}
                <button onClick={handleTrade} disabled={tradeLoading || !quantity || parseFloat(quantity) <= 0}
                  className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
                  {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {tradeType === 'buy' ? 'BLEJ' : 'SHIT'} {selected.symbol}
                </button>
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
