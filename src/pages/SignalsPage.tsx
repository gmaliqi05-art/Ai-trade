import { useEffect, useMemo, useState } from 'react';
import { Zap, Bell, TrendingUp, Plus, Trash2, Target, Shield, Clock, CheckCircle, Loader2, Cpu, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useMarketAnalysis, type MarketAsset } from '../ai-trader/react/useMarketAnalysis';
import { EngineSignalCard } from '../ai-trader/react/EngineSignalCard';
import CompletedSignals from '../components/CompletedSignals';
import { isGoldSessionActive, goldWindowLocal } from '../lib/goldSession';
import type { Timeframe } from '../ai-trader/market/candles';
import { requestEngineReasoning } from '../services/aiReasoning';
import { useI18n } from '../i18n/i18n';

const TIMEFRAMES: { v: Timeframe; label: string }[] = [
  { v: '1m', label: '1 min' }, { v: '5m', label: '5 min' }, { v: '15m', label: '15 min' },
  { v: '30m', label: '30 min' }, { v: '1h', label: '1 orë' }, { v: '4h', label: '4 orë' }, { v: '1d', label: '1 ditë' },
];

interface Signal {
  id: string; type: string; symbol: string; entry_price: number;
  target_price: number; stop_loss: number; confidence: number; timeframe: string;
  analysis: string; status: string; created_at: string;
  outcome?: string | null; result_pct?: number | null; closed_at?: string | null;
  assets: { symbol: string; name: string; type: string; current_price: number } | null;
}

// Datë + orë e saktë.
const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

interface Alert {
  id: string; asset_id: string; symbol: string; condition: string; type: string;
  target_price: number; target_value: number;
  is_active: boolean; triggered_at: string | null; created_at: string;
}

interface Asset { id: string; symbol: string; name: string; current_price: number; category?: string; type?: string; }

// Tregjet e synuara (faza 1) → kategoritë në DB.
type MarketKey = 'crypto' | 'commodity' | 'stock';
const MARKETS: { key: MarketKey; label: string }[] = [
  { key: 'commodity', label: 'Ari / Mallra' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'stock', label: 'Indekse / Aksione' },
];

export default function SignalsPage() {
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [doneSignals, setDoneSignals] = useState<Signal[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeTab, setActiveTab] = useState<'engine' | 'signals' | 'done' | 'alerts'>('engine');
  const [market, setMarket] = useState<MarketKey>('commodity');
  const [goldOnly, setGoldOnly] = useState(true); // fokus: vetëm ari; të tjerat vetëm manualisht
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  // Tik çdo minutë për të rivlerësuar sesionin e arit (09:00–23:00 Frankfurt).
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const goldSessionOn = isGoldSessionActive(new Date(nowTick));
  const goldWin = goldWindowLocal(new Date(nowTick));
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ asset_id: '', condition: 'above', target_price: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { fetchData(); }, [user]);

  const fetchData = async () => {
    setLoading(true);
    const now = new Date().toISOString();
    const [sr, ar, alr, dr] = await Promise.all([
      supabase.from('signals').select('id, type, symbol, entry_price, target_price, stop_loss, confidence, timeframe, analysis, status, source, created_at, expires_at')
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('confidence', { ascending: false }),
      supabase.from('assets').select('id, symbol, name, current_price, category, type'),
      user ? supabase.from('alerts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      // Sinjale të përfunduara (TP/SL/skaduar) për raportim.
      supabase.from('signals').select('id, type, symbol, entry_price, target_price, stop_loss, confidence, timeframe, analysis, status, source, created_at, outcome, result_pct, closed_at')
        .in('status', ['hit_tp', 'hit_sl', 'expired']).order('closed_at', { ascending: false }).limit(30),
    ]);
    if (sr.data) setSignals(sr.data as Signal[]);
    if (ar.data) { setAssets(ar.data); if (ar.data.length > 0 && !form.asset_id) setForm(f => ({ ...f, asset_id: ar.data[0].id })); }
    if (alr.data) setAlerts(alr.data as Alert[]);
    if (dr.data) setDoneSignals(dr.data as Signal[]);
    setLoading(false);
  };

  const createAlert = async () => {
    if (!user || !form.asset_id || !form.target_price) return;
    setSaving(true); setMsg('');
    const targetVal = parseFloat(form.target_price);
    const asset = assets.find(a => a.id === form.asset_id);
    const { error } = await supabase.from('alerts').insert({ user_id: user.id, asset_id: form.asset_id, symbol: asset?.symbol || '', type: form.condition, condition: form.condition, target_value: targetVal, target_price: targetVal, is_active: true, triggered_at: null });
    if (error) { setMsg(t('Krijimi i alarmit dështoi')); } else { setMsg(t('Alarmi u krijua!')); setForm(f => ({ ...f, target_price: '' })); setShowForm(false); await fetchData(); }
    setSaving(false);
  };

  const deleteAlert = async (id: string) => {
    if (!window.confirm(t('Ta fshij këtë alarm? Ky veprim s\'kthehet mbrapsht.'))) return;
    await supabase.from('alerts').delete().eq('id', id);
    setAlerts(p => p.filter(a => a.id !== id));
  };

  const selAsset = assets.find(a => a.id === form.asset_id);

  // Aktivet për motorin: filtruar sipas tregut të zgjedhur. Kur s'jemi te tab-i
  // i motorit, dërgojmë listë bosh që të mos llogarisim pa nevojë.
  const engineAssets = useMemo<MarketAsset[]>(() => {
    if (activeTab !== 'engine') return [];
    // Parazgjedhje: VETËM ari. Tregjet e tjera shfaqen vetëm kur përdoruesi i kërkon.
    if (goldOnly) {
      if (!goldSessionOn) return []; // jashtë orarit të arit → asnjë sinjal
      return assets
        .filter(a => a.symbol === 'XAUUSD' && a.current_price > 0)
        .map(a => ({ symbol: a.symbol, category: a.category || a.type, currentPrice: a.current_price }));
    }
    return assets
      .filter(a => (a.category || a.type) === market && a.current_price > 0)
      .slice(0, 12)
      .map(a => ({ symbol: a.symbol, category: a.category || a.type, currentPrice: a.current_price }));
  }, [assets, market, activeTab, goldOnly, goldSessionOn]);

  const { analyses, loading: engineLoading, refresh: refreshEngine } = useMarketAnalysis(engineAssets, timeframe);
  const [engineUpdatedAt, setEngineUpdatedAt] = useState<Date | null>(null);
  useEffect(() => { if (!engineLoading && engineAssets.length > 0) setEngineUpdatedAt(new Date()); }, [engineLoading, analyses, engineAssets.length]);
  const accountBalance = Number((profile as { balance?: number } | null)?.balance) || 0;
  const catBySymbol = (sym: string) => assets.find(a => a.symbol === sym)?.category || assets.find(a => a.symbol === sym)?.type;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Zap className="w-6 h-6 text-amber-400" />{t('Sinjale & Alarme')}</h2>
        {activeTab === 'alerts' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all">
            <Plus className="w-4 h-4" />{t('Alarm i ri')}
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {[{ id: 'engine', label: 'Motori AI', icon: Cpu }, { id: 'signals', label: 'Sinjale AI', icon: Zap }, { id: 'done', label: 'Të përfunduara', icon: Clock }, { id: 'alerts', label: 'Alarmet e mia', icon: Bell }].map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} onClick={() => setActiveTab(tab.id as 'engine' | 'signals' | 'done' | 'alerts')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}><Icon className="w-4 h-4" />{t(tab.label)}</button>;
        })}
      </div>

      {activeTab === 'engine' && (
        <div className="space-y-4">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-gray-300 leading-relaxed">
              <span className="font-semibold text-amber-400">{t('Sinjale nga motori i Robotit mbi çmime LIVE.')}</span>{' '}
              {t('Indikatorë realë (EMA, RSI, MACD, Bollinger, ATR) → BLEJ / SHIT / PRIT, afatshkurtër + afatgjatë. Ari (XAUUSD) është 100% live nga tregu (grafikët nga TradingView). Aktivet pa feed live shënohen "VLERËSIM". Asnjë garanci fitimi — menaxho gjithmonë rrezikun.')}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2 flex-wrap items-center">
              {goldOnly ? (
                <>
                  <span className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-amber-500 text-gray-950">{t('🥇 Ari (XAUUSD)')}</span>
                  <button onClick={() => { setGoldOnly(false); setMarket('crypto'); }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-400 hover:text-white transition-colors">
                    {t('+ Shfaq tregje të tjera (manual)')}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setGoldOnly(true)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors">
                    {t('← Vetëm ari')}
                  </button>
                  {MARKETS.map(m => (
                    <button key={m.key} onClick={() => setMarket(m.key)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${market === m.key ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                      {t(m.label)}
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {engineUpdatedAt && <span className="text-[10px] text-gray-500">{t('🕒 Llogaritur: {time}', { time: engineUpdatedAt.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' }) })}</span>}
              <button onClick={refreshEngine} disabled={engineLoading}
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${engineLoading ? 'animate-spin' : ''}`} />{t('Gjenero / Rifresko')}
              </button>
            </div>
          </div>

          {/* Zgjedhësi i periudhës — klienti kërkon analizë për një periudhë të caktuar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">{t('Periudha e analizës:')}</span>
            {TIMEFRAMES.map(tf => (
              <button key={tf.v} onClick={() => setTimeframe(tf.v)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${timeframe === tf.v ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {t(tf.label)}
              </button>
            ))}
          </div>

          {goldOnly && !goldSessionOn ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
              <Clock className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-white font-medium">{t('Jashtë orarit të tregtimit të arit 🌙')}</p>
              <p className="text-gray-400 text-sm mt-1">{t('Sinjalet e arit gjenerohen vetëm {open}–{close} {label} — sesioni London/New York.', { open: goldWin.open, close: goldWin.close, label: goldWin.sameAsFrankfurt ? t('(Frankfurt)') : t('(koha jote)') })}</p>
              <p className="text-gray-600 text-xs mt-2">{t('Jashtë këtij orari likuiditeti është i ulët dhe sinjalet japin rezultate të dobëta.')}</p>
            </div>
          ) : engineLoading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <div key={i} className="h-56 bg-gray-800 rounded-2xl animate-pulse" />)}</div>
          ) : engineAssets.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center"><Cpu className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-400">{t('Asnjë aktiv në këtë treg')}</p></div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analyses.map(a => (
                <EngineSignalCard
                  key={a.symbol}
                  analysis={a}
                  category={catBySymbol(a.symbol)}
                  accountBalance={accountBalance}
                  askAI={(an) => requestEngineReasoning(an, { assetId: assets.find(x => x.symbol === an.symbol)?.id })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'alerts' && showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-4 text-sm">{t('Krijo alarm çmimi')}</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">{t('Aktivi')}</label>
              <select value={form.asset_id} onChange={(e) => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                {assets.map(a => <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">{t('Kushti')}</label>
              <select value={form.condition} onChange={(e) => setForm(f => ({ ...f, condition: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                <option value="above">{t('Çmimi ngrihet mbi')}</option>
                <option value="below">{t('Çmimi bie nën')}</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">{t('Çmimi objektiv')} {selAsset && <span className="text-gray-600">{t('(tani: {price})', { price: selAsset.current_price.toLocaleString() })}</span>}</label>
              <input type="number" value={form.target_price} onChange={(e) => setForm(f => ({ ...f, target_price: e.target.value }))} placeholder="0.00" className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          {msg && <p className={`text-xs mt-3 ${msg.includes('!') ? 'text-green-400' : 'text-red-400'}`}>{msg}</p>}
          <div className="flex gap-3 mt-4">
            <button onClick={createAlert} disabled={saving || !form.target_price} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}{t('Krijo alarm')}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">{t('Anulo')}</button>
          </div>
        </div>
      )}

      {activeTab === 'engine' ? null : loading ? (
        <div className="grid md:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-gray-800 rounded-2xl animate-pulse" />)}</div>
      ) : activeTab === 'signals' ? (
        signals.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center"><Zap className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-400">{t('Asnjë sinjal aktiv')}</p></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {signals.map((s) => {
              const rr = s.entry_price > 0 && s.entry_price !== s.stop_loss ? ((s.target_price - s.entry_price) / (s.entry_price - s.stop_loss)).toFixed(2) : 'N/A';
              return (
                <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-lg">{s.assets?.symbol || s.symbol}</span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase border ${s.type === 'buy' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>{s.type === 'buy' ? t('BLEJ') : s.type === 'sell' ? t('SHIT') : s.type}</span>
                    </div>
                    <div className="text-right"><div className="text-amber-400 font-bold text-lg">{s.confidence}%</div><div className="text-gray-500 text-xs">{t('besueshmëri')}</div></div>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed mb-4 line-clamp-2">{s.analysis}</p>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: 'Hyrje', value: s.entry_price.toLocaleString(), icon: Target, cls: 'bg-gray-800/50', vCls: 'text-white' },
                      { label: 'Objektiv', value: s.target_price.toLocaleString(), icon: TrendingUp, cls: 'bg-green-500/10', vCls: 'text-green-400' },
                      { label: 'Stop', value: s.stop_loss.toLocaleString(), icon: Shield, cls: 'bg-red-500/10', vCls: 'text-red-400' },
                    ].map(l => { const Icon = l.icon; return (
                      <div key={l.label} className={`${l.cls} rounded-lg p-2 text-center`}>
                        <div className="text-gray-500 text-xs mb-1 flex items-center justify-center gap-1"><Icon className="w-3 h-3" />{t(l.label)}</div>
                        <div className={`${l.vCls} text-xs font-semibold`}>{l.value}</div>
                      </div>
                    ); })}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{s.timeframe}</div>
                    <div>R/R: <span className="text-amber-400 font-medium">1:{rr}</span></div>
                    <div className="flex items-center gap-1">🕒 {fmtDT(s.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeTab === 'done' ? (
        <CompletedSignals signals={doneSignals} variant="full" />
      ) : (
        alerts.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <Bell className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">{t('Asnjë alarm i vendosur')}</p>
            <p className="text-gray-600 text-sm mt-1">{t('Krijo një alarm çmimi që të njoftohesh kur aktivi arrin objektivin tënd')}</p>
            <button onClick={() => setShowForm(true)} className="mt-4 flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all mx-auto"><Plus className="w-4 h-4" />{t('Krijo alarm')}</button>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((a) => (
              <div key={a.id} className={`bg-gray-900 border rounded-2xl px-5 py-4 flex items-center justify-between gap-4 ${a.triggered_at ? 'border-green-800/50 bg-green-900/10' : 'border-gray-800 hover:border-gray-700'} transition-colors`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.triggered_at ? 'bg-green-500/20' : 'bg-amber-500/10'}`}>
                    {a.triggered_at ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Bell className="w-5 h-5 text-amber-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm">{a.symbol || assets.find(x => x.id === a.asset_id)?.symbol}</span>
                      <span className="text-gray-400 text-xs">{(a.condition || a.type) === 'above' ? t('↑ ngrihet mbi') : t('↓ bie nën')} ${(a.target_price || a.target_value || 0).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-600 text-xs mt-0.5">{a.triggered_at ? t('Aktivizuar: {date}', { date: new Date(a.triggered_at).toLocaleDateString('sq-AL') }) : t('Krijuar: {date}', { date: new Date(a.created_at).toLocaleDateString('sq-AL') })}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-lg ${a.is_active && !a.triggered_at ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>{a.triggered_at ? t('aktivizuar') : a.is_active ? t('aktiv') : t('joaktiv')}</span>
                  <button onClick={() => deleteAlert(a.id)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
