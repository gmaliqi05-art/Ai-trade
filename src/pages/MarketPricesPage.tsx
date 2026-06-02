import { useEffect, useState, useRef } from 'react';
import {
  TrendingUp, TrendingDown, RefreshCw, Search,
  Activity, Brain, Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ClientPage } from '../App';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  category: string;
  current_price: number;
  price_change_24h: number;
  price_change_pct: number;
  high_24h: number | null;
  low_24h: number | null;
  volume_24h: number | null;
  price_updated_at: string | null;
}

const catColors: Record<string, { bg: string; text: string; border: string }> = {
  commodity: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  forex: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  crypto: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  stock: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
};

const catLabels: Record<string, string> = {
  commodity: 'Mallra / Ar',
  forex: 'Forex',
  crypto: 'Crypto',
  stock: 'Indekse / Aksione',
};

function formatPrice(price: number, category: string): string {
  if (category === 'forex') return price.toFixed(5);
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

export default function MarketPricesPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filtered, setFiltered] = useState<Asset[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAssets = async () => {
    const { data } = await supabase
      .from('assets')
      .select('id, symbol, name, category, current_price, price_change_24h, price_change_pct, high_24h, low_24h, volume_24h, price_updated_at')
      .order('category')
      .order('symbol');
    if (data) {
      setAssets(data as Asset[]);
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAssets();
    intervalRef.current = setInterval(fetchAssets, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  useEffect(() => {
    let list = assets;
    if (activeCategory !== 'all') list = list.filter(a => a.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
    }
    // Ari (XAUUSD) i pari; pastaj mallrat, pastaj të tjerat.
    const rank = (a: Asset) => (a.symbol === 'XAUUSD' ? 0 : a.category === 'commodity' ? 1 : 2);
    list = [...list].sort((a, b) => rank(a) - rank(b));
    setFiltered(list);
  }, [assets, activeCategory, search]);

  const categories = ['all', ...Array.from(new Set(assets.map(a => a.category)))];

  const grouped = filtered.reduce<Record<string, Asset[]>>((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="w-6 h-6 text-amber-400" />Çmimet e tregut
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Çmime reale nga databaza
            {lastUpdated && (
              <span className="ml-2 text-gray-600 text-xs">· përditësuar {lastUpdated.toLocaleTimeString()} · rifreskohet çdo 30s</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('signals')}
            className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
          >
            <Zap className="w-3.5 h-3.5" />Sinjalet
          </button>
          <button
            onClick={fetchAssets}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
            title="Rifresko"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko simbol ose emër..."
            className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all capitalize ${
                activeCategory === cat
                  ? 'bg-amber-500 text-gray-950'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {cat === 'all' ? 'Të gjitha' : catLabels[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 w-24 bg-gray-800 rounded animate-pulse" />
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="h-14 bg-gray-800/50 border-b border-gray-800 animate-pulse last:border-0" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>S'u gjet asnjë aktiv{search ? ` për "${search}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => {
            const c = catColors[category] || catColors.stock;
            return (
              <div key={category}>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold mb-3 ${c.bg} ${c.text} border ${c.border}`}>
                  {catLabels[category] || category}
                  <span className="opacity-60">({items.length})</span>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-gray-800 text-gray-600 text-xs font-medium uppercase tracking-wider">
                    <div className="col-span-3">Simboli</div>
                    <div className="col-span-2 text-right">Çmimi</div>
                    <div className="col-span-2 text-right">Ndryshimi 24h</div>
                    <div className="col-span-2 text-right">Maks 24h</div>
                    <div className="col-span-2 text-right">Min 24h</div>
                    <div className="col-span-1 text-right">Vëllimi</div>
                  </div>
                  {items.map((a, idx) => (
                    <div
                      key={a.id}
                      className={`grid md:grid-cols-12 gap-2 md:gap-4 px-5 py-3.5 md:py-3 items-center ${idx < items.length - 1 ? 'border-b border-gray-800/50' : ''} hover:bg-gray-800/30 transition-colors`}
                    >
                      <div className="md:col-span-3 flex items-center gap-3">
                        <div>
                          <div className="text-white font-bold text-sm">{a.symbol}</div>
                          <div className="text-gray-500 text-xs truncate max-w-[160px]">{a.name}</div>
                        </div>
                      </div>
                      <div className="md:col-span-2 text-right">
                        <div className="text-white font-semibold text-sm tabular-nums">
                          {formatPrice(a.current_price, a.category)}
                        </div>
                        {a.price_updated_at && (
                          <div className="text-gray-600 text-[10px]">
                            {new Date(a.price_updated_at).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                      <div className="md:col-span-2 text-right">
                        <div className={`flex items-center justify-end gap-1 font-semibold text-sm ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {a.price_change_pct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%
                        </div>
                        <div className={`text-xs tabular-nums ${a.price_change_24h >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>
                          {a.price_change_24h >= 0 ? '+' : ''}{formatPrice(a.price_change_24h, a.category)}
                        </div>
                      </div>
                      <div className="md:col-span-2 text-right">
                        <div className="text-gray-300 text-sm tabular-nums">
                          {a.high_24h ? formatPrice(a.high_24h, a.category) : '—'}
                        </div>
                      </div>
                      <div className="md:col-span-2 text-right">
                        <div className="text-gray-300 text-sm tabular-nums">
                          {a.low_24h ? formatPrice(a.low_24h, a.category) : '—'}
                        </div>
                      </div>
                      <div className="md:col-span-1 text-right">
                        <div className="text-gray-400 text-xs tabular-nums">
                          {a.volume_24h ? formatVolume(a.volume_24h) : '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-white font-semibold text-sm">Dëshiron analizë AI për ndonjërin?</h3>
          <p className="text-gray-400 text-xs mt-0.5">Ngarko një grafik ose shiko sinjalet e motorit me çmime reale</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate('chart_analysis')}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all"
          >
            <Brain className="w-4 h-4" />Ngarko grafik
          </button>
          <button
            onClick={() => onNavigate('signals')}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm transition-all"
          >
            <Zap className="w-4 h-4 text-amber-400" />Sinjalet
          </button>
        </div>
      </div>
    </div>
  );
}
