import { useEffect, useState, useRef } from 'react';
import {
  Brain, Zap, TrendingUp, TrendingDown, Upload,
  Activity, ArrowRight, RefreshCw, Wifi, WifiOff,
  AlertTriangle, BarChart3, Cloud, ShieldCheck
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage as Page } from '../App';
import TradingViewChart from '../components/TradingViewChart';
import GoldSessionBadge from '../components/GoldSessionBadge';
import { loadOpenPositions, type OpenPosition } from '../services/metaapi';

interface Asset {
  id: string; symbol: string; name: string; category: string;
  current_price: number; price_change_24h: number; price_change_pct: number;
}
interface Signal {
  id: string; type: string; symbol: string; confidence: number; timeframe: string;
  analysis: string; entry_price: number | null; target_price: number | null;
  stop_loss: number | null; source: string; created_at: string;
}
interface MetaApiCfg { auto_trade: boolean; mode: string; kill_switch: boolean; account_id: string; }

const catColor: Record<string, string> = {
  commodity: 'bg-amber-500/15 text-amber-400',
  forex: 'bg-blue-500/15 text-blue-400',
  crypto: 'bg-orange-500/15 text-orange-400',
  stock: 'bg-green-500/15 text-green-400',
};

const sourceLabel: Record<string, string> = {
  engine: 'Motori', ai_analysis: 'Claude AI', ai_chart: 'Grafik AI',
  metatrader_ai: 'MetaTrader', ai: 'AI',
};

export default function DashboardPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { user, profile } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [aiProviderActive, setAIProviderActive] = useState(false);
  const [metaApi, setMetaApi] = useState<MetaApiCfg | null>(null);
  const [autoTradesToday, setAutoTradesToday] = useState(0);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chartTf, setChartTf] = useState('15m');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const queries: PromiseLike<unknown>[] = [
      supabase.from('assets').select('id, symbol, name, category, current_price, price_change_24h, price_change_pct').order('category').limit(8),
      supabase.from('signals').select('id, type, symbol, confidence, timeframe, analysis, entry_price, target_price, stop_loss, source, created_at').eq('status', 'active').order('created_at', { ascending: false }).limit(6),
      supabase.from('ai_providers').select('id').eq('is_active', true).limit(1),
    ];
    if (user) {
      queries.push(
        supabase.from('metaapi_config').select('auto_trade, mode, kill_switch, account_id').eq('user_id', user.id).maybeSingle(),
        supabase.from('trade_executions').select('id', { count: 'exact' }).eq('user_id', user.id).eq('status', 'executed').gte('created_at', startOfDay.toISOString()),
      );
    }
    const res = await Promise.all(queries) as Array<{ data: unknown; count?: number }>;
    const [ar, sr, pr, mac, ter] = res;
    if (ar?.data) setAssets([...(ar.data as Asset[])].sort((a, b) => (a.symbol === 'XAUUSD' ? 0 : a.category === 'commodity' ? 1 : 2) - (b.symbol === 'XAUUSD' ? 0 : b.category === 'commodity' ? 1 : 2)));
    if (sr?.data) setSignals(sr.data as Signal[]);
    if (pr?.data) setAIProviderActive((pr.data as unknown[]).length > 0);
    const cfg = (mac?.data as MetaApiCfg) ?? null;
    setMetaApi(cfg);
    setAutoTradesToday(ter?.count ?? 0);
    // Pozicionet e hapura REALE nga MT5 (vetëm nëse ka llogari të lidhur).
    if (cfg?.account_id) {
      const pr2 = await loadOpenPositions();
      setPositions(!pr2.error && Array.isArray(pr2.positions) ? pr2.positions : []);
    } else {
      setPositions([]);
    }
    setLastUpdated(new Date());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const autoTradeOn = metaApi?.auto_trade && !!metaApi?.account_id && !metaApi?.kill_switch;
  const totalPnl = positions.reduce((s, p) => s + Number(p.profit ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-white">
              Mirë se erdhe, {profile?.full_name?.split(' ')[0] || 'Trader'}
            </h2>
            {metaApi?.account_id ? (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                metaApi.mode === 'live'
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
              }`}>
                {metaApi.mode === 'live' ? '● LIVE · para reale' : '● DEMO'}
              </span>
            ) : (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-700/50 text-gray-400 border-gray-600">
                Pa llogari trade
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Platformë analize tregu dhe sinjalesh me AI
            {lastUpdated && <span className="ml-2 text-gray-600 text-xs">· përditësuar {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GoldSessionBadge />
          <button onClick={fetchData} className="flex items-center gap-2 text-gray-400 hover:text-white text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-all">
            <RefreshCw className="w-3.5 h-3.5" />Rifresko
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard label="Sinjale aktive" value={signals.length.toString()} sub="Nga motori + AI" icon={Zap}
          status={signals.length > 0 ? 'ok' : 'neutral'} onClick={() => onNavigate('signals')} />
        <StatusCard label="Auto-Trade" value={autoTradeOn ? `Aktiv · ${metaApi?.mode?.toUpperCase()}` : 'I fikur'}
          sub={metaApi?.account_id ? `${positions.length} aktive · ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}` : 'Konfiguro lidhjen'} icon={Cloud}
          status={autoTradeOn ? 'ok' : 'neutral'} onClick={() => onNavigate('market_prices')} />
        <StatusCard label="Arsyetimi AI (Claude)" value={aiProviderActive ? 'Gati' : 'Pa konfiguruar'}
          sub={aiProviderActive ? 'Provider aktiv' : 'Shto çelës te Admin'} icon={Brain}
          status={aiProviderActive ? 'ok' : 'warn'} onClick={() => onNavigate('chart_analysis')} />
        <StatusCard label="Aktive të ndjekur" value={assets.length.toString()} sub="Çmime reale" icon={Activity}
          status="neutral" onClick={() => onNavigate('market_prices')} />
      </div>

      {!aiProviderActive && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-amber-300 font-semibold text-sm">Arsyetimi me Claude AI s'është konfiguruar</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              Një administrator duhet të shtojë një çelës API te <strong>Admin → AI Providers</strong> (Anthropic).
              Motori matematik punon edhe pa të; çelësi shton arsyetimin cilësor të Claude.
            </p>
          </div>
        </div>
      )}

      {/* Grafiku kryesor — Ari (XAUUSD) nga TradingView */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 flex-wrap gap-2">
          <h3 className="text-white font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-amber-400" />Ari — XAU/USD</h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
              {[
                { v: '1m', l: '1m' }, { v: '5m', l: '5m' }, { v: '15m', l: '15m' },
                { v: '1h', l: '1h' }, { v: '4h', l: '4h' }, { v: '1d', l: '1D' },
              ].map(t => (
                <button key={t.v} onClick={() => setChartTf(t.v)}
                  className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${chartTf === t.v ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>
                  {t.l}
                </button>
              ))}
            </div>
            <button onClick={() => onNavigate('market_prices')} className="text-amber-400 text-xs hover:text-amber-300 flex items-center gap-1">Tregto <ArrowRight className="w-3 h-3" /></button>
          </div>
        </div>
        <div className="h-[440px]"><TradingViewChart symbol="XAUUSD" timeframe={chartTf} /></div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          {/* Çmimet e tregut */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" />Çmimet e tregut</h3>
              <button onClick={() => onNavigate('market_prices')} className="text-amber-400 text-xs hover:text-amber-300 transition-colors flex items-center gap-1">Të gjitha <ArrowRight className="w-3 h-3" /></button>
            </div>
            {loading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-11 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : (
              <div className="space-y-1">
                {assets.slice(0, 6).map(a => (
                  <button key={a.id} onClick={() => onNavigate('market_prices')} className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 rounded-xl transition-colors group">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${catColor[a.category] || 'text-gray-400 bg-gray-700'}`}>{a.symbol}</span>
                      <span className="text-gray-400 text-sm group-hover:text-gray-300 transition-colors truncate max-w-[130px]">{a.name}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white font-semibold text-sm">{a.category === 'forex' ? a.current_price.toFixed(5) : a.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                      <div className={`text-xs flex items-center justify-end gap-0.5 ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {a.price_change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {a.price_change_pct >= 0 ? '+' : ''}{Number(a.price_change_pct).toFixed(2)}%
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Statusi MetaTrader / Auto-Trade */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Cloud className="w-4 h-4 text-blue-400" />Auto-Trade (MetaTrader)</h3>
            {!metaApi?.account_id ? (
              <div className="bg-gray-800/50 rounded-xl p-4 flex items-start gap-3">
                <WifiOff className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-gray-300 text-sm font-medium">MetaTrader s'është i lidhur</p>
                  <p className="text-gray-500 text-xs mt-0.5">Lidh llogarinë tënde MT5 (via MetaApi) për ekzekutim automatik me mbrojtje rreziku — demo i pari.</p>
                  <button onClick={() => onNavigate('metatrader')} className="mt-2 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">Lidh tani <ArrowRight className="w-3 h-3" /></button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2.5 bg-gray-800/50 rounded-xl">
                  <span className="flex items-center gap-2 text-sm">
                    {autoTradeOn ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-gray-500" />}
                    <span className="text-white font-medium">Auto-Trade</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${autoTradeOn ? 'bg-green-500/15 text-green-400' : 'bg-gray-700 text-gray-400'}`}>{autoTradeOn ? 'aktiv' : 'i fikur'}</span>
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${metaApi?.mode === 'demo' ? 'bg-blue-500/15 text-blue-400' : 'bg-red-500/15 text-red-400'}`}>{metaApi?.mode?.toUpperCase()}</span>
                </div>
                {metaApi?.kill_switch && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                    <ShieldCheck className="w-4 h-4" />Kill-switch aktiv — tregtitë e bllokuara.
                  </div>
                )}
                {/* Pozicionet aktive REALE + fitim/humbje live */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-800/50 rounded-xl px-3 py-2 text-center">
                    <div className="text-gray-500 text-[10px]">Aktive tani</div>
                    <div className="text-white font-bold text-sm">{positions.length}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-xl px-3 py-2 text-center">
                    <div className="text-gray-500 text-[10px]">Fitim/Humbje</div>
                    <div className={`font-bold text-sm ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-xl px-3 py-2 text-center">
                    <div className="text-gray-500 text-[10px]">Ekzekutime sot</div>
                    <div className="text-white font-bold text-sm">{autoTradesToday}</div>
                  </div>
                </div>
                {positions.length > 0 && (
                  <div className="space-y-1">
                    {positions.slice(0, 4).map(p => {
                      const isBuy = (p.type || '').includes('BUY');
                      const profit = Number(p.profit ?? 0);
                      return (
                        <div key={p.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? 'BLEJ' : 'SHIT'}</span>
                            <span className="text-white">{p.symbol}</span>
                            <span className="text-gray-500">{p.volume} lot</span>
                          </span>
                          <span className={`font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{profit >= 0 ? '+' : ''}{profit.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button onClick={() => onNavigate('market_prices')} className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">Menaxho te Tregto Live <ArrowRight className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {/* Sinjalet e fundit */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Sinjalet e fundit</h3>
              <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300 flex items-center gap-1">Të gjitha <ArrowRight className="w-3 h-3" /></button>
            </div>
            {loading ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : signals.length === 0 ? (
              <div className="text-center py-8">
                <Zap className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">Asnjë sinjal aktiv</p>
                <p className="text-gray-600 text-xs mt-1">Shiko tab-in "Motori AI" te Sinjalet</p>
                <button onClick={() => onNavigate('signals')} className="mt-3 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mx-auto"><Zap className="w-3 h-3" />Shko te Sinjalet</button>
              </div>
            ) : (
              <div className="space-y-2">
                {signals.map(s => (
                  <button key={s.id} onClick={() => onNavigate('signals')} className="w-full bg-gray-800/50 rounded-xl p-3 border border-gray-700/50 hover:border-gray-600 transition-colors text-left">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-bold">{s.symbol}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? 'BLEJ' : s.type === 'sell' ? 'SHIT' : s.type}</span>
                        <span className="text-[10px] text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">{sourceLabel[s.source] || s.source}</span>
                      </div>
                      <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                    </div>
                    {(s.entry_price || s.target_price) && (
                      <div className="flex items-center gap-3 mb-1 text-xs flex-wrap">
                        {s.entry_price && <span className="text-gray-400">Hyrje: <span className="text-white">{Number(s.entry_price).toLocaleString()}</span></span>}
                        {s.target_price && <span className="text-gray-400">Objektiv: <span className="text-green-400">{Number(s.target_price).toLocaleString()}</span></span>}
                        {s.stop_loss && <span className="text-gray-400">Stop: <span className="text-red-400">{Number(s.stop_loss).toLocaleString()}</span></span>}
                      </div>
                    )}
                    <p className="text-gray-500 text-xs line-clamp-1">{s.analysis}</p>
                    <div className="text-[10px] text-gray-600 mt-1">🕒 Gjeneruar: {new Date(s.created_at).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Veprime të shpejta */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 text-sm">Veprime të shpejta</h3>
            <div className="space-y-2">
              {[
                { label: 'Shiko sinjalet (Motori AI)', icon: Zap, page: 'signals' as Page, color: 'bg-amber-500 hover:bg-amber-400 text-gray-950', bold: true },
                { label: 'Lidh / menaxho Auto-Trade', icon: Cloud, page: 'metatrader' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
                { label: 'Analizo grafik me AI', icon: Upload, page: 'chart_analysis' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
                { label: 'Çmimet e tregut', icon: BarChart3, page: 'market_prices' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
              ].map(a => {
                const Icon = a.icon;
                return (
                  <button key={a.label} onClick={() => onNavigate(a.page)} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${a.color}`}>
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className={a.bold ? 'font-semibold' : 'font-medium'}>{a.label}</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-auto opacity-60" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ label, value, sub, icon: Icon, status, onClick }: {
  label: string; value: string; sub: string; icon: React.ElementType;
  status: 'ok' | 'warn' | 'neutral'; onClick: () => void;
}) {
  const colors = {
    ok: { bg: 'bg-green-500/10', icon: 'text-green-400', dot: 'bg-green-400' },
    warn: { bg: 'bg-amber-500/10', icon: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
    neutral: { bg: 'bg-gray-700/50', icon: 'text-gray-400', dot: 'bg-gray-500' },
  }[status];
  return (
    <button onClick={onClick} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left transition-all group">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-gray-400 text-xs font-medium truncate">{label}</span>
        <div className={`w-6 h-6 ${colors.bg} rounded-lg flex items-center justify-center flex-shrink-0`}><Icon className={`w-3.5 h-3.5 ${colors.icon}`} /></div>
      </div>
      <div className="text-base font-bold text-white leading-tight">{value}</div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.dot}`} />
        <span className="text-[11px] text-gray-500 truncate">{sub}</span>
      </div>
    </button>
  );
}
