import { useEffect, useState, useRef } from 'react';
import {
  Brain, Zap, TrendingUp, TrendingDown, Upload,
  Activity, ArrowRight, Monitor, RefreshCw, Wifi, WifiOff,
  CheckCircle, AlertTriangle, BarChart3
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage as Page } from '../App';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  category: string;
  current_price: number;
  price_change_24h: number;
  price_change_pct: number;
}

interface Signal {
  id: string;
  type: string;
  symbol: string;
  confidence: number;
  timeframe: string;
  analysis: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  created_at: string;
}

interface MTConnection {
  id: string;
  is_active: boolean;
  symbol: string;
  last_data_at: string | null;
  last_ping_at: string | null;
}

const catColor: Record<string, string> = {
  commodity: 'bg-amber-500/15 text-amber-400',
  forex: 'bg-blue-500/15 text-blue-400',
  crypto: 'bg-orange-500/15 text-orange-400',
  stock: 'bg-green-500/15 text-green-400',
};

export default function DashboardPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { user, profile } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [mtConnections, setMTConnections] = useState<MTConnection[]>([]);
  const [aiProviderActive, setAIProviderActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    const queries: Promise<unknown>[] = [
      supabase.from('assets').select('id, symbol, name, category, current_price, price_change_24h, price_change_pct').order('category').limit(8),
      supabase.from('signals').select('id, type, symbol, confidence, timeframe, analysis, entry_price, target_price, stop_loss, created_at').eq('status', 'active').order('confidence', { ascending: false }).limit(5),
      supabase.from('ai_providers').select('id').eq('is_active', true).limit(1),
    ];
    if (user) {
      queries.push(
        supabase.from('metatrader_connections').select('id, is_active, symbol, last_data_at, last_ping_at').eq('user_id', user.id).limit(5),
      );
    }
    const [ar, sr, pr, mtr] = await Promise.all(queries) as [
      { data: Asset[] | null },
      { data: Signal[] | null },
      { data: unknown[] | null },
      { data: MTConnection[] | null } | undefined,
    ];
    if (ar.data) setAssets(ar.data);
    if (sr.data) setSignals(sr.data);
    if (pr.data) setAIProviderActive(pr.data.length > 0);
    if (mtr?.data) setMTConnections(mtr.data);
    setLastUpdated(new Date());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const activeMT = mtConnections.filter(c => c.is_active).length;
  const recentMT = mtConnections.filter(c => {
    if (!c.last_data_at) return false;
    return Date.now() - new Date(c.last_data_at).getTime() < 10 * 60 * 1000;
  }).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Welcome, {profile?.full_name?.split(' ')[0] || 'Trader'}
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            AI-powered market analysis and signal generation platform
            {lastUpdated && (
              <span className="ml-2 text-gray-600 text-xs">
                · updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          label="AI Providers"
          value={aiProviderActive ? 'Active' : 'Not configured'}
          sub={aiProviderActive ? 'Ready to analyze' : 'Add API key in Admin'}
          icon={Brain}
          status={aiProviderActive ? 'ok' : 'warn'}
          onClick={() => onNavigate('ai')}
        />
        <StatusCard
          label="Active Signals"
          value={signals.length.toString()}
          sub="AI generated signals"
          icon={Zap}
          status={signals.length > 0 ? 'ok' : 'neutral'}
          onClick={() => onNavigate('signals')}
        />
        <StatusCard
          label="MetaTrader Feed"
          value={activeMT > 0 ? `${activeMT} active` : 'Not connected'}
          sub={recentMT > 0 ? `${recentMT} with recent data` : 'Connect for live data'}
          icon={Monitor}
          status={activeMT > 0 ? 'ok' : 'neutral'}
          onClick={() => onNavigate('metatrader')}
        />
        <StatusCard
          label="Assets Tracked"
          value={assets.length.toString()}
          sub="Live price feed"
          icon={Activity}
          status="neutral"
          onClick={() => onNavigate('market_prices')}
        />
      </div>

      {!aiProviderActive && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-amber-300 font-semibold text-sm">AI Analysis not yet configured</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              An administrator needs to add an API key in <strong>Admin Panel → AI Providers</strong>.
              Groq is completely free — get a key at console.groq.com in under 2 minutes.
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />Market Prices
              </h3>
              <button onClick={() => onNavigate('market_prices')} className="text-amber-400 text-xs hover:text-amber-300 transition-colors flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {loading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-11 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : (
              <div className="space-y-1">
                {assets.slice(0, 6).map(a => (
                  <button
                    key={a.id}
                    onClick={() => onNavigate('market_prices')}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 rounded-xl transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${catColor[a.category] || 'text-gray-400 bg-gray-700'}`}>
                        {a.symbol}
                      </span>
                      <span className="text-gray-400 text-sm group-hover:text-gray-300 transition-colors truncate max-w-[130px]">
                        {a.name}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white font-semibold text-sm">
                        {a.category === 'forex'
                          ? a.current_price.toFixed(5)
                          : a.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                      <div className={`text-xs flex items-center justify-end gap-0.5 ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {a.price_change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-blue-400" />MetaTrader Connection
            </h3>
            {mtConnections.length === 0 ? (
              <div className="bg-gray-800/50 rounded-xl p-4 flex items-start gap-3">
                <WifiOff className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-gray-300 text-sm font-medium">No MT4/MT5 connected</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Connect your MetaTrader account to send live OHLCV data and get deeper AI analysis with real indicators.
                  </p>
                  <button
                    onClick={() => onNavigate('metatrader')}
                    className="mt-2 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    Connect now <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {mtConnections.map(c => {
                  const isRecent = c.last_data_at && Date.now() - new Date(c.last_data_at).getTime() < 10 * 60 * 1000;
                  return (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-800/50 rounded-xl">
                      <div className="flex items-center gap-2">
                        {c.is_active ? (
                          <Wifi className="w-4 h-4 text-green-400" />
                        ) : (
                          <WifiOff className="w-4 h-4 text-gray-500" />
                        )}
                        <span className="text-white text-sm font-medium">{c.symbol}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                          {c.is_active ? 'active' : 'inactive'}
                        </span>
                      </div>
                      {isRecent ? (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />live data
                        </span>
                      ) : c.last_data_at ? (
                        <span className="text-xs text-gray-500">
                          {new Date(c.last_data_at).toLocaleTimeString()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">no data yet</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />Latest Signals
              </h3>
              <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300 flex items-center gap-1">
                All signals <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {loading ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : signals.length === 0 ? (
              <div className="text-center py-8">
                <Zap className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No active signals</p>
                <p className="text-gray-600 text-xs mt-1">Generate signals via AI Analysis</p>
                <button
                  onClick={() => onNavigate('ai')}
                  className="mt-3 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mx-auto"
                >
                  <Brain className="w-3 h-3" />Go to AI Analysis
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {signals.map(s => (
                  <button
                    key={s.id}
                    onClick={() => onNavigate('signals')}
                    className="w-full bg-gray-800/50 rounded-xl p-3 border border-gray-700/50 hover:border-gray-600 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-bold">{s.symbol}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {s.type}
                        </span>
                      </div>
                      <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                    </div>
                    {(s.entry_price || s.target_price) && (
                      <div className="flex items-center gap-3 mb-1.5 text-xs">
                        {s.entry_price && <span className="text-gray-400">Entry: <span className="text-white">{s.entry_price}</span></span>}
                        {s.target_price && <span className="text-gray-400">Target: <span className="text-green-400">{s.target_price}</span></span>}
                        {s.stop_loss && <span className="text-gray-400">SL: <span className="text-red-400">{s.stop_loss}</span></span>}
                      </div>
                    )}
                    <p className="text-gray-500 text-xs line-clamp-1">{s.analysis}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-gray-600 text-xs">{s.timeframe}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 text-sm">Quick Actions</h3>
            <div className="space-y-2">
              {[
                { label: 'Upload Chart for AI Analysis', icon: Upload, page: 'chart_analysis' as Page, color: 'bg-amber-500 hover:bg-amber-400 text-gray-950', bold: true },
                { label: 'Run AI Analysis', icon: Brain, page: 'ai' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
                { label: 'View All Signals', icon: Zap, page: 'signals' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
                { label: 'Connect MetaTrader', icon: Monitor, page: 'metatrader' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
                { label: 'Market Prices', icon: BarChart3, page: 'market_prices' as Page, color: 'bg-gray-800 hover:bg-gray-700 text-white', bold: false },
              ].map(a => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.label}
                    onClick={() => onNavigate(a.page)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${a.color}`}
                  >
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

function StatusCard({
  label, value, sub, icon: Icon, status, onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  status: 'ok' | 'warn' | 'neutral';
  onClick: () => void;
}) {
  const colors = {
    ok: { bg: 'bg-green-500/10', icon: 'text-green-400', dot: 'bg-green-400' },
    warn: { bg: 'bg-amber-500/10', icon: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
    neutral: { bg: 'bg-gray-700/50', icon: 'text-gray-400', dot: 'bg-gray-500' },
  }[status];

  return (
    <button
      onClick={onClick}
      className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 text-left transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-xs font-medium">{label}</span>
        <div className={`w-8 h-8 ${colors.bg} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${colors.icon}`} />
        </div>
      </div>
      <div className="text-lg font-bold text-white mb-1">{value}</div>
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
        <span className="text-xs text-gray-500">{sub}</span>
      </div>
    </button>
  );
}
