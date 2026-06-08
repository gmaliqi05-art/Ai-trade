import { useEffect, useState, useCallback } from 'react';
import {
  Activity, RefreshCw, Loader2, TrendingUp, Zap, Brain,
  Wallet, AlertCircle, History, ChevronDown, ShieldCheck, Eye, EyeOff,
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
import { groupDeals, attachSource, type ClosedTrade, type TradeSource, type ExecRow } from '../services/closedTrades';
import { useI18n } from '../i18n/i18n';

interface Asset { id: string; symbol: string; name: string; category: string; current_price: number; }
interface Signal {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  source: string; created_at: string; timeframe?: string | null; analysis?: string | null;
  status?: string; outcome?: string | null; result_pct?: number | null; closed_at?: string | null;
}

// Orë e saktë e sinjalit (dt + orë:min).
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Përputhja e simbolit të platformës (p.sh. UKOIL) me simbolin REAL të brokerit te pozicioni
// (p.sh. UKOUSD/XBRUSD/BRENT për Brent, XTIUSD/WTI/CL për WTI). Pa këtë, linjat e pozicionit
// (Hyrje/SL/TP) s'shfaqeshin për naftën sepse emrat ndryshojnë (ari përputhej saktë).
function symMatch(sel: string, posSym: string): boolean {
  const A = (sel || '').toUpperCase(), B = (posSym || '').toUpperCase();
  if (!A || !B) return false;
  if (A === B || A.startsWith(B) || B.startsWith(A)) return true;
  if (/XAU|GOLD/.test(A) && /XAU|GOLD/.test(B)) return true;          // ari
  const brent = (s: string) => /^(UKOIL|XBR|BRENT|UKO)/.test(s);     // Brent
  const wti = (s: string) => /^(USOIL|XTI|WTI|CL|USO)/.test(s);       // WTI
  if (brent(A) && brent(B)) return true;
  if (wti(A) && wti(B)) return true;
  return false;
}

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
  const [tf, setTf] = useState('1m');
  // Simbolet e lejuara nga cilësimet (auto_symbols). Ari default; të tjerat shtohen te Cilësimet.
  const [allowedSymbols, setAllowedSymbols] = useState<string[]>(['XAUUSD']);

  const [metaConfigured, setMetaConfigured] = useState(false);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<ClosedTrade[]>([]);
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
  const [showSignalInfo, setShowSignalInfo] = useState(false);
  const [confirmNoSLTP, setConfirmNoSLTP] = useState(false);
  const [showBalances, setShowBalances] = useState(false); // privatësi: shifrat e fshehura (të turbullta) si default

  // Plotëson SL/TP default rreth çmimit aktual (gold: SL $3, TP $6), sipas drejtimit.
  const fillDefaultProtection = () => {
    const px = candles.length ? candles[candles.length - 1].close : (assets.find(a => a.symbol === selected)?.current_price || 0);
    if (!(px > 0)) return;
    const slD = 3, tpD = 6;
    if (tradeType === 'buy') { setNewSl((px - slD).toFixed(2)); setNewTp((px + tpD).toFixed(2)); }
    else { setNewSl((px + slD).toFixed(2)); setNewTp((px - tpD).toFixed(2)); }
    setConfirmNoSLTP(false);
    setTradeMsg(null);
  };

  const goldFirst = (arr: Asset[]) =>
    [...arr].sort((a, b) => (a.symbol === 'XAUUSD' ? 0 : a.category === 'commodity' ? 1 : 2) - (b.symbol === 'XAUUSD' ? 0 : b.category === 'commodity' ? 1 : 2));

  const fetchBase = useCallback(async () => {
    const now = new Date().toISOString();
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // sinjalet > 24h fshihen
    const [ar, sr, dr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, category, current_price').eq('is_active', true).gt('current_price', 0),
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, timeframe, analysis')
        .eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${now}`).gte('created_at', since24).order('confidence', { ascending: false }).limit(8),
      // Sinjalet e PËRFUNDUARA (TP/SL/skaduar) të 24h të fundit — historiku i plotë te Raportet.
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, outcome, result_pct, closed_at')
        .in('status', ['hit_tp', 'hit_sl', 'expired']).gte('closed_at', since24).order('closed_at', { ascending: false }).limit(12),
    ]);
    if (ar.data) setAssets(goldFirst(ar.data as Asset[]));
    if (sr.data) setSignals(sr.data as Signal[]);
    if (dr.data) setDoneSignals(dr.data as Signal[]);
  }, []);

  // Lexon gjendjen reale të MT5: llogaria + historiku.
  const fetchMeta = useCallback(async () => {
    if (!user) return;
    let cfg;
    // Dështim kalimtar i ngarkimit (rrjet) → ruaj gjendjen e fundit, mos pulso te "i palidhur".
    try { cfg = await loadMetaApiConfig(user.id); } catch { return; }
    const configured = !!(cfg.account_id && cfg.token);
    setMetaConfigured(configured);
    setMtMode(cfg.mode);
    // Lista e simboleve për tab-et — Ari gjithmonë + ato që ka aktivizuar përdoruesi te Cilësimet.
    setAllowedSymbols(['XAUUSD', ...(cfg.auto_symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'XAUUSD')]);
    if (configured) {
      const [acc, hist, pos] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(), loadOpenPositions()]);
      if (!acc.error && acc.account) setAccount(acc.account);
      if (!hist.error && Array.isArray(hist.deals)) {
        // Grupon deal-et në trade me DREJTIMIN REAL (jo nga deal-i mbyllës) + lidh burimin.
        const grouped = groupDeals(hist.deals as HistoryDeal[]);
        const sinceIso = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
        const { data: execs } = await supabase
          .from('trade_executions')
          .select('action, symbol, signal_id, reason, created_at')
          .eq('user_id', user.id).eq('status', 'executed')
          .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(500);
        attachSource(grouped, (execs as ExecRow[]) || []);
        setHistory(grouped);
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
    // Paralajmërim: trade pa SL/TP = pa mbrojtje. Kërko konfirmim ose plotësim default.
    if ((sl == null || tp == null) && !confirmNoSLTP) {
      const what = sl == null && tp == null ? t('SL dhe TP') : sl == null ? t('SL') : t('TP');
      setConfirmNoSLTP(true);
      setTradeMsg({ type: 'error', text: t('⚠️ Ky trade s\'ka {what} — pa këtë mbrojtje rrezikon humbje të pakontrolluar. Kliko "Vendos SL/TP default", plotësoji vetë, ose kliko sërish BLEJ/SHIT për të vazhduar pa to.', { what }) });
      return;
    }
    setTradeLoading(true); setTradeMsg(null); setConfirmNoSLTP(false);
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

  // Etiketa e burimit të trade-it (Auto / Signal / Manual / MT5).
  const srcMeta: Record<TradeSource, { label: string; cls: string }> = {
    auto: { label: t('Auto'), cls: 'bg-amber-500/20 text-amber-400' },
    signal: { label: t('Signal'), cls: 'bg-blue-500/20 text-blue-400' },
    manual: { label: t('Manual'), cls: 'bg-green-500/20 text-green-400' },
    mt5: { label: t('MT5'), cls: 'bg-gray-600/40 text-gray-400' },
  };

  // Horizonti: periudha të shkurtra (1m/5m/15m) = afat-shkurt; përndryshe afat-gjatë (swing).
  const SHORT_TFS = ['1m', '5m', '15m'];
  const isShortHorizon = (tf?: string | null) => !!tf && SHORT_TFS.includes(tf);
  const horizonLabel = (tf?: string | null) => isShortHorizon(tf) ? t('Afat-shkurt') : t('Afat-gjatë');

  // Përkthen një pjesë të analizës së motorit (vocabular i njohur) — përndryshe e kthen si është.
  const translateReason = (raw: string): string => {
    const s = raw.trim().replace(/^Motori( AI)?:\s*/i, '');
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^Confluence (\d+)\/(\d+) \((\d+)%\)/))) return t('Konfluencë {a}/{b} ({p}%)', { a: m[1], b: m[2], p: m[3] });
    if ((m = s.match(/^Multi-TF: 1h\+4h pajtohen \((BLEJ|SHIT)\)/))) return t('Multi-TF: 1h+4h pajtohen ({dir})', { dir: m[1] === 'BLEJ' ? t('BLEJ') : t('SHIT') });
    if ((m = s.match(/^Trendi: çmimi (mbi|nën) EMA200/))) return t('Trendi: çmimi {pos} EMA200', { pos: m[1] === 'mbi' ? t('mbi') : t('nën') });
    if ((m = s.match(/^ADX (\d+) \(trend i fortë\)/))) return t('ADX {n} (trend i fortë)', { n: m[1] });
    if (/^Sesioni London\+NY/.test(s)) return t('Sesioni London+NY (likuiditet maksimal)');
    if (/^Sesion aktiv/.test(s)) return t('Sesion aktiv (Frankfurt/Europë)');
    if ((m = s.match(/^Volatilitet normal \(ATR (.+?)%\)/))) return t('Volatilitet normal (ATR {x}%)', { x: m[1] });
    if ((m = s.match(/^Në harmoni me trendin ditor \((rritës|rënës)\)/))) return t('Në harmoni me trendin ditor ({d})', { d: m[1] === 'rritës' ? t('rritës') : t('rënës') });
    if ((m = s.match(/^Nivele kyçe: mbështetje ~\$(.+?), rezistencë ~\$(.+)/))) return t('Nivele kyçe: mbështetje ~${a}, rezistencë ~${b}', { a: m[1], b: m[2] });
    if (/^ADX i fortë/.test(s)) return t('ADX i fortë (≥25)');
    if ((m = s.match(/^RSI me hapësirë \((\d+)\)/))) return t('RSI me hapësirë ({n})', { n: m[1] });
    if (/^MACD në harmoni/.test(s)) return t('MACD në harmoni');
    return s;
  };
  const analysisParts = (a?: string | null) => (a || '').split(';').map(p => p.trim()).filter(Boolean).map(translateReason);

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

  // Dorëzim nga ProTrade Intelligence: aplikon sinjalin e zgjedhur kur hapet faqja (mbush tabelën si ari).
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem('protrade_apply_signal'); } catch { return; }
    if (!raw) return;
    try { localStorage.removeItem('protrade_apply_signal'); } catch { /* injoro */ }
    try {
      const s = JSON.parse(raw) as Signal;
      if (s && s.symbol) applySignal(s);
    } catch { /* injoro */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ndërrim manual i simbolit (nga butonat) → pastron SL/TP e sinjalit të aplikuar.
  const pickSymbol = (sym: string) => {
    setSelected(sym);
    setAppliedSignalId(null);
    setNewEntry(''); setNewSl(''); setNewTp('');
  };

  // Pozicioni i hapur për simbolin e zgjedhur → linjat Hyrje/SL/TP + modifikim.
  const posForSymbol = positions.find(p => symMatch(selected, p.symbol)) || null;
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
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-amber-400" />{t('MetaTrader 5 — Live')}
          </h2>
          <p className="text-gray-400 text-[11px] mt-0.5">
            {t('Llogaria jote reale MT5, grafiku, tregtimi dhe trade-t — live')}
            {lastUpdated && <span className="ml-2 text-gray-600">· {lastUpdated.toLocaleTimeString()}</span>}
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

      {/* Gjendja e llogarisë — kompakte; shifrat e fshehura për privatësi (klik mbi to për t'i shfaqur/fshehur) */}
      {metaConfigured && (
        <div onClick={() => setShowBalances(s => !s)} title={t('Klik për të shfaqur/fshehur')}
          className="grid grid-cols-2 lg:grid-cols-4 gap-2 cursor-pointer select-none">
          {[
            { label: t('Balanca'), value: `${money(account?.balance)} ${cur}`, icon: Wallet, cls: 'text-white' },
            { label: t('Equity'), value: `${money(account?.equity)} ${cur}`, icon: Activity, cls: 'text-white' },
            { label: t('Fitim/Humbje'), value: `${(account?.profit ?? 0) >= 0 ? '+' : ''}${money(account?.profit)}`, icon: TrendingUp, cls: (account?.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: t('Marzh i lirë'), value: `${money(account?.freeMargin)} ${cur}`, icon: Wallet, cls: 'text-white' },
          ].map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-2">
                <div className="flex items-center justify-between text-gray-500 text-[10px] mb-0.5">
                  <span className="flex items-center gap-1"><Icon className="w-3 h-3" />{c.label}</span>
                  {i === 0 && (showBalances ? <Eye className="w-3 h-3 text-gray-500" /> : <EyeOff className="w-3 h-3 text-gray-500" />)}
                </div>
                <div className={`font-bold text-[13px] transition-all ${c.cls} ${showBalances ? '' : 'blur-[6px]'}`}>{c.value}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* GRAFIK — full width (të dhëna reale nga MT5 kur je i lidhur) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {assets.filter(a => allowedSymbols.includes(a.symbol)).map(a => (
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
                <Mt5Chart candles={candles} lines={chartLines} height={460} fitKey={`${selected}_${tf}`} />
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

      {/* Porosi e re (nën grafik) */}
      <div className="lg:max-w-md">
        {/* Porosia BLEJ/SHIT — kompakte */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2 h-fit">
          <h3 className="text-white font-semibold text-sm">{t('Porosi e re — {sym}', { sym: selected })}</h3>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button onClick={() => setTradeType('buy')} className={`flex-1 py-2 text-sm font-semibold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('BLEJ')}</button>
            <button onClick={() => setTradeType('sell')} className={`flex-1 py-2 text-sm font-semibold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('SHIT')}</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-400 text-xs shrink-0 w-8">{t('Lot')}</label>
            <input type="number" value={lot} onChange={e => setLot(e.target.value)} min="0.01" step="0.01"
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {['0.01', '0.05', '0.10', '0.25'].map(v => (
              <button key={v} onClick={() => setLot(v)} className={`text-[11px] py-1.5 rounded-lg transition-colors ${lot === v ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}>{v}</button>
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
          {confirmNoSLTP && (
            <button onClick={fillDefaultProtection} className="w-full flex items-center justify-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded-xl py-2 text-xs font-semibold transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" />{t('Vendos SL/TP default')}
            </button>
          )}
          <button onClick={handleTrade} disabled={tradeLoading || !metaConfigured}
            className={`w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
            {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}{tradeType === 'buy' ? t('BLEJ') : t('SHIT')} {selected}
          </button>
          <button onClick={() => onNavigate('chart_analysis')} className="w-full flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl py-1.5 text-xs font-medium transition-colors">
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
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isShortHorizon(latestSignal.timeframe) ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{horizonLabel(latestSignal.timeframe)}</span>
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

            {/* Raporti i analizës — si u krijua sinjali + filtrat që kaloi */}
            {latestSignal && (
              <>
                <button onClick={() => setShowSignalInfo(s => !s)}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 bg-gray-800/40 hover:bg-gray-800 rounded-lg py-1.5 transition-colors">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSignalInfo ? 'rotate-180' : ''}`} />{t('Si u krijua ky sinjal')}
                </button>
                {showSignalInfo && (
                  <div className="mt-2 bg-gray-800/40 border border-gray-700/50 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-gray-500">{t('Lloji')}: </span><span className={isShortHorizon(latestSignal.timeframe) ? 'text-amber-400' : 'text-blue-400'}>{horizonLabel(latestSignal.timeframe)}</span></div>
                      <div><span className="text-gray-500">{t('Periudha')}: </span><span className="text-white">{latestSignal.timeframe || '1h'}</span></div>
                      <div><span className="text-gray-500">{t('Burimi')}: </span><span className="text-white">{latestSignal.source === 'engine' ? t('Motori AI') : latestSignal.source}</span></div>
                      <div><span className="text-gray-500">{t('Besueshmëria')}: </span><span className="text-amber-400 font-semibold">{latestSignal.confidence}%</span></div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">{t('Filtrat që kaloi')}</div>
                      {analysisParts(latestSignal.analysis).length > 0 ? (
                        <ul className="space-y-1">
                          {analysisParts(latestSignal.analysis).map((p, i) => (
                            <li key={i} className="text-[11px] text-gray-300 flex gap-1.5"><span className="text-green-400">✓</span>{p}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-gray-500">{t('Pa detaje analize.')}</p>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-600 leading-snug">{t('Sinjali u gjenerua nga motori mbi çmime LIVE kur këto filtra u plotësuan njëkohësisht. Afat-gjatë = mbahet më gjatë (orë/ditë); afat-shkurt = lëvizje e shpejtë.')}</p>
                  </div>
                )}
              </>
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
                      <th className="text-left font-medium py-2">{t('Burimi')}</th>
                      <th className="text-right font-medium py-2">{t('Lot')}</th>
                      <th className="text-right font-medium py-2">{t('Hyrje')}</th>
                      <th className="text-right font-medium py-2">{t('Fitim/Humbje')}</th>
                      <th className="text-right font-medium py-2">{t('Koha')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {(showAllHistory ? history : history.slice(0, 10)).map(d => {
                      const isBuy = d.direction === 'BUY';
                      const src = srcMeta[d.source || 'mt5'];
                      return (
                        <tr key={d.id} className="hover:bg-gray-800/30">
                          <td className="py-2 text-white font-medium">{d.symbol || '—'}</td>
                          <td className="py-2"><span className={`font-bold ${isBuy ? 'text-green-400' : d.direction === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>{isBuy ? t('BLEJ') : d.direction === 'SELL' ? t('SHIT') : '—'}</span></td>
                          <td className="py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${src.cls}`}>{src.label}</span></td>
                          <td className="py-2 text-right text-gray-300">{d.volume || '—'}</td>
                          <td className="py-2 text-right text-gray-300">{d.entryPrice != null ? d.entryPrice : '—'}</td>
                          <td className={`py-2 text-right font-semibold ${d.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{d.net >= 0 ? '+' : ''}{d.net.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-500">{d.closeTime ? new Date(d.closeTime).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
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

      {/* 3) Sinjalet aktive (lista e plotë) — nën Trade-t e mbyllura (sinjale të vjetra, klik për të mbushur formën) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />{t('Sinjalet')}</h3>
          <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300">{t('Të gjitha')}</button>
        </div>
        {signals.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë sinjal aktiv tani.')}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {signals.map(s => {
              const fresh = signalIsFresh(s.created_at);
              return (
              <button key={s.id} onClick={() => applySignal(s)} className={`text-left rounded-xl px-3 py-2 transition-colors border ${appliedSignalId === s.id ? 'bg-amber-500/10 border-amber-500/40' : 'bg-gray-800/40 border-transparent hover:bg-gray-800'} ${fresh ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{s.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isShortHorizon(s.timeframe) ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{horizonLabel(s.timeframe)}</span>
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

      {/* 4) Sinjalet e vjetra (të përfunduara) */}
      <CompletedSignals signals={doneSignals} variant="compact" />
    </div>
  );
}
