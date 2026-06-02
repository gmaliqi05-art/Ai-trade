import { useEffect, useState, useCallback } from 'react';
import {
  Brain, Loader2, TrendingUp, TrendingDown, Minus, ChevronRight,
  Sparkles, BarChart3, AlertTriangle, CheckCircle, ArrowUp, ArrowDown,
  Wifi, WifiOff, Info, RefreshCw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface Asset {
  id: string;
  symbol: string;
  name: string;
  category: string;
  current_price: number;
  price_change_pct: number;
}

interface Analysis {
  id: string;
  asset_id: string | null;
  analysis_text: string;
  sentiment: string;
  prediction: string;
  confidence: number;
  created_at: string;
  assets?: { symbol: string; name: string } | null;
}

interface AIResult {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  analysis_text: string;
  reasoning: string;
  key_levels: string[];
  indicators_summary: string;
  provider_used: string;
  current_price: number;
  has_mt_data: boolean;
  data_points: number;
  asset: { symbol: string; name: string };
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  model: string;
}

const catColor: Record<string, string> = {
  commodity: 'text-amber-400',
  forex: 'text-blue-400',
  crypto: 'text-orange-400',
  stock: 'text-green-400',
};

const providerLabels: Record<string, string> = {
  groq: 'Groq (Free)',
  openai: 'OpenAI GPT-4',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
};

export default function AIAnalysisPage() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [generating, setGenerating] = useState(false);
  const [currentResult, setCurrentResult] = useState<AIResult | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noProviders, setNoProviders] = useState(false);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [preferredProvider, setPreferredProvider] = useState<string>('');

  const fetchData = useCallback(async () => {
    const [ar, anlr, pr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, category, current_price, price_change_pct').order('category').order('symbol'),
      user ? supabase.from('ai_analyses').select('*, assets(symbol, name)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
      supabase.from('ai_providers').select('id, name, slug, is_active, model').order('priority'),
    ]);
    if (ar.data) { setAssets(ar.data); if (!selectedAsset) setSelectedAsset(ar.data[0]); }
    if (anlr.data) setAnalyses(anlr.data as Analysis[]);
    if (pr.data) {
      setProviders(pr.data as AIProvider[]);
      const active = pr.data.filter((p: AIProvider) => p.is_active);
      setNoProviders(active.length === 0);
    }
    setLoading(false);
  }, [user, selectedAsset]);

  useEffect(() => { fetchData(); }, [user]);

  const generate = async () => {
    if (!selectedAsset || !user) return;
    setGenerating(true);
    setError(null);
    setSelectedHistory(null);
    setCurrentResult(null);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          symbol: selectedAsset.symbol,
          asset_id: selectedAsset.id,
          preferred_provider: preferredProvider || undefined,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        if (data.error === 'no_active_providers') {
          setNoProviders(true);
          setError('No active AI providers. Ask your admin to configure an API key in the Admin panel.');
        } else if (data.error === 'all_providers_failed') {
          setError('All AI providers failed. API keys may be invalid. Contact your administrator.');
        } else {
          setError(data.message || data.error || 'Analysis failed');
        }
        return;
      }

      if (data.success && data.analysis) {
        setCurrentResult(data.analysis as AIResult);
        await fetchData();
      }
    } catch (e) {
      setError((e as Error).message || 'Network error');
    } finally {
      setGenerating(false);
    }
  };

  const sentIcon = (s: string) =>
    s === 'bullish' || s === 'buy' ? <TrendingUp className="w-4 h-4 text-green-400" /> :
    s === 'bearish' || s === 'sell' ? <TrendingDown className="w-4 h-4 text-red-400" /> :
    <Minus className="w-4 h-4 text-gray-400" />;

  const sentColor = (s: string) =>
    s === 'bullish' || s === 'buy' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
    s === 'bearish' || s === 'sell' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    'text-gray-400 bg-gray-700/50 border-gray-600';

  const signalBadge = (signal: string) => {
    if (signal === 'buy') return 'bg-green-500/20 text-green-400 border border-green-500/30';
    if (signal === 'sell') return 'bg-red-500/20 text-red-400 border border-red-500/30';
    return 'bg-gray-700/50 text-gray-400 border border-gray-600';
  };

  const activeProviders = providers.filter(p => p.is_active);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
          <Brain className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">AI Analysis</h2>
          <p className="text-gray-400 text-sm">Real-time AI-powered market analysis using live data</p>
        </div>
        {activeProviders.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 text-green-400 text-xs px-3 py-1.5 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {activeProviders.length} provider{activeProviders.length > 1 ? 's' : ''} active
          </div>
        )}
      </div>

      {noProviders && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-amber-300 font-semibold text-sm">No AI Providers Configured</div>
            <div className="text-amber-400/80 text-xs mt-1">
              Ask your administrator to add an API key in <strong>Admin Panel → AI Providers</strong>.
              Groq is free and requires only a free API key from <strong>console.groq.com</strong>.
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 text-sm">Select Asset</h3>
            {loading ? (
              <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />)}</div>
            ) : (
              <div className="space-y-1">
                {assets.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setSelectedAsset(a); setCurrentResult(null); setSelectedHistory(null); setError(null); }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${selectedAsset?.id === a.id ? 'bg-amber-500/10 border border-amber-500/30 text-white' : 'hover:bg-gray-800 text-gray-400 hover:text-white'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${catColor[a.category] || 'text-white'}`}>{a.symbol}</span>
                      <span className="text-xs text-gray-500 truncate max-w-[80px]">{a.name.split('/')[0].trim()}</span>
                    </div>
                    <span className={`text-xs ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeProviders.length > 1 && (
              <div className="mt-3">
                <label className="text-xs text-gray-500 block mb-1.5">AI Provider</label>
                <select
                  value={preferredProvider}
                  onChange={e => setPreferredProvider(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="">Auto (best available)</option>
                  {activeProviders.map(p => (
                    <option key={p.id} value={p.slug}>{providerLabels[p.slug] || p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={generate}
              disabled={generating || !selectedAsset || noProviders}
              className="w-full mt-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-all"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4" />Generate Real Analysis</>
              )}
            </button>

            {selectedAsset && (
              <div className="mt-3 bg-gray-800/40 rounded-xl p-3">
                <div className="text-gray-500 text-xs mb-1">Current Price</div>
                <div className="text-white font-bold">
                  {selectedAsset.category === 'forex'
                    ? selectedAsset.current_price.toFixed(5)
                    : selectedAsset.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className={`text-xs mt-0.5 flex items-center gap-1 ${selectedAsset.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {selectedAsset.price_change_pct >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  {selectedAsset.price_change_pct >= 0 ? '+' : ''}{selectedAsset.price_change_pct.toFixed(2)}% 24h
                </div>
              </div>
            )}
          </div>

          {analyses.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold text-sm">Recent Analyses</h3>
                <button onClick={fetchData} className="text-gray-500 hover:text-white transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-2">
                {analyses.slice(0, 8).map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setSelectedHistory(a); setCurrentResult(null); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all hover:bg-gray-800 ${selectedHistory?.id === a.id ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
                  >
                    <div className="flex items-center gap-2">
                      {sentIcon(a.sentiment)}
                      <span className="font-medium">{a.assets?.symbol}</span>
                      <span className="text-gray-600 text-xs">{a.confidence}%</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-gray-600" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {generating ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[400px]">
              <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center">
                <Brain className="w-8 h-8 text-amber-400 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">Analyzing {selectedAsset?.symbol}...</p>
                <p className="text-gray-400 text-sm mt-1">Fetching live market data and running AI analysis</p>
              </div>
              <div className="space-y-1 text-center text-xs text-gray-600">
                <p>Reading live prices from database</p>
                <p>Checking MetaTrader feed for real OHLCV data</p>
                <p>Running technical indicator analysis</p>
              </div>
              <div className="flex gap-1">{[0, 1, 2].map(i => <div key={i} className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
            </div>
          ) : error ? (
            <div className="bg-gray-900 border border-red-500/20 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[300px]">
              <AlertTriangle className="w-12 h-12 text-red-400/60" />
              <div className="text-center">
                <p className="text-red-400 font-semibold mb-2">Analysis Failed</p>
                <p className="text-gray-400 text-sm">{error}</p>
              </div>
              <button onClick={generate} disabled={noProviders} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm transition-all disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5" />Try Again
              </button>
            </div>
          ) : currentResult ? (
            <RealAnalysisCard result={currentResult} sentColor={sentColor} sentIcon={sentIcon} signalBadge={signalBadge} />
          ) : selectedHistory ? (
            <HistoryAnalysisCard analysis={selectedHistory} sentColor={sentColor} sentIcon={sentIcon} />
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[400px]">
              <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center">
                <Brain className="w-8 h-8 text-gray-600" />
              </div>
              <div className="text-center">
                <p className="text-gray-400 font-medium">Select an asset and generate a real AI analysis</p>
                <p className="text-gray-600 text-sm mt-1">
                  {noProviders
                    ? 'Configure an AI provider in Admin Panel first'
                    : 'Uses live market data and MetaTrader feed if connected'}
                </p>
              </div>
              {!noProviders && (
                <div className="bg-gray-800/50 rounded-xl p-4 max-w-sm text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-blue-400" />
                    <span className="text-blue-400 text-xs font-semibold">How it works</span>
                  </div>
                  <p className="text-gray-500 text-xs">
                    The AI reads live prices from the database. If you have MetaTrader connected,
                    it also uses your real OHLCV bars and indicators for a deeper analysis.
                  </p>
                </div>
              )}
              <button
                onClick={generate}
                disabled={!selectedAsset || noProviders}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-6 py-2.5 rounded-xl text-sm flex items-center gap-2 transition-all"
              >
                <Sparkles className="w-4 h-4" />Analyze {selectedAsset?.symbol}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RealAnalysisCard({
  result,
  sentColor,
  sentIcon,
  signalBadge,
}: {
  result: AIResult;
  sentColor: (s: string) => string;
  sentIcon: (s: string) => React.ReactNode;
  signalBadge: (s: string) => string;
}) {
  const rr = result.entry_price && result.target_price && result.stop_loss
    ? Math.abs(result.target_price - result.entry_price) / Math.abs(result.entry_price - result.stop_loss)
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">{result.asset.symbol} — Real AI Analysis</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-gray-400 text-xs">via {providerLabels[result.provider_used] || result.provider_used}</span>
                {result.has_mt_data && (
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <Wifi className="w-3 h-3" />{result.data_points} MT bars used
                  </span>
                )}
                {!result.has_mt_data && (
                  <span className="flex items-center gap-1 text-gray-500 text-xs">
                    <WifiOff className="w-3 h-3" />Live price only
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-bold uppercase ${signalBadge(result.signal)}`}>
              {result.signal === 'buy' ? <TrendingUp className="w-3.5 h-3.5" /> : result.signal === 'sell' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {result.signal}
            </span>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold capitalize ${sentColor(result.sentiment)}`}>
              {sentIcon(result.sentiment)}{result.sentiment}
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
              <span className="text-amber-400 text-sm font-bold">{result.confidence}% confidence</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Entry', value: result.entry_price?.toFixed(result.current_price > 100 ? 2 : 5) || '—', color: 'text-white' },
            { label: 'Target', value: result.target_price?.toFixed(result.current_price > 100 ? 2 : 5) || '—', color: 'text-green-400' },
            { label: 'Stop Loss', value: result.stop_loss?.toFixed(result.current_price > 100 ? 2 : 5) || '—', color: 'text-red-400' },
            { label: 'Risk/Reward', value: rr ? `1 : ${rr.toFixed(2)}` : '—', color: rr && rr >= 1.5 ? 'text-green-400' : 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800/50 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">{s.label}</div>
              <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="bg-gray-800/30 rounded-xl p-4 border-l-2 border-amber-500">
          <p className="text-white text-sm font-medium leading-relaxed">{result.analysis_text}</p>
        </div>

        {result.reasoning && (
          <div>
            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Detailed Reasoning</h4>
            <div className="space-y-2">
              {result.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
                <p key={i} className="text-gray-300 text-sm leading-relaxed">{line}</p>
              ))}
            </div>
          </div>
        )}

        {result.key_levels && result.key_levels.length > 0 && (
          <div>
            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Key Price Levels</h4>
            <div className="flex flex-wrap gap-2">
              {result.key_levels.map((level, i) => (
                <span key={i} className="bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-lg border border-gray-700">{level}</span>
              ))}
            </div>
          </div>
        )}

        {result.indicators_summary && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-blue-300 text-xs">{result.indicators_summary}</p>
          </div>
        )}

        {(result.signal === 'buy' || result.signal === 'sell') && result.confidence >= 65 && (
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            Signal automatically added to your Signals feed (confidence ≥ 65%)
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryAnalysisCard({
  analysis,
  sentColor,
  sentIcon,
}: {
  analysis: Analysis;
  sentColor: (s: string) => string;
  sentIcon: (s: string) => React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">{analysis.assets?.symbol} Analysis</h3>
              <p className="text-gray-400 text-xs">{new Date(analysis.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold capitalize ${sentColor(analysis.sentiment)}`}>
              {sentIcon(analysis.sentiment)}{analysis.sentiment}
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
              <span className="text-amber-400 text-sm font-bold">{analysis.confidence}% confidence</span>
            </div>
          </div>
        </div>
        <div className="mt-4 bg-gray-800/50 rounded-xl px-4 py-3 border border-gray-700/50">
          <span className="text-gray-400 text-xs">Prediction: </span>
          <span className="text-white text-sm font-medium">{analysis.prediction}</span>
        </div>
      </div>
      <div className="p-5">
        {analysis.analysis_text.split('\n').map((line, i) => {
          if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-amber-400 font-semibold mt-4 mb-2 text-sm">{line.replace(/\*\*/g, '')}</p>;
          if (line.startsWith('- ')) return <p key={i} className="text-gray-300 text-sm pl-4 mb-1">• {line.slice(2)}</p>;
          if (line.trim() === '') return <br key={i} />;
          return <p key={i} className="text-gray-300 text-sm leading-relaxed mb-2">{line}</p>;
        })}
      </div>
    </div>
  );
}
