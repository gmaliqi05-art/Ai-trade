import { useEffect, useState, useCallback } from 'react';
import {
  Activity, RefreshCw, Loader2, TrendingUp, Zap, Brain,
  Wallet, AlertCircle, History,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage } from '../App';
import Mt5Chart, { type ChartCandle, type PriceLineDef } from '../components/Mt5Chart';
import OpenPositionsPanel from '../components/OpenPositionsPanel';
import CompletedSignals from '../components/CompletedSignals';
import {
  loadMetaApiConfig, checkMetaApiConnection, executeTrade, loadTradeHistory,
  loadCandles, loadOpenPositions, modifyPosition,
  type AccountInfo, type HistoryDeal, type OpenPosition,
} from '../services/metaapi';
import { fetchCandles, type Timeframe } from '../ai-trader/market/candles';
import { useI18n } from '../i18n/i18n';

interface Asset { id: string; symbol: string; name: string; category: string; current_price: number; }
interface Signal {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  source: string; created_at: string;
  status?: string; outcome?: string | null; result_pct?: number | null; closed_at?: string | null;
}

// Orë e saktë e sinjalit (dt + orë:min).
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Freskia e sinjalit: pas 30 min çmimi ka lëvizur dhe hyrje/SL/TP janë të vjetra —
// mos tregto mbi to (rezultate jo të mira). Roboti auto përdor 15 min.
const SIGNAL_FRESH_MIN = 30;
const signalAgeMin = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);
const signalIsFresh = (iso?: string | null) => signalAgeMin(iso) <= SIGNAL_FRESH_MIN;

function errText(t: (k: string) => string, code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: t('Lidh llogarinë MT5 te Lidhja & Konfigurimi para se të tregtosh.'),
    metaapi_unreachable: t("S'u arrit MetaApi — kontrollo lidhjen."),
    kill_switch: t('Kill-switch është aktiv — çaktivizoje te Lidhja & Konfigurimi.'),
    max_open_trades: t('Arritur limiti i pozicioneve të hapura.'),
    max_daily_loss: t('Arritur limiti i humbjes ditore.'),
  };
  return map[code] || message || code;
}

export default function MarketTerminalPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [doneSignals, setDoneSignals] = useState<Signal[]>([]);
  const [selected, setSelected] = useState('XAUUSD');
  const [tf, setTf] = useState('15m');

  const [metaConfigured, setMetaConfigured] = useState(false);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<HistoryDeal[]>([]);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [modifyMsg, setModifyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modifyBusy, setModifyBusy] = useState(false);

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [lot, setLot] = useState('0.01');
  const [newEntry, setNewEntry] = useState('');   // Çmimi i hyrjes (porosi në pritje nëse s'është aty)
  const [newSl, setNewSl] = useState('');         // SL për porosinë e re (manuale)
  const [newTp, setNewTp] = useState('');         // TP për porosinë e re (manuale)
  const [appliedSignalId, setAppliedSignalId] = useState<string | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const goldFirst = (arr: Asset[]) =>
    [...arr].sort((a, b) => (a.symbol === 'XAUUSD' ? 0 : a.category === 'commodity' ? 1 : 2) - (b.symbol === 'XAUUSD' ? 0 : b.category === 'commodity' ? 1 : 2));

  const fetchBase = useCallback(async () => {
    const now = new Date().toISOString();
    const [ar, sr, dr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, category, current_price').gt('current_price', 0),
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at')
        .eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${now}`).order('confidence', { ascending: false }).limit(8),
      // Sinjalet e PËRFUNDUARA (TP/SL/skaduar) — për raportim suksesi.
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, outcome, result_pct, closed_at')
        .in('status', ['hit_tp', 'hit_sl', 'expired']).order('closed_at', { ascending: false }).limit(12),
    ]);
    if (ar.data) setAssets(goldFirst(ar.data as Asset[]));
    if (sr.data) setSignals(sr.data as Signal[]);
    if (dr.data) setDoneSignals(dr.data as Signal[]);
  }, []);

  // Lexon gjendjen reale të MT5: llogaria + historiku.
  const fetchMeta = useCallback(async () => {
    if (!user) return;
    const cfg = await loadMetaApiConfig(user.id);
    const configured = !!(cfg.account_id && cfg.token);
    setMetaConfigured(configured);
    setMtMode(cfg.mode);
    if (configured) {
      const [acc, hist, pos] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(), loadOpenPositions()]);
      if (!acc.error && acc.account) setAccount(acc.account);
      if (!hist.error && Array.isArray(hist.deals)) {
        const closed = hist.deals
          .filter(d => d.entryType === 'DEAL_ENTRY_OUT' || (d.profit != null && d.profit !== 0))
          .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        setHistory(closed);
      }
      if (!pos.error && Array.isArray(pos.positions)) setPositions(pos.positions);
    }
    setLastUpdated(new Date());
  }, [user]);

  // Rifreskim manual i të dhënave (me reagim vizual).
  const refreshAll = async () => {
    setRefreshing(true);
    try { await Promise.all([fetchBase(), fetchMeta()]); } finally { setRefreshing(false); }
  };

  // Qirinjtë: provo nga MT5 (saktë); nëse s'ka, bie te feed-i i motorit (PAXG/treg).
  const loadChart = useCallback(async () => {
    let out: ChartCandle[] = [];
    if (metaConfigured) {
      const r = await loadCandles(selected, tf, 300);
      if (!r.error && Array.isArray(r.candles) && r.candles.length > 0) {
        out = r.candles.map(c => ({
          time: Math.floor(new Date(c.time).getTime() / 1000),
          open: c.open, high: c.high, low: c.low, close: c.close,
        }));
      }
    }
    if (out.length === 0) {
      // Fallback: feed-i i motorit (qirinj realë për ari/crypto).
      const px = assets.find(a => a.symbol === selected)?.current_price || 0;
      try {
        const res = await fetchCandles({ symbol: selected, currentPrice: px, timeframe: tf as Timeframe, limit: 300 });
        out = res.candles.map(c => ({ time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close }));
      } catch { /* lëre bosh */ }
    }
    setCandles(out);
  }, [metaConfigured, selected, tf, assets]);

  useEffect(() => { loadChart(); }, [loadChart]);

  useEffect(() => {
    fetchBase();
    fetchMeta();
    const id = setInterval(() => { fetchBase(); fetchMeta(); }, 20000);
    return () => clearInterval(id);
  }, [fetchBase, fetchMeta]);

  const handleTrade = async () => {
    const vol = parseFloat(lot);
    if (isNaN(vol) || vol <= 0) { setTradeMsg({ type: 'error', text: t('Vendos një lot të vlefshëm (p.sh. 0.01).') }); return; }
    if (!metaConfigured) { setTradeMsg({ type: 'error', text: errText(t, 'metaapi_not_configured') }); return; }
    // Nëse tregtia bazohet në një sinjal, sigurohu që sinjali është ende i freskët.
    if (appliedSignalId) {
      const applied = signals.find(s => s.id === appliedSignalId);
      if (applied && !signalIsFresh(applied.created_at)) {
        setTradeMsg({ type: 'error', text: t('Sinjali është vjetërsuar (mbi {min} min) — mos tregto mbi të, prit një sinjal të ri.', { min: SIGNAL_FRESH_MIN }) });
        return;
      }
    }
    const sl = newSl.trim() ? parseFloat(newSl) : undefined;
    const tp = newTp.trim() ? parseFloat(newTp) : undefined;
    const entry = newEntry.trim() ? parseFloat(newEntry) : undefined;
    setTradeLoading(true); setTradeMsg(null);
    const r = await executeTrade({
      action: tradeType === 'buy' ? 'BUY' : 'SELL', symbol: selected, volume: vol,
      stopLoss: sl, takeProfit: tp, entryPrice: entry,
      signalId: appliedSignalId ?? undefined,
    });
    if (r.error) setTradeMsg({ type: 'error', text: errText(t, r.error, r.message) });
    else {
      const dir = tradeType === 'buy' ? t('BLEJ') : t('SHIT');
      const extra = `${sl ? ` · SL ${sl}` : ''}${tp ? ` · TP ${tp}` : ''}`;
      if (r.pending) {
        setTradeMsg({ type: 'success', text: t('Porosi në pritje {dir} {sym} ({vol} lot) @ {price}{extra} — hyn automatik kur çmimi e arrin ({mode}).', { dir, sym: selected, vol, price: r.open_price ?? entry ?? '', extra, mode: r.mode ?? '' }) });
      } else {
        setTradeMsg({ type: 'success', text: t('Urdhër {dir} {sym} ({vol} lot){extra} dërguar ({mode}).', { dir, sym: selected, vol, extra, mode: r.mode ?? '' }) });
      }
      fetchMeta();
    }
    setTradeLoading(false);
  };

  // Sinjali i fundit i gjeneruar nga sistemi (sipas kohës), për tregti manuale me një klik.
  const latestSignal = signals.length
    ? [...signals].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    : null;

  // Klik mbi një sinjal → mbush formën "Porosi e re" (simbol, drejtim, SL, TP).
  const applySignal = (s: Signal) => {
    // Mbrojtje: mos lejo tregti mbi sinjale të vjetra/po-skadojnë (çmimi ka lëvizur).
    if (!signalIsFresh(s.created_at)) {
      setAppliedSignalId(null);
      setTradeMsg({ type: 'error', text: t('Ky sinjal është i vjetër (mbi {min} min) — çmimi ka lëvizur dhe rezultatet do të ishin të dobëta. Prit një sinjal të ri.', { min: SIGNAL_FRESH_MIN }) });
      return;
    }
    setSelected(s.symbol);
    setTradeType(s.type === 'sell' ? 'sell' : 'buy');
    setNewEntry(s.entry_price != null ? String(s.entry_price) : '');
    setNewSl(s.stop_loss != null ? String(s.stop_loss) : '');
    setNewTp(s.target_price != null ? String(s.target_price) : '');
    setAppliedSignalId(s.id);
    setTradeMsg(null);
  };

  // Ndërrim manual i simbolit (nga butonat) → pastron SL/TP e sinjalit të aplikuar.
  const pickSymbol = (sym: string) => {
    setSelected(sym);
    setAppliedSignalId(null);
    setNewEntry(''); setNewSl(''); setNewTp('');
  };

  // Pozicioni i hapur për simbolin e zgjedhur → linjat Hyrje/SL/TP + modifikim.
  const posForSymbol = positions.find(p => p.symbol === selected) || null;
  const chartLines: PriceLineDef[] = posForSymbol ? [
    ...(posForSymbol.openPrice ? [{ price: posForSymbol.openPrice, color: '#3b82f6', title: 'Hyrje' }] : []),
    ...(posForSymbol.stopLoss ? [{ price: posForSymbol.stopLoss, color: '#ef4444', title: 'SL' }] : []),
    ...(posForSymbol.takeProfit ? [{ price: posForSymbol.takeProfit, color: '#22c55e', title: 'TP' }] : []),
  ] : [];

  // Parambush SL/TP kur ndryshon pozicioni.
  useEffect(() => {
    setSlInput(posForSymbol?.stopLoss ? String(posForSymbol.stopLoss) : '');
    setTpInput(posForSymbol?.takeProfit ? String(posForSymbol.takeProfit) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posForSymbol?.id, posForSymbol?.stopLoss, posForSymbol?.takeProfit]);

  const handleModify = async () => {
    if (!posForSymbol) return;
    setModifyBusy(true); setModifyMsg(null);
    const r = await modifyPosition(
      posForSymbol.id,
      slInput ? parseFloat(slInput) : undefined,
      tpInput ? parseFloat(tpInput) : undefined,
    );
    if (r.error) setModifyMsg({ type: 'error', text: errText(t, r.error, r.message) });
    else { setModifyMsg({ type: 'success', text: t('SL/TP u përditësuan në MT5.') }); fetchMeta(); }
    setModifyBusy(false);
  };

  const money = (n?: number) => (n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const cur = account?.currency || '$';

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-400" />{t('MetaTrader 5 — Live')}
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            {t('Llogaria jote reale MT5, grafiku, tregtimi dhe trade-t — live')}
            {lastUpdated && <span className="ml-2 text-gray-600 text-xs">· {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
            !metaConfigured ? 'bg-gray-700/50 text-gray-400 border-gray-600'
            : mtMode === 'live' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
          }`}>{!metaConfigured ? t('PA LIDHJE') : mtMode === 'live' ? t('● LIVE') : t('● DEMO')}</span>
          <button onClick={refreshAll} disabled={refreshing} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all disabled:opacity-60"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {!metaConfigured && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-medium text-sm">{t("MT5 s'është i lidhur")}</p>
            <p className="text-amber-400/80 text-xs mt-0.5" dangerouslySetInnerHTML={{ __html: t('Lidh llogarinë tënde MT5 (Vantage) te <strong>Lidhja & Konfigurimi</strong> për ta parë live këtu.') }} />
            <button onClick={() => onNavigate('metatrader')} className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline">{t('Shko te Lidhja & Konfigurimi')}</button>
          </div>
        </div>
      )}

      {/* Gjendja e llogarisë */}
      {metaConfigured && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: t('Balanca'), value: `${money(account?.balance)} ${cur}`, icon: Wallet, cls: 'text-white' },
            { label: t('Equity'), value: `${money(account?.equity)} ${cur}`, icon: Activity, cls: 'text-white' },
            { label: t('Fitim/Humbje'), value: `${(account?.profit ?? 0) >= 0 ? '+' : ''}${money(account?.profit)}`, icon: TrendingUp, cls: (account?.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: t('Marzh i lirë'), value: `${money(account?.freeMargin)} ${cur}`, icon: Wallet, cls: 'text-white' },
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

      {/* GRAFIK — full width (të dhëna reale nga MT5 kur je i lidhur) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {assets.slice(0, 7).map(a => (
                  <button key={a.id} onClick={() => pickSymbol(a.symbol)}
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
            <div className="px-2 pb-2">
              {candles.length === 0 ? (
                <div className="h-[460px] flex items-center justify-center text-gray-600 text-sm">{t('Po ngarkohet grafiku…')}</div>
              ) : (
                <Mt5Chart candles={candles} lines={chartLines} height={460} />
              )}
            </div>
            {posForSymbol && (
              <div className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-800 text-[11px] flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500" />{t('Hyrje')} {posForSymbol.openPrice}</span>
                {posForSymbol.stopLoss ? <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" />SL {posForSymbol.stopLoss}</span> : <span className="text-gray-600">{t('SL pa vendosur')}</span>}
                {posForSymbol.takeProfit ? <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500" />TP {posForSymbol.takeProfit}</span> : <span className="text-gray-600">{t('TP pa vendosur')}</span>}
              </div>
            )}
      </div>

      {/* Porosi e re (nën grafik) + lista e sinjaleve */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Porosia BLEJ/SHIT */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3 h-fit">
          <h3 className="text-white font-semibold text-sm">{t('Porosi e re — {sym}', { sym: selected })}</h3>
          <div className="flex rounded-xl overflow-hidden border border-gray-700">
            <button onClick={() => setTradeType('buy')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('BLEJ')}</button>
            <button onClick={() => setTradeType('sell')} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('SHIT')}</button>
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">{t('Lot (madhësia)')}</label>
            <input type="number" value={lot} onChange={e => setLot(e.target.value)} min="0.01" step="0.01"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {['0.01', '0.05', '0.10', '0.25'].map(v => (
              <button key={v} onClick={() => setLot(v)} className={`text-xs py-1.5 rounded-lg transition-colors ${lot === v ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}>{v}</button>
            ))}
          </div>
          {/* Çmimi i hyrjes — nëse çmimi s'është aty, vendoset porosi NË PRITJE (hyn automatik kur arrin) */}
          <div>
            <label className="block text-[10px] text-amber-400 mb-1">{t('Çmimi i hyrjes')} <span className="text-gray-600">{t('(bosh = tregu tani)')}</span></label>
            <input type="number" step="0.01" value={newEntry} onChange={e => setNewEntry(e.target.value)} placeholder={t('hyrje tregu')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-amber-500" />
          </div>
          {/* SL / TP për porosinë e re (si te sistemi automatik; opsionale, ndryshoji lirisht) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-red-400 mb-1">{t('Stop Loss')}</label>
              <input type="number" step="0.01" value={newSl} onChange={e => setNewSl(e.target.value)} placeholder={t('opsionale')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-red-500" />
            </div>
            <div>
              <label className="block text-[10px] text-green-400 mb-1">{t('Take Profit')}</label>
              <input type="number" step="0.01" value={newTp} onChange={e => setNewTp(e.target.value)} placeholder={t('opsionale')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-green-500" />
            </div>
          </div>
          {appliedSignalId && <p className="text-[10px] text-amber-400/80">{t("Hyrja, SL dhe TP u mbushën nga sinjali. Nëse çmimi s'është te hyrja, vendoset porosi në pritje që hyn automatik. Mund t'i ndryshosh para se të tregtosh.")}</p>}
          {tradeMsg && (
            <div className={`text-xs rounded-xl px-3 py-2 ${tradeMsg.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-red-900/30 text-red-400 border border-red-800/50'}`}>{tradeMsg.text}</div>
          )}
          <button onClick={handleTrade} disabled={tradeLoading || !metaConfigured}
            className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
            {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}{tradeType === 'buy' ? t('BLEJ') : t('SHIT')} {selected}
          </button>
          <button onClick={() => onNavigate('chart_analysis')} className="w-full flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl py-2 text-xs font-medium transition-colors">
            <Brain className="w-3.5 h-3.5" />{t('Analizë AI për {sym}', { sym: selected })}
          </button>

          {/* Sinjali i fundit i gjeneruar nga sistemi — klik për ta tregtuar manualisht */}
          <div className="pt-3 border-t border-gray-800">
            <div className="text-[11px] text-gray-500 mb-2 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" />{t('Sinjali i fundit (klik për ta tregtuar)')}</div>
            {latestSignal ? (
              <button onClick={() => applySignal(latestSignal)}
                className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors ${appliedSignalId === latestSignal.id ? 'bg-amber-500/10 border-amber-500/40' : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{latestSignal.symbol}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${latestSignal.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{latestSignal.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    {!signalIsFresh(latestSignal.created_at) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-600/40 text-gray-400">{t('I VJETËR')}</span>}
                  </span>
                  <span className="text-amber-400 text-xs font-semibold">{latestSignal.confidence}%</span>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-400 flex-wrap">
                  {latestSignal.entry_price && <span>{t('Hyrje:')} <span className="text-white">{Number(latestSignal.entry_price).toLocaleString()}</span></span>}
                  {latestSignal.target_price && <span>TP: <span className="text-green-400">{Number(latestSignal.target_price).toLocaleString()}</span></span>}
                  {latestSignal.stop_loss && <span>SL: <span className="text-red-400">{Number(latestSignal.stop_loss).toLocaleString()}</span></span>}
                </div>
                <div className="text-[10px] text-gray-600 mt-1">🕒 {t('Gjeneruar:')} {fmtTime(latestSignal.created_at)}</div>
              </button>
            ) : (
              <p className="text-gray-600 text-xs text-center py-2">{t('Asnjë sinjal i gjeneruar ende.')}</p>
            )}
          </div>

          {/* Modifiko SL/TP për pozicionin e hapur të këtij simboli */}
          {posForSymbol && (
            <div className="pt-3 border-t border-gray-800 space-y-2">
              <div className="text-xs font-semibold text-white flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${(posForSymbol.type || '').includes('BUY') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{(posForSymbol.type || '').includes('BUY') ? t('BLEJ') : t('SHIT')}</span>
                {t('Ndrysho SL / TP ({vol} lot)', { vol: posForSymbol.volume })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-red-400 mb-1">{t('Stop Loss')}</label>
                  <input type="number" step="0.01" value={slInput} onChange={e => setSlInput(e.target.value)} placeholder="—"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="block text-[10px] text-green-400 mb-1">{t('Take Profit')}</label>
                  <input type="number" step="0.01" value={tpInput} onChange={e => setTpInput(e.target.value)} placeholder="—"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-green-500" />
                </div>
              </div>
              {modifyMsg && (
                <div className={`text-[11px] rounded-lg px-2 py-1.5 ${modifyMsg.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{modifyMsg.text}</div>
              )}
              <button onClick={handleModify} disabled={modifyBusy}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold py-2 rounded-lg text-xs transition-all">
                {modifyBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('Ruaj SL/TP në MT5')}
              </button>
              <p className="text-[10px] text-gray-600">{t('Linjat duken në grafik: Hyrje (blu), SL (kuq), TP (jeshil).')}</p>
            </div>
          )}
        </div>

        {/* Sinjalet (lista e plotë) — klik për të mbushur formën Porosi e re */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-4 h-fit">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />{t('Sinjalet')}</h3>
          <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300">{t('Të gjitha')}</button>
        </div>
        {signals.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë sinjal aktiv tani.')}</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {signals.map(s => {
              const fresh = signalIsFresh(s.created_at);
              return (
              <button key={s.id} onClick={() => applySignal(s)} className={`text-left rounded-xl px-3 py-2 transition-colors border ${appliedSignalId === s.id ? 'bg-amber-500/10 border-amber-500/40' : 'bg-gray-800/40 border-transparent hover:bg-gray-800'} ${fresh ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{s.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    {!fresh && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-600/40 text-gray-400">{t('I VJETËR')}</span>}
                  </span>
                  <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                </div>
                <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                  {s.entry_price && <span>{t('Hyrje:')} <span className="text-white">{Number(s.entry_price).toLocaleString()}</span></span>}
                  {s.target_price && <span>{t('Objektiv:')} <span className="text-green-400">{Number(s.target_price).toLocaleString()}</span></span>}
                  {s.stop_loss && <span>{t('Stop:')} <span className="text-red-400">{Number(s.stop_loss).toLocaleString()}</span></span>}
                </div>
                <div className="text-[10px] text-gray-600 mt-1">🕒 {fmtTime(s.created_at)}{fresh ? '' : t(' · mos tregto')}</div>
              </button>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* 1) Pozicionet e hapura (live) — menjëherë nën sinjalet */}
      <OpenPositionsPanel configured={metaConfigured} section="positions" />

      {/* 2) Trade-t e mbyllura (historiku real nga MT5) — 10 të parat, me buton për të zgjeruar */}
      {metaConfigured && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><History className="w-4 h-4 text-amber-400" />{t('Trade-t e mbyllura (7 ditët e fundit)')}</h3>
          {history.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë trade i mbyllur ende.')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left font-medium py-2">{t('Simboli')}</th>
                      <th className="text-left font-medium py-2">{t('Lloji')}</th>
                      <th className="text-right font-medium py-2">{t('Lot')}</th>
                      <th className="text-right font-medium py-2">{t('Çmimi')}</th>
                      <th className="text-right font-medium py-2">{t('Fitim/Humbje')}</th>
                      <th className="text-right font-medium py-2">{t('Koha')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {(showAllHistory ? history : history.slice(0, 10)).map(d => {
                      const isBuy = (d.type || '').includes('BUY');
                      const profit = Number(d.profit ?? 0);
                      return (
                        <tr key={d.id} className="hover:bg-gray-800/30">
                          <td className="py-2 text-white font-medium">{d.symbol || '—'}</td>
                          <td className="py-2"><span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span></td>
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
              {history.length > 10 && (
                <button onClick={() => setShowAllHistory(s => !s)}
                  className="mt-3 w-full text-xs text-amber-400 hover:text-amber-300 bg-gray-800/40 hover:bg-gray-800 rounded-lg py-2 transition-colors">
                  {showAllHistory ? t('Shfaq më pak') : t('Shfaq të gjitha ({n})', { n: history.length })}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 3) Sinjalet e vjetra (të përfunduara) — nën tabelën e trade-ve të mbyllura */}
      <CompletedSignals signals={doneSignals} variant="compact" />

      {/* 4) Ekzekutimet e fundit — në fund */}
      <OpenPositionsPanel configured={metaConfigured} section="executions" />
    </div>
  );
}
