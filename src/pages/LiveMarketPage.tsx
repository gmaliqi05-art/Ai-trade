import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, TrendingUp, TrendingDown, RefreshCw, Wifi, WifiOff,
  Monitor, Zap, Clock, BarChart2, ArrowUp, ArrowDown, Minus,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  category: string;
  current_price: number;
  price_change_24h: number;
  price_change_pct: number;
  updated_at: string | null;
}

interface MTData {
  id: string;
  symbol: string;
  timeframe: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  bar_time: string;
  indicators: {
    ma20?: number;
    ma50?: number;
    rsi14?: number;
    atr14?: number;
  };
  created_at: string;
  metatrader_connections?: {
    platform: string;
    server: string;
    is_active: boolean;
    last_ping_at: string | null;
  };
}

interface Signal {
  id: string;
  symbol: string;
  type: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  timeframe: string;
  analysis: string;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const catColors: Record<string, string> = {
  commodity: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  forex: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  crypto: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  stock: 'text-green-400 bg-green-500/10 border-green-500/20',
};

function formatPrice(price: number, category: string): string {
  if (category === 'forex') return price.toFixed(5);
  if (category === 'crypto') return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'Never';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function RSIBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = value >= 70 ? 'bg-red-400' : value <= 30 ? 'bg-green-400' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${value >= 70 ? 'text-red-400' : value <= 30 ? 'text-green-400' : 'text-amber-400'}`}>{value.toFixed(1)}</span>
    </div>
  );
}

export default function LiveMarketPage() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mtData, setMtData] = useState<MTData[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedMT, setExpandedMT] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from('assets')
      .select('*')
      .order('category')
      .order('symbol');
    if (data) setAssets(data as Asset[]);
  }, []);

  const fetchMTData = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('mt_market_data')
      .select('*, metatrader_connections(platform, server, is_active, last_ping_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setMtData(data as MTData[]);
  }, [user]);

  const fetchSignals = useCallback(async () => {
    const { data } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setSignals(data as Signal[]);
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAssets(), fetchMTData(), fetchSignals()]);
    setLastRefresh(new Date());
    setRefreshing(false);
  }, [fetchAssets, fetchMTData, fetchSignals]);

  const updatePrices = useCallback(async () => {
    setUpdating(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/update-prices`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      const result = await resp.json();
      if (result.success) {
        await fetchAssets();
        setLastRefresh(new Date());
      }
    } catch (e) {
      console.error('Price update failed:', e);
    }
    setUpdating(false);
  }, [fetchAssets]);

  useEffect(() => {
    refreshAll();
    intervalRef.current = setInterval(refreshAll, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshAll]);

  const latestMTBySymbol: Record<string, MTData> = {};
  for (const d of mtData) {
    if (!latestMTBySymbol[d.symbol]) latestMTBySymbol[d.symbol] = d;
  }

  const goldAsset = assets.find(a => a.symbol === 'XAUUSD');
  const goldMT = latestMTBySymbol['XAUUSD'];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-400" />Live Market Data
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Real-time prices and MetaTrader feed
            {lastRefresh && <span className="ml-2 text-gray-500">· Updated {timeAgo(lastRefresh.toISOString())}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={updatePrices}
            disabled={updating}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-3 py-2 rounded-xl text-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${updating ? 'animate-spin' : ''}`} />
            {updating ? 'Fetching...' : 'Fetch Prices'}
          </button>
          <button
            onClick={refreshAll}
            disabled={refreshing}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-3 py-2 rounded-xl text-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {goldAsset && (
        <div className="bg-gradient-to-r from-amber-900/30 to-amber-800/10 border border-amber-500/30 rounded-2xl p-5">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-400 text-xs font-semibold bg-amber-500/20 px-2 py-0.5 rounded-lg">XAUUSD</span>
                {goldMT?.metatrader_connections?.is_active && (
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <Wifi className="w-3 h-3" />MT Live
                  </span>
                )}
              </div>
              <div className="text-white text-4xl font-black tracking-tight">
                ${formatPrice(goldMT?.close_price || goldAsset.current_price, 'commodity')}
              </div>
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${goldAsset.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {goldAsset.price_change_pct >= 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                {goldAsset.price_change_pct >= 0 ? '+' : ''}{goldAsset.price_change_pct.toFixed(2)}%
                <span className="text-gray-500 font-normal text-xs ml-1">24h</span>
              </div>
            </div>
            {goldMT && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Open', value: goldMT.open_price?.toFixed(2) || '—' },
                  { label: 'High', value: goldMT.high_price?.toFixed(2) || '—' },
                  { label: 'Low', value: goldMT.low_price?.toFixed(2) || '—' },
                  { label: 'Volume', value: goldMT.volume?.toLocaleString() || '—' },
                ].map(s => (
                  <div key={s.label} className="bg-black/20 rounded-xl px-3 py-2">
                    <div className="text-gray-400 text-xs mb-0.5">{s.label}</div>
                    <div className="text-white font-bold text-sm">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {goldMT?.indicators && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {goldMT.indicators.ma20 && (
                <div className="bg-black/20 rounded-xl p-3">
                  <div className="text-gray-400 text-xs mb-1">MA 20</div>
                  <div className="text-white font-semibold text-sm">{goldMT.indicators.ma20.toFixed(2)}</div>
                  <div className={`text-xs mt-0.5 ${(goldMT.close_price || 0) > goldMT.indicators.ma20 ? 'text-green-400' : 'text-red-400'}`}>
                    {(goldMT.close_price || 0) > goldMT.indicators.ma20 ? 'Above' : 'Below'}
                  </div>
                </div>
              )}
              {goldMT.indicators.ma50 && (
                <div className="bg-black/20 rounded-xl p-3">
                  <div className="text-gray-400 text-xs mb-1">MA 50</div>
                  <div className="text-white font-semibold text-sm">{goldMT.indicators.ma50.toFixed(2)}</div>
                  <div className={`text-xs mt-0.5 ${(goldMT.close_price || 0) > goldMT.indicators.ma50 ? 'text-green-400' : 'text-red-400'}`}>
                    {(goldMT.close_price || 0) > goldMT.indicators.ma50 ? 'Above' : 'Below'}
                  </div>
                </div>
              )}
              {goldMT.indicators.rsi14 !== undefined && (
                <div className="bg-black/20 rounded-xl p-3">
                  <div className="text-gray-400 text-xs mb-2">RSI (14)</div>
                  <RSIBar value={goldMT.indicators.rsi14} />
                  <div className="text-gray-500 text-xs mt-1">
                    {goldMT.indicators.rsi14 >= 70 ? 'Overbought' : goldMT.indicators.rsi14 <= 30 ? 'Oversold' : 'Neutral'}
                  </div>
                </div>
              )}
              {goldMT.indicators.atr14 && (
                <div className="bg-black/20 rounded-xl p-3">
                  <div className="text-gray-400 text-xs mb-1">ATR (14)</div>
                  <div className="text-white font-semibold text-sm">{goldMT.indicators.atr14.toFixed(2)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Volatility</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-amber-400" />Market Prices
            </h3>
            <span className="text-gray-500 text-xs">Auto-refreshes every 30s</span>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 text-xs font-medium px-4 py-3">Symbol</th>
                  <th className="text-right text-gray-500 text-xs font-medium px-4 py-3">Price</th>
                  <th className="text-right text-gray-500 text-xs font-medium px-4 py-3">24h Change</th>
                  <th className="text-right text-gray-500 text-xs font-medium px-4 py-3 hidden sm:table-cell">MT Feed</th>
                  <th className="text-right text-gray-500 text-xs font-medium px-4 py-3 hidden md:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {assets.map(a => {
                  const mt = latestMTBySymbol[a.symbol];
                  const price = mt?.close_price || a.current_price;
                  const isUp = a.price_change_pct >= 0;
                  return (
                    <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${catColors[a.category] || 'text-gray-400 bg-gray-700 border-gray-600'}`}>
                            {a.symbol}
                          </span>
                          <span className="text-gray-400 text-xs hidden sm:inline truncate max-w-[120px]">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white font-bold text-sm">{formatPrice(price, a.category)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={`flex items-center justify-end gap-1 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                          {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span className="text-xs font-semibold">{isUp ? '+' : ''}{a.price_change_pct.toFixed(2)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        {mt ? (
                          <div className="flex items-center justify-end gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            <span className="text-green-400 text-xs">Live</span>
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="text-gray-500 text-xs">{timeAgo(mt?.created_at || a.updated_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />Active Signals
            </h3>
            <span className="text-gray-500 text-xs">{signals.length} active</span>
          </div>
          {signals.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
              <Zap className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No active signals</p>
              <p className="text-gray-600 text-xs mt-1">Connect MetaTrader to generate AI signals</p>
            </div>
          ) : (
            <div className="space-y-3">
              {signals.map(s => (
                <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-sm">{s.symbol}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {s.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${s.confidence >= 80 ? 'bg-green-400' : s.confidence >= 60 ? 'bg-amber-400' : 'bg-gray-400'}`} />
                      <span className="text-amber-400 text-xs font-bold">{s.confidence}%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {[
                      { label: 'Entry', value: s.entry_price?.toFixed(2) || '—', icon: Minus },
                      { label: 'Target', value: s.target_price?.toFixed(2) || '—', icon: ArrowUp },
                      { label: 'Stop', value: s.stop_loss?.toFixed(2) || '—', icon: ArrowDown },
                    ].map(item => {
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className="bg-gray-800/50 rounded-lg p-2 text-center">
                          <div className="flex items-center justify-center gap-1 text-gray-500 text-[10px] mb-0.5">
                            <Icon className="w-2.5 h-2.5" />{item.label}
                          </div>
                          <div className="text-white text-xs font-semibold">{item.value}</div>
                        </div>
                      );
                    })}
                  </div>
                  {s.analysis && (
                    <p className="text-gray-400 text-xs line-clamp-2">{s.analysis}</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-600 text-xs">TF: {s.timeframe}m</span>
                    <span className="text-gray-600 text-xs flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />{timeAgo(s.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {mtData.length > 0 && (
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-amber-400" />MetaTrader Live Feed
          </h3>
          <div className="space-y-3">
            {Object.values(latestMTBySymbol).map(d => {
              const conn = d.metatrader_connections;
              const isOnline = conn?.last_ping_at ? (Date.now() - new Date(conn.last_ping_at).getTime()) < 600000 : false;
              const expanded = expandedMT === d.id;
              return (
                <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors"
                    onClick={() => setExpandedMT(expanded ? null : d.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isOnline ? 'bg-green-500/20' : 'bg-gray-700/50'}`}>
                        {isOnline ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-gray-500" />}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold text-sm">{d.symbol}</span>
                          {conn && <span className="text-xs text-gray-500">{conn.platform} · {conn.server}</span>}
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          TF: {d.timeframe}m · {timeAgo(d.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-white font-bold">{d.close_price?.toFixed(2) || '—'}</div>
                        <div className={`text-xs ${d.close_price > d.open_price ? 'text-green-400' : 'text-red-400'}`}>
                          {d.close_price > d.open_price ? '▲' : '▼'} {Math.abs(d.close_price - d.open_price).toFixed(2)}
                        </div>
                      </div>
                      {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 border-t border-gray-800/50">
                      <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        {[
                          { label: 'Open', value: d.open_price?.toFixed(2) || '—' },
                          { label: 'High', value: d.high_price?.toFixed(2) || '—' },
                          { label: 'Low', value: d.low_price?.toFixed(2) || '—' },
                          { label: 'Close', value: d.close_price?.toFixed(2) || '—' },
                          { label: 'Volume', value: d.volume?.toLocaleString() || '—' },
                          { label: 'Bar Time', value: d.bar_time ? new Date(d.bar_time).toLocaleTimeString() : '—' },
                        ].map(s => (
                          <div key={s.label} className="bg-gray-800/50 rounded-xl p-3">
                            <div className="text-gray-500 text-xs mb-1">{s.label}</div>
                            <div className="text-white font-semibold text-sm">{s.value}</div>
                          </div>
                        ))}
                      </div>
                      {d.indicators && Object.keys(d.indicators).length > 0 && (
                        <div>
                          <div className="text-gray-500 text-xs font-medium mb-2 uppercase tracking-wider">Indicators</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {d.indicators.ma20 !== undefined && (
                              <div className="bg-gray-800/50 rounded-xl p-3">
                                <div className="text-gray-500 text-xs mb-1">MA 20</div>
                                <div className="text-white font-semibold text-sm">{d.indicators.ma20.toFixed(2)}</div>
                                <div className={`text-xs mt-0.5 ${d.close_price > d.indicators.ma20 ? 'text-green-400' : 'text-red-400'}`}>
                                  Price {d.close_price > d.indicators.ma20 ? 'above' : 'below'}
                                </div>
                              </div>
                            )}
                            {d.indicators.ma50 !== undefined && (
                              <div className="bg-gray-800/50 rounded-xl p-3">
                                <div className="text-gray-500 text-xs mb-1">MA 50</div>
                                <div className="text-white font-semibold text-sm">{d.indicators.ma50.toFixed(2)}</div>
                                <div className={`text-xs mt-0.5 ${d.close_price > d.indicators.ma50 ? 'text-green-400' : 'text-red-400'}`}>
                                  Price {d.close_price > d.indicators.ma50 ? 'above' : 'below'}
                                </div>
                              </div>
                            )}
                            {d.indicators.rsi14 !== undefined && (
                              <div className="bg-gray-800/50 rounded-xl p-3">
                                <div className="text-gray-500 text-xs mb-2">RSI (14)</div>
                                <RSIBar value={d.indicators.rsi14} />
                                <div className="text-gray-500 text-xs mt-1">
                                  {d.indicators.rsi14 >= 70 ? 'Overbought' : d.indicators.rsi14 <= 30 ? 'Oversold' : 'Neutral'}
                                </div>
                              </div>
                            )}
                            {d.indicators.atr14 !== undefined && (
                              <div className="bg-gray-800/50 rounded-xl p-3">
                                <div className="text-gray-500 text-xs mb-1">ATR (14)</div>
                                <div className="text-white font-semibold text-sm">{d.indicators.atr14.toFixed(2)}</div>
                                <div className="text-gray-500 text-xs mt-0.5">Avg True Range</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mtData.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <Monitor className="w-14 h-14 text-gray-700 mx-auto mb-4" />
          <h3 className="text-white font-semibold mb-2">No MetaTrader Data Yet</h3>
          <p className="text-gray-400 text-sm">
            Connect your MT4/MT5 account and install the Expert Advisor to see live market data here.
          </p>
        </div>
      )}
    </div>
  );
}
