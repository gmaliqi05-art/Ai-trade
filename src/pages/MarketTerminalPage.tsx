import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Activity, RefreshCw, Loader2, TrendingUp, Zap, Brain,
  Wallet, AlertCircle, History, ChevronDown, ShieldCheck, Eye, EyeOff,
  ArrowUp, ArrowDown, Clock, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage } from '../App';
import Mt5Chart, { type ChartCandle, type PriceLineDef, type EditableSlTp } from '../components/Mt5Chart';
import OpenPositionsPanel from '../components/OpenPositionsPanel';
import CompletedSignals from '../components/CompletedSignals';
import SignalScanLog from '../components/SignalScanLog';
import {
  loadMetaApiConfig, checkMetaApiConnection, executeTrade, loadTradeHistory,
  loadCandles, loadOpenPositions, modifyPosition, loadSymbolPrice, loadPositionCloses, recordClose,
  loadPreOpenOrders, cancelPreOpenOrder,
  type AccountInfo, type HistoryDeal, type OpenPosition, type PreOpenOrder,
} from '../services/metaapi';
import { fetchCandles, type Timeframe } from '../ai-trader/market/candles';
import { metaStream } from '../services/metaStream';
import { useMetaStream } from '../hooks/useMetaStream';
import { groupDeals, attachSource, fasttFromExecutions, closesFromPositions, exitKind, positionHorizon, type ClosedTrade, type TradeSource, type ExecRow, type FasttExecRow, type HorizonExec } from '../services/closedTrades';
import { useI18n, dtLocale } from '../i18n/i18n';

interface Asset { id: string; symbol: string; name: string; category: string; current_price: number; }
interface Signal {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  source: string; created_at: string; timeframe?: string | null; analysis?: string | null;
  status?: string; outcome?: string | null; result_pct?: number | null; closed_at?: string | null;
}

// Orë e saktë e sinjalit (dt + orë:min).
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(dtLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Tregu FX/metale i hapur tani? Mbyllur fundjavën (E premte 21:00 UTC → E diel 22:00 UTC).
function isMktOpen(d = new Date()): boolean {
  const day = d.getUTCDay(), h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && h < 22) return false;
  if (day === 5 && h >= 21) return false;
  return true;
}
// Ms deri në hapjen e radhës (E diel 22:00 UTC) kur tregu është i mbyllur; 0 nëse hapur.
function msToOpen(d = new Date()): number {
  if (isMktOpen(d)) return 0;
  const next = new Date(d);
  while (next.getUTCDay() !== 0) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(22, 0, 0, 0);
  if (next.getTime() <= d.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next.getTime() - d.getTime();
}
function fmtCountdown(ms: number): string {
  const tot = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

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

// Cikli i jetës së sinjalit në ekran:
//  • 0–5 min  → AKTIV për tregtim (çmimi ende afër hyrjes); 1 min i parë = pikë e gjelbër ndriçuese (i ri).
//  • 5–15 min → "I VJETËR" (OLD) — shfaqet, por mos tregto (çmimi ka lëvizur).
//  • >15 min  → hiqet nga lista.
const SIGNAL_TRADE_MIN = 5;   // aktiv për tregtim
const SIGNAL_HIDE_MIN = 15;   // pas kësaj fshihet nga lista
const SIGNAL_NEW_MIN = 1;     // pikë e gjelbër ndriçuese për sinjalin e sapoardhur
const SIGNAL_FRESH_MIN = SIGNAL_TRADE_MIN; // emër i ruajtur (mbrojtja e tregtisë manuale)
const signalAgeMin = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);
const signalIsFresh = (iso?: string | null) => signalAgeMin(iso) <= SIGNAL_FRESH_MIN;
const signalIsNew = (iso?: string | null) => signalAgeMin(iso) <= SIGNAL_NEW_MIN;
const signalVisible = (iso?: string | null) => signalAgeMin(iso) <= SIGNAL_HIDE_MIN;
// Loti që do tregtonte roboti i sinjaleve sipas besueshmërisë (pasqyron auto-trade-runner).
const signalLotByConfidence = (conf: number) => (conf >= 90 ? 0.03 : conf >= 80 ? 0.02 : 0.01);

function errText(t: (k: string) => string, code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: t('Lidh llogarinë MT5 te Lidhja & Konfigurimi para se të tregtosh.'),
    metaapi_unreachable: t("S'u arrit MetaApi — kontrollo lidhjen."),
    metaapi_syncing: t('Llogaria po lidhet/sinkronizohet — prit 1–2 min dhe provo prapë.'),
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
  // Id-të e pozicioneve FastT (nga logu) — për të klasifikuar saktë pozicionet e hapura si Afatshkurtër
  // edhe kur brokeri NUK ruan komentin "FastT" te pozicioni i kthyer nga MT5.
  const [execLog, setExecLog] = useState<HorizonExec[]>([]);
  const [selected, setSelected] = useState('XAUUSD');
  const [tf, setTf] = useState('1m');
  // Simbolet e lejuara nga cilësimet (auto_symbols). Ari default; të tjerat shtohen te Cilësimet.
  const [allowedSymbols, setAllowedSymbols] = useState<string[]>(['XAUUSD']);

  const [metaConfigured, setMetaConfigured] = useState(false);
  // Lidhja DIREKTE streaming (websocket) — kredencialet për ta nisur + snapshot-i live.
  const [streamCfg, setStreamCfg] = useState<{ token: string; accountId: string; region: string } | null>(null);
  const stream = useMetaStream();
  const streamLive = stream.status === 'live';
  // "I shëndetshëm" = i lidhur DHE po jep tick-e të freskëta (< 6s). Vetëm atëherë e fikim REST-in;
  // nëse lidhet por s'jep çmim (p.sh. emër simboli ende pa u zgjidhur), REST rikthehet vetvetiu.
  const streamHealthy = streamLive && stream.lastTickAt > 0 && (stream.updatedAt - stream.lastTickAt < 6000);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<ClosedTrade[]>([]);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [brokerPx, setBrokerPx] = useState<{ bid: number; ask: number } | null>(null); // çmimi LIVE i broker-it për 'selected'
  const [pxDir, setPxDir] = useState<'up' | 'down' | 'flat'>('flat'); // drejtimi i lëvizjes së fundit (ticker)
  const [pxTick, setPxTick] = useState(0); // çelës rirenderimi → flash në çdo ndryshim çmimi
  const [pxAt, setPxAt] = useState(0);     // koha (ms) e çmimit të fundit LIVE të suksesshëm nga brokeri
  const [pxClock, setPxClock] = useState(Date.now()); // rrah çdo 1s për të rivlerësuar freskinë e çmimit
  const lastMidRef = useRef<number | null>(null);
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [modifyMsg, setModifyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modifyBusy, setModifyBusy] = useState(false);
  const [activePosId, setActivePosId] = useState<string | null>(null); // pozicioni në modë editimi SL/TP mbi grafik

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [lot, setLot] = useState('0.01');
  const [showNewOrder, setShowNewOrder] = useState(false); // forma manuale e palosur si default; hapet me klik ose nga sinjali
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
  const [preOpenOrders, setPreOpenOrders] = useState<PreOpenOrder[]>([]); // porositë para-hapjeje (radhë/pending te brokeri)
  const [nowTs, setNowTs] = useState(Date.now()); // tik për numëruesin e hapjes së tregut

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

  // Porositë para-hapjeje (radhë/pending) + numëruesi i hapjes — rifreskim çdo 15s.
  const loadPreOpen = useCallback(async () => {
    if (user) setPreOpenOrders(await loadPreOpenOrders(user.id));
  }, [user]);
  useEffect(() => {
    loadPreOpen();
    const id = setInterval(() => { loadPreOpen(); setNowTs(Date.now()); }, 15000);
    return () => clearInterval(id);
  }, [loadPreOpen]);
  const cancelPreOpen = async (id: string) => { await cancelPreOpenOrder(id); loadPreOpen(); };

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
    // Ushqe lidhjen direkte streaming (vetëm kur ndryshojnë kredencialet → shmang rinisjet e kota).
    if (configured) {
      setStreamCfg(prev => (prev && prev.token === cfg!.token && prev.accountId === cfg!.account_id && prev.region === cfg!.region)
        ? prev : { token: cfg!.token, accountId: cfg!.account_id, region: cfg!.region });
    } else setStreamCfg(null);
    // Lista e simboleve për tab-et — Ari gjithmonë + ato që ka aktivizuar përdoruesi te Cilësimet.
    setAllowedSymbols(['XAUUSD', ...(cfg.auto_symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'XAUUSD')]);
    if (configured) {
      const [acc, hist, pos, posCloseRows] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(), loadOpenPositions(), loadPositionCloses(user.id)]);
      if (!acc.error && acc.account) setAccount(acc.account);
      // Mbylljet e regjistruara nga serveri (close-tracker + manual) — burim i qëndrueshëm, S'varet nga MT5.
      const posCloses = closesFromPositions(posCloseRows);
      const posCloseIds = new Set(posCloses.map(p => p.id));
      // Trade-t e FastT-it ndërtohen DIREKT nga logu i robotit (trade_executions) — shfaqen GJITHMONË,
      // edhe nëse historiku i MT5 dështon (502). Trade-t e tjera (manual/auto) merren nga historiku i MT5.
      const sinceIso = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      const { data: execsAll } = await supabase
        .from('trade_executions')
        .select('status, action, symbol, volume, entry_price, stop_loss, take_profit, signal_id, reason, created_at, metaapi_order_id')
        .eq('user_id', user.id)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(1000);
      const rows = (execsAll || []) as Array<FasttExecRow & ExecRow>;
      const fastt = fasttFromExecutions(rows);
      const fasttIds = new Set(fastt.map(f => f.id));
      // Id-të e pozicioneve të hapura nga FastT (orderId i hapjes == positionId) — për klasifikim të saktë
      // të pozicioneve të hapura si Afatshkurtër edhe kur brokeri s'e ruan komentin "FastT".
      setExecLog(rows as HorizonExec[]);
      let mt5Rest: ClosedTrade[] = [];
      if (!hist.error && Array.isArray(hist.deals)) {
        const grouped = groupDeals(hist.deals as HistoryDeal[]);
        attachSource(grouped, rows.filter(r => r.status === 'executed') as ExecRow[]);
        // Jo-FastT (sinjal/manual/auto) merren GJITHMONË nga MT5. FastT-in e marrim nga logu (më i freskët),
        // POR shtojmë edhe FastT-trade-t e MT5 që S'janë në log — p.sh. të mbyllura MANUALISHT, ose me SL
        // pasi roboti u ndal (përndryshe nuk shfaqeshin askund). Dedup me id (orderId i hapjes == positionId në MT5).
        // Përjashto nga MT5 ato që i kemi nga serveri (position_closes) ose nga logu FastT (pa dyfishim).
        mt5Rest = grouped.filter(t => !posCloseIds.has(t.id) && (t.source !== 'fastt' || !fasttIds.has(t.id)));
      }
      // FastT-trade-t e logut që S'janë te position_closes (mbylljet e shpejta të scalp-live).
      const fasttDedup = fastt.filter(f => !posCloseIds.has(f.id));
      setHistory([...posCloses, ...fasttDedup, ...mt5Rest].sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || '')));
      if (!pos.error && Array.isArray(pos.positions)) setPositions(pos.positions);
    }
    setLastUpdated(new Date());
  }, [user]);

  // Poll i shpejtë VETËM i pozicioneve (P&L live + numri i tyre) — më i shpeshtë se fetch-i i plotë,
  // pa ri-tërhequr historikun/llogarinë. Përditëson VETËM në sukses (ruan të fundit në gabim kalimtar).
  const fetchPositions = useCallback(async () => {
    if (!user || !metaConfigured) return;
    const pos = await loadOpenPositions();
    if (!pos.error && Array.isArray(pos.positions)) setPositions(pos.positions);
  }, [user, metaConfigured]);

  // KOHË REALE: kap mbylljet (TP/SL/auto) sapo pozicioni zhduket nga feed-i live i MT5, regjistroji
  // MENJËHERË te position_closes dhe rifresko listën e mbyllur — pa pritur close-tracker-in (2 min).
  const prevPosIdsRef = useRef<Set<string>>(new Set());
  const posReadyRef = useRef(false);
  useEffect(() => {
    if (!metaConfigured) return;
    const cur = new Set(positions.map(p => p.id));
    const prev = prevPosIdsRef.current;
    prevPosIdsRef.current = cur;
    // Prit derisa të kemi marrë të paktën një herë pozicionet (shmang "mbyllje" false në ngarkim).
    if (!posReadyRef.current) { posReadyRef.current = true; return; }
    const closed = [...prev].filter(id => !cur.has(id));
    if (closed.length === 0) return;
    (async () => {
      await new Promise(r => setTimeout(r, 1500)); // lër deal-in OUT të regjistrohet te brokeri
      await Promise.all(closed.map(id => recordClose(id).catch(() => {})));
      fetchMeta(); // rifresko "Trade-t e mbyllura" (përfshin mbylljet e reja)
    })();
  }, [positions, metaConfigured, fetchMeta]);

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
      // MT5 i konfiguruar por leximi i qirinjve dështoi/erdhi bosh (kalimtar) → RUAJ qirinjtë e fundit
      // dhe mos kalo te feed-i PAXG/treg (që ka SHKALLË tjetër çmimi → shkakton mospërputhje me pozicionet).
      // Feed-i rezervë përdoret VETËM kur MT5 s'është konfiguruar fare.
      if (metaConfigured) return;
      const px = assets.find(a => a.symbol === selected)?.current_price || 0;
      try {
        const res = await fetchCandles({ symbol: selected, currentPrice: px, timeframe: tf as Timeframe, limit: 300 });
        out = res.candles.map(c => ({ time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close }));
      } catch { /* lëre bosh */ }
    }
    setCandles(out);
  }, [metaConfigured, selected, tf, assets]);

  useEffect(() => {
    loadChart();
    // Poll i shpejtë i qirinjve (çdo 5s) → grafiku + çmimi i fundit lëvizin pothuajse në kohë reale.
    const id = setInterval(loadChart, 5000);
    return () => clearInterval(id);
  }, [loadChart]);

  // Çmimi LIVE i broker-it (bid/ask) për simbolin e zgjedhur — çdo 2s. Bën vijën "Tani" dhe
  // P&L-në në grafik real-time (përkon me mbylljen e broker-it), pa pritur leximin 3s të pozicioneve.
  // Lidhja DIREKTE streaming: nis kur ka kredenciale; mbyll websocket-in në dalje nga faqja.
  useEffect(() => {
    if (!streamCfg) return;
    metaStream.start(streamCfg.token, streamCfg.accountId, streamCfg.region);
    return () => { void metaStream.stop(); };
  }, [streamCfg]);

  // Abono simbolin e zgjedhur te streaming-u (quotes + candles 1m) sapo lidhja është gati.
  useEffect(() => {
    if (streamCfg && selected) void metaStream.subscribeSymbol(selected);
  }, [streamCfg, selected, stream.status]);

  // Ushqe çmimin nga streaming-u te e njëjta gjendje brokerPx/pxAt që përdor UI-ja (≈200ms, i shtyrë).
  useEffect(() => {
    if (!streamHealthy) return;
    const p = stream.prices[selected];
    if (!p || !(p.bid > 0 && p.ask > 0)) return;
    const mid = (p.bid + p.ask) / 2;
    const prev = lastMidRef.current;
    if (prev != null && Math.abs(mid - prev) > 1e-9) setPxDir(mid > prev ? 'up' : 'down');
    lastMidRef.current = mid;
    setBrokerPx({ bid: p.bid, ask: p.ask });
    setPxAt(p.time || Date.now());
    setPxClock(Date.now());
    setPxTick(k => k + 1);
  }, [streamHealthy, stream.updatedAt, selected]);

  // Pozicionet nga streaming-u (real-time) → P&L pa polling kur lidhja direkte jep tick-e.
  useEffect(() => {
    if (streamHealthy) setPositions(stream.positions as unknown as OpenPosition[]);
  }, [streamHealthy, stream.updatedAt]);

  // POLL REST i çmimit (rezervë): aktiv kur streaming-u s'po jep tick-e të freskëta.
  useEffect(() => {
    if (!metaConfigured || streamHealthy) { if (!metaConfigured) setBrokerPx(null); return; }
    let alive = true;
    setBrokerPx(null); setPxDir('flat'); lastMidRef.current = null; setPxAt(0);
    const tick = async () => {
      try {
        const r = await loadSymbolPrice(selected);
        const px = (r as { price?: { bid?: number; ask?: number } })?.price;
        const bid = Number(px?.bid), ask = Number(px?.ask);
        if (alive && bid > 0 && ask > 0) {
          const mid = (bid + ask) / 2;
          const prev = lastMidRef.current;
          const changed = prev == null || Math.abs(mid - prev) > 1e-9;
          if (prev != null && changed) setPxDir(mid > prev ? 'up' : 'down');
          lastMidRef.current = mid;
          setBrokerPx({ bid, ask });
          if (changed) setPxAt(Date.now()); // freskia rritet VETËM kur çmimi lëviz (frozen=mbyllur → jo-live)
          setPxTick(k => k + 1);
        }
      } catch { /* mban të fundit, por freskia bie → shënohet jo-live */ }
      if (alive) setPxClock(Date.now()); // rivlerëso freskinë edhe kur leximi dështon
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [metaConfigured, selected, streamHealthy]);

  useEffect(() => {
    fetchBase();
    fetchMeta();
    const id = setInterval(() => { fetchBase(); fetchMeta(); }, 20000);
    return () => clearInterval(id);
  }, [fetchBase, fetchMeta]);

  // Poll REST i pozicioneve (rezervë): aktiv kur streaming-u s'po jep tick-e të freskëta.
  useEffect(() => {
    if (!metaConfigured || streamHealthy) return;
    const id = setInterval(fetchPositions, 2000);
    return () => clearInterval(id);
  }, [metaConfigured, streamHealthy, fetchPositions]);

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
      if ((r as { queued?: boolean }).queued) {
        setTradeMsg({ type: 'success', text: t('Porosia {dir} {sym} ({vol} lot){extra} u vendos në RADHË — hyn automatikisht kur hapet tregu.', { dir, sym: selected, vol, extra }) });
      } else if (r.pending) {
        setTradeMsg({ type: 'success', text: t('Porosi në pritje {dir} {sym} ({vol} lot) @ {price}{extra} — hyn automatik kur çmimi e arrin ({mode}).', { dir, sym: selected, vol, price: r.open_price ?? entry ?? '', extra, mode: r.mode ?? '' }) });
      } else {
        setTradeMsg({ type: 'success', text: t('Urdhër {dir} {sym} ({vol} lot){extra} dërguar ({mode}).', { dir, sym: selected, vol, extra, mode: r.mode ?? '' }) });
      }
      fetchMeta();
      loadPreOpen();
    }
    setTradeLoading(false);
  };

  // Etiketa e burimit të trade-it (Auto / Signal / Manual / MT5).
  const srcMeta: Record<TradeSource, { label: string; cls: string }> = {
    fastt: { label: t('FastT'), cls: 'bg-rose-500/20 text-rose-400' },
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
  // Pas 15 min hiqet (pxClock rifreskon çdo 1s → rivlerësohet automatikisht).
  const latestSignalRaw = signals.length
    ? [...signals].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    : null;
  const latestSignal = latestSignalRaw && signalVisible(latestSignalRaw.created_at) ? latestSignalRaw : null;

  // Përmbledhje P&L për pasqyrë: LIVE (lundrues, pozicionet e hapura tani) + SOT (realizuar sot + live)
  // + GJITHSEJ (realizuar nga historiku i disponueshëm + live). I jep përdoruesit gjendjen e tregtimit.
  const floatingPnl = Number(account?.profit ?? 0);
  const todayStr = new Date().toDateString();
  const realizedToday = history.reduce((a, h) => a + ((h.closeTime && new Date(h.closeTime).toDateString() === todayStr) ? (h.net || 0) : 0), 0);
  const realizedTotal = history.reduce((a, h) => a + (h.net || 0), 0);
  const pnlToday = realizedToday + floatingPnl;
  const pnlTotal = realizedTotal + floatingPnl;
  const pnlCard = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${account?.currency || '$'}`;
  const pnlCls = (v: number) => v >= 0 ? 'text-green-400' : 'text-red-400';

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
    setLot(String(signalLotByConfidence(Number(s.confidence) || 0)));
    setShowNewOrder(true); // hap automatik formën manuale me të dhënat e sinjalit
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

  // Të GJITHA pozicionet e hapura për simbolin e zgjedhur (mund të jenë disa njëkohësisht).
  const posnsForSymbol = positions.filter(p => symMatch(selected, p.symbol));
  const posForSymbol = posnsForSymbol[0] || null; // i pari — për panelin "Ndrysho SL/TP" + prefill
  // Afatshkurtër = scalp (auto-trade-runner: tag 'SCALP') OSE FastT (scalp-live: tag 'FastT').
  // Kapet nga komenti OSE nga id-ja te logu i FastT-it (kur brokeri s'e ruan komentin "FastT").
  const isPosScalp = (p: { id?: string; type?: string; comment?: string; clientId?: string; openPrice?: number } | null) =>
    !!p && positionHorizon(p, execLog) === 'short';
  const posIsScalp = isPosScalp(posForSymbol);
  const fcur = account?.currency || '$';
  const posVpp = /XAU/i.test(selected) ? 100 : /(USOIL|UKOIL|WTI|BRENT)/i.test(selected) ? 1000 : 100;
  const r2 = (n: number) => n.toFixed(2);
  // Çmimi LIVE për simbolin: çmimi spot i aktivit (i freskët, përditësohet shpesh) ose, si rezervë,
  // mbyllja e qiririt të fundit. Përdoret për linjën "Tani" dhe si rezervë për P&L.
  const lastClose = candles.length ? candles[candles.length - 1].close : null;
  // FRESKIA e çmimit live: brokerPx vlen vetëm nëse u përditësua brenda ~4s. Përndryshe e
  // konsiderojmë JO-LIVE (mos shfaq fitim/humbje të rreme nga një çmim i ngrirë).
  // pxAt përditësohet VETËM kur çmimi LËVIZ (shih ticker-in/streaming-un). Pra "i freskët" do të
  // thotë "po lëviz" — jo thjesht "u mor një vlerë". Treg i mbyllur = çmim i ngrirë → JO-LIVE.
  const PX_FRESH_MS = 8000;
  const pxFresh = brokerPx != null && pxAt > 0 && (pxClock - pxAt) < PX_FRESH_MS;
  // Tregu duket i MBYLLUR/i ngrirë kur çmimi s'ka lëvizur prej >40s (ari i hapur s'rri kurrë kaq gjatë).
  const pxAgeMs = pxAt > 0 ? (pxClock - pxAt) : Infinity;
  const marketFrozen = brokerPx != null && pxAgeMs > 40000;
  // Çmimi mesatar LIVE i broker-it (bid/ask) për vijën "Tani" — VETËM kur është i freskët.
  const brokerMid = (pxFresh && brokerPx) ? (brokerPx.bid + brokerPx.ask) / 2 : null;
  // SINKRONIZIM REAL-TIME: "ngjit" çmimin LIVE të broker-it te qiriri i fundit, që trupi i grafikut të
  // tregojë GJITHMONË të njëjtin çmim si vija "Tani" dhe si kolona e pozicioneve (pa mospërputhje).
  // Qiriri i fundit ndjek broker-in çdo 1s; kur vjen qiri i ri nga MT5 (5s), ngjitja ri-aplikohet.
  const displayCandles = useMemo<ChartCandle[]>(() => {
    if (brokerMid == null || candles.length === 0) return candles;
    const out = candles.slice();
    const last = out[out.length - 1];
    out[out.length - 1] = {
      ...last,
      close: brokerMid,
      high: Math.max(last.high, brokerMid),
      low: Math.min(last.low, brokerMid),
    };
    return out;
  }, [candles, brokerMid]);
  const livePrice = (() => {
    if (brokerMid != null) return brokerMid; // çmimi REAL i broker-it, real-time
    const a = assets.find(x => symMatch(selected, x.symbol));
    const cp = a?.current_price;
    const spot = (cp != null && Number(cp) > 0) ? Number(cp) : null;
    if (metaConfigured && lastClose != null) return lastClose;
    return spot ?? lastClose;
  })();
  // P&L LIVE real-time: kalibron "njësi → fitim" nga profit-i i SAKTË i broker-it (monedhë/spread/komision
  // brenda) e pastaj e aplikon te çmimi LIVE (bid për BLEJ, ask për SHIT) → përkon me mbylljen. Pa çmim live
  // ose pozicion shumë i ri → profit-i i broker-it; përndryshe → vlerësim nga livePrice.
  // Kthen P&L-në VETËM kur çmimi është LIVE (i freskët); përndryshe null → UI tregon "jo-live".
  // Kështu s'shfaqet kurrë një fitim i rremë nga çmim i ngrirë, dhe numri përkon me mbylljen reale.
  const livePnlOf = (p: OpenPosition): number | null => {
    if (!pxFresh || !brokerPx) return null;
    const brokerProfit = p.profit != null ? Number(p.profit) : null;
    const open = p.openPrice != null ? Number(p.openPrice) : null;
    const cur = p.currentPrice != null ? Number(p.currentPrice) : null;
    const isBuy = (p.type || '').includes('BUY');
    if (brokerProfit != null && open != null && cur != null) {
      const dist = (cur - open) * (isBuy ? 1 : -1);
      if (Math.abs(dist) >= 0.05) {
        const closePx = isBuy ? brokerPx.bid : brokerPx.ask;
        return ((closePx - open) * (isBuy ? 1 : -1)) * (brokerProfit / dist);
      }
    }
    // Çmimi live ekziston por pozicioni shumë i ri (dist<0.05) → llogarit direkt nga bid/ask live.
    if (open != null) {
      const closePx = isBuy ? brokerPx.bid : brokerPx.ask;
      return (closePx - open) * (isBuy ? 1 : -1) * posVpp * (p.volume || 0);
    }
    return brokerProfit;
  };
  const riskOf = (p: OpenPosition) => (p.openPrice && p.stopLoss) ? Math.abs(p.openPrice - p.stopLoss) * posVpp * (p.volume || 0) : null;
  const rewardOf = (p: OpenPosition) => (p.openPrice && p.takeProfit) ? Math.abs(p.takeProfit - p.openPrice) * posVpp * (p.volume || 0) : null;
  // P&L-ja totale live — VETËM kur çmimi është i freskët; përndryshe null (jo-live).
  const totalLivePnl = (pxFresh && posnsForSymbol.length)
    ? posnsForSymbol.reduce((s, p) => s + (livePnlOf(p) ?? 0), 0) : null;
  const multiPos = posnsForSymbol.length > 1;
  // Pozicionet me SL/TP të editueshëm mbi grafik (si MetaTrader 5) — secili me pilulë te hyrja.
  const editables: EditableSlTp[] = posnsForSymbol
    .filter(p => p.openPrice)
    .map(p => ({
      positionId: p.id,
      entry: Number(p.openPrice),
      sl: p.stopLoss != null ? Number(p.stopLoss) : null,
      tp: p.takeProfit != null ? Number(p.takeProfit) : null,
      isBuy: (p.type || '').includes('BUY'),
      defStop: 3, defTake: 6,
    }));
  // Çaktivizo editimin e SL/TP kur pozicioni mbyllet ose ndërrohet simboli.
  const activeStillOpen = editables.some(e => e.positionId === activePosId);
  useEffect(() => { if (activePosId && !activeStillOpen) setActivePosId(null); }, [activePosId, activeStillOpen]);
  // Linjat: Hyrje/SL/TP për ÇDO pozicion + linja "Tani". SL/TP të pozicionit AKTIV (në editim) nuk
  // vizatohen këtu — i mbulon doreza e tërheqshme (që mos të dyfishohen).
  const chartLines: PriceLineDef[] = [
    ...posnsForSymbol.flatMap((p, i): PriceLineDef[] => {
      const isScalp = isPosScalp(p);
      const pnl = livePnlOf(p), risk = riskOf(p), reward = rewardOf(p);
      const tag = multiPos ? ` #${i + 1}` : '';
      const editing = activePosId === p.id;
      return [
        ...(p.openPrice ? [{ price: p.openPrice, color: '#3b82f6', title: `${t('Hyrje')}${tag} · ${isScalp ? t('Afatshkurtër') : t('Afatgjatë')}${pnl != null ? ` · ${pnl >= 0 ? '+' : ''}${r2(pnl)} ${fcur}` : ''}` }] : []),
        ...((p.stopLoss && !editing) ? [{ price: p.stopLoss, color: '#ef4444', title: `SL${tag}${risk != null ? ` · -${r2(risk)} ${fcur}` : ''}` }] : []),
        ...((p.takeProfit && !editing) ? [{ price: p.takeProfit, color: '#22c55e', title: `TP${tag}${reward != null ? ` · +${r2(reward)} ${fcur}` : ''}` }] : []),
      ];
    }),
    ...((livePrice != null && posnsForSymbol.length)
      ? [{ price: livePrice, color: pxFresh ? '#fbbf24' : '#6b7280',
          title: (pxFresh && totalLivePnl != null)
            ? `${t('Tani')} · ${totalLivePnl >= 0 ? '+' : ''}${r2(totalLivePnl)} ${fcur}`
            : `${t('Tani')} · ${t('çmim jo-live — mos mbyll')}` }]
      : []),
  ];

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

  // Lëshimi i tërheqjes së SL/TP mbi grafik (MT5) → ruan në MT5 për ATË pozicion.
  const onCommitSlTp = async (positionId: string, next: { sl: number | null; tp: number | null }) => {
    setModifyBusy(true); setModifyMsg(null);
    const r = await modifyPosition(positionId, next.sl ?? undefined, next.tp ?? undefined);
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

      {/* Pasqyra e fitim/humbjes — ditore, gjithsej, dhe gjendja live (lundruese) */}
      {metaConfigured && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: t('Fitim/Humbje sot'), value: pnlCard(pnlToday), cls: pnlCls(pnlToday) },
            { label: t('Fitim/Humbje gjithsej'), value: pnlCard(pnlTotal), cls: pnlCls(pnlTotal) },
            { label: t('Live (hapur tani)'), value: pnlCard(floatingPnl), cls: pnlCls(floatingPnl) },
          ].map((c) => (
            <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-2">
              <div className="text-gray-500 text-[10px] mb-0.5 flex items-center gap-1"><TrendingUp className="w-3 h-3" />{c.label}</div>
              <div className={`font-bold text-[13px] tabular-nums ${c.cls} ${showBalances ? '' : 'blur-[6px]'}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Njoftim për orarin: tregu i arit mbyllet çdo natë; 1 orë para mbylljes roboti vetëm sugjeron (manual) */}
      <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <span>{t('Tregu i arit (Hën–Pre) ka një pauzë ditore rreth orës 23:00–00:00. 1 orë para mbylljes roboti NUK hap trade automatik — sinjalet vijnë vetëm për tregti manuale (klik mbi sinjal për ta hapur formën).')}</span>
      </div>

      {/* PARA-HAPJEJE — tregu i mbyllur OSE i ngrirë (çmimi s'lëviz): numëruesi + porositë në radhë */}
      {(() => {
        const calOpen = isMktOpen(new Date(nowTs));
        const tradingNow = calOpen && !marketFrozen; // hapur sipas kalendarit DHE çmimi po lëviz
        return ((!tradingNow) || preOpenOrders.length > 0) && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-gray-900 p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="text-white font-bold text-sm">{tradingNow ? t('Tregu u hap — porositë po dërgohen') : t('Tregu i mbyllur — modë para-hapjeje')}</div>
              <div className="text-gray-400 text-[11px]">
                {tradingNow
                  ? t('Porositë e radhës hyjnë automatikisht brenda pak çastesh.')
                  : !calOpen
                    ? <>{t('Hapet pas')} <span className="text-amber-400 font-semibold">{fmtCountdown(msToOpen(new Date(nowTs)))}</span> · {t('porosia që vendos tani rri në pritje dhe hyn automatikisht në hapje.')}</>
                    : t('Çmimi s\'po lëviz — tregu duket i mbyllur tani (p.sh. festë/fundjavë e brokerit). Porosia që vendos rri në radhë dhe hyn automatik kur rikthehet çmimi.')}
              </div>
            </div>
          </div>
          {preOpenOrders.length > 0 && (
            <div className="space-y-1.5">
              {preOpenOrders.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-xs bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 gap-2">
                  <span className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className={`font-bold ${o.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{o.action === 'BUY' ? t('BLEJ') : t('SHIT')}</span>
                    <span className="text-white">{o.symbol}</span>
                    <span className="text-gray-400">{o.volume} {t('lot')}</span>
                    {o.entry_price != null && <span className="text-gray-500">@ {o.entry_price}</span>}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${o.status === 'placed' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                      {o.status === 'placed' ? t('pending te brokeri') : t('në radhë → hyn në hapje')}
                    </span>
                  </span>
                  {o.status === 'queued' && (
                    <button onClick={() => cancelPreOpen(o.id)} className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-2 py-1 rounded-lg transition-all shrink-0">
                      <X className="w-3 h-3" />{t('Anulo')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}

      {/* TICKER LIVE — çmimi real-time i simbolit të zgjedhur (bid/ask/spread + drejtim + pulsim) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <style>{`@keyframes mtPulse{0%,100%{opacity:1}50%{opacity:.25}}.mt-pulse{animation:mtPulse 1.2s ease-in-out infinite}@keyframes mtFlash{from{background-color:rgba(251,191,36,.16)}to{background-color:transparent}}.mt-flash{animation:mtFlash .5s ease-out}`}</style>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-white font-bold text-base sm:text-lg shrink-0">{selected}</span>
          <span key={pxTick} className="mt-flash rounded-md px-1 inline-flex items-center gap-1.5">
            <span className={`text-xl sm:text-2xl font-black tabular-nums ${!pxFresh ? 'text-gray-500' : pxDir === 'up' ? 'text-green-400' : pxDir === 'down' ? 'text-red-400' : 'text-white'}`}>
              {livePrice != null ? livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
            </span>
            {pxDir === 'up' && <ArrowUp className="w-4 h-4 text-green-400" />}
            {pxDir === 'down' && <ArrowDown className="w-4 h-4 text-red-400" />}
          </span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs flex-wrap">
          {brokerPx ? (
            <>
              <div><span className="text-gray-500">Bid </span><span className="text-red-400 font-semibold tabular-nums">{brokerPx.bid.toFixed(2)}</span></div>
              <div><span className="text-gray-500">Ask </span><span className="text-green-400 font-semibold tabular-nums">{brokerPx.ask.toFixed(2)}</span></div>
              <div><span className="text-gray-500">{t('Spread')} </span><span className="text-gray-300 tabular-nums">{(brokerPx.ask - brokerPx.bid).toFixed(2)}</span></div>
            </>
          ) : (
            <span className="text-gray-600">{metaConfigured ? t('Po pritet çmimi live…') : t('Lidh MT5 për çmim live')}</span>
          )}
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${pxFresh ? 'bg-green-400 mt-pulse' : brokerPx ? 'bg-amber-500 mt-pulse' : 'bg-gray-600'}`} />
            <span className={pxFresh ? 'text-green-400 font-semibold' : brokerPx ? 'text-amber-400 font-semibold' : 'text-gray-500'}>
              {pxFresh ? (streamHealthy ? t('LIDHJE DIREKTE ●') : t('LIVE · 1s')) : brokerPx ? t('VONESË — jo live, mos mbyll') : t('jo live')}
            </span>
            {stream.status === 'connecting' || stream.status === 'synchronizing'
              ? <span className="text-[10px] text-amber-400/80">{t('po lidhet direkt…')}</span>
              : stream.status === 'reconnecting'
              ? <span className="text-[10px] text-amber-400/80">{t('po rilidhet…')}</span>
              : null}
          </span>
        </div>
      </div>

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
                <Mt5Chart candles={displayCandles} lines={chartLines} height={460} fitKey={`${selected}_${tf}`}
                  positions={editables} activeId={activePosId} onActiveChange={setActivePosId} onCommitSlTp={onCommitSlTp} />
              )}
              {editables.length > 0 && candles.length > 0 && (
                <p className="mt-1.5 text-[10px] text-gray-500 flex items-center gap-1 flex-wrap">
                  <span className="inline-block text-[9px] font-bold bg-blue-500 text-white px-1 rounded">✎ SL/TP</span>
                  {activePosId
                    ? <>{t('Tërhiq pilulat')} <span className="text-red-400 font-semibold">SL</span>/<span className="text-green-400 font-semibold">TP</span> {t('lart-poshtë; lëshimi e ruan në MT5. Prek sërish hyrjen për ta mbyllur editimin.')}</>
                    : t('Prek pilulën te linja e Hyrjes së një pozicioni për të vendosur/lëvizur SL & TP (si MetaTrader).')}
                </p>
              )}
            </div>
            {posForSymbol && (
              <div className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-800 text-[11px] flex-wrap">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${posIsScalp ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{posIsScalp ? t('Afatshkurtër') : t('Afatgjatë')}</span>
                {totalLivePnl != null && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400" />{t('Tani')}: <span className={`font-bold ${totalLivePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalLivePnl >= 0 ? '+' : ''}{r2(totalLivePnl)} {fcur}</span></span>
                )}
                {multiPos && <span className="text-gray-400">· {posnsForSymbol.length} {t('pozicione hapur')}</span>}
              </div>
            )}
      </div>

      {/* Pozicionet e hapura (live) — VENDOSUR menjëherë nën grafikun e MetaTrader, që të shihen bashkë */}
      <OpenPositionsPanel configured={metaConfigured} section="positions" />

      {/* Porosi e re (majtas) + Trade-t e mbyllura (djathtas) — dy kolona në ekran të madh, stack në mobil */}
      <div className="lg:grid lg:grid-cols-[28rem_minmax(0,1fr)] lg:gap-5 lg:items-start">
      <div>
        {/* Sinjali i fundit — i vendosur SIPËR formës "Porosi e re" (klik për ta tregtuar). */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 mb-3">
          <div className="text-[11px] text-gray-500 mb-1 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" />{t('Sinjali i fundit (klik për ta tregtuar)')}</div>
          <p className="text-[10px] text-gray-600 mb-2 leading-snug">{t('Ky është sinjali aktual i motorit — pikërisht atë që tregton roboti i sinjaleve. Aktiv 5 min; pas 5 min shënohet I VJETËR; pas 15 min hiqet.')}</p>
          {latestSignal ? (
            <button onClick={() => applySignal(latestSignal)}
              className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors ${appliedSignalId === latestSignal.id ? 'bg-amber-500/10 border-amber-500/40' : signalIsNew(latestSignal.created_at) ? 'bg-green-500/10 border-green-500/40' : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-2">
                  {signalIsNew(latestSignal.created_at) && (
                    <span className="relative flex h-2.5 w-2.5" title={t('Sinjal i ri')}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                  )}
                  <span className="text-white text-sm font-bold">{latestSignal.symbol}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${latestSignal.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{latestSignal.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isShortHorizon(latestSignal.timeframe) ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{horizonLabel(latestSignal.timeframe)}</span>
                  {signalIsNew(latestSignal.created_at)
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">{t('I RI')}</span>
                    : !signalIsFresh(latestSignal.created_at) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-600/40 text-gray-400">{t('I VJETËR')}</span>}
                </span>
                <span className="text-amber-400 text-xs font-semibold">{latestSignal.confidence}%</span>
              </div>
              <div className="flex gap-3 text-[11px] text-gray-200 flex-wrap">
                {latestSignal.entry_price && <span>{t('Hyrje:')} <span className="text-white font-semibold">{Number(latestSignal.entry_price).toLocaleString()}</span></span>}
                {latestSignal.target_price && <span><span className="text-green-400">TP:</span> <span className="text-white font-semibold">{Number(latestSignal.target_price).toLocaleString()}</span></span>}
                {latestSignal.stop_loss && <span><span className="text-red-400">SL:</span> <span className="text-white font-semibold">{Number(latestSignal.stop_loss).toLocaleString()}</span></span>}
                <span><span className="text-amber-400">{t('Lot:')}</span> <span className="text-white font-semibold">{signalLotByConfidence(Number(latestSignal.confidence)).toFixed(2)}</span></span>
              </div>
              <div className="text-[10px] text-gray-500 mt-1">🕒 {t('Gjeneruar:')} {fmtTime(latestSignal.created_at)} · {signalIsFresh(latestSignal.created_at) ? t('aktiv për tregtim') : t('i vjetër — mos tregto')}</div>
            </button>
          ) : (
            <p className="text-gray-600 text-xs text-center py-2">{t('Asnjë sinjal i gjeneruar ende.')}</p>
          )}
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
        {/* Porosia BLEJ/SHIT — VETËM manuale; e palosur si default. Klik mbi header → hapet bosh;
            klik mbi sinjal → hapet automatik me të dhënat e mbushura. */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2 h-fit">
          <button onClick={() => setShowNewOrder(v => !v)} className="w-full flex items-center justify-between text-left">
            <h3 className="text-white font-semibold text-sm">{t('Porosi e re — {sym}', { sym: selected })} <span className="text-[10px] text-gray-500 font-normal">{t('(manual)')}</span></h3>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showNewOrder ? 'rotate-180' : ''}`} />
          </button>
          {showNewOrder && (<>
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
          </>)}
        </div>
      </div>

      {/* Trade-t e mbyllura (historiku real nga MT5) — 10 të parat, me buton për të zgjeruar */}
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
                      <th className="text-left font-medium py-2">{t('Afati')}</th>
                      <th className="text-left font-medium py-2">{t('Burimi')}</th>
                      <th className="text-right font-medium py-2">{t('Lot')}</th>
                      <th className="text-right font-medium py-2">{t('Hyrje')}</th>
                      <th className="text-right font-medium py-2">SL</th>
                      <th className="text-right font-medium py-2">TP</th>
                      <th className="text-right font-medium py-2">{t('Dalja')}</th>
                      <th className="text-right font-medium py-2">{t('Fitim/Humbje')}</th>
                      <th className="text-right font-medium py-2">{t('Koha')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {(showAllHistory ? history : history.slice(0, 10)).map(d => {
                      const isBuy = d.direction === 'BUY';
                      const src = srcMeta[d.source || 'mt5'];
                      const ek = exitKind(d);
                      return (
                        <tr key={d.id} className="hover:bg-gray-800/30">
                          <td className="py-2 text-white font-medium">{d.symbol || '—'}</td>
                          <td className="py-2"><span className={`font-bold ${isBuy ? 'text-green-400' : d.direction === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>{isBuy ? t('BLEJ') : d.direction === 'SELL' ? t('SHIT') : '—'}</span></td>
                          <td className="py-2">{d.horizon === 'short' ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{t('Shkurt')}</span> : d.horizon === 'long' ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">{t('Gjatë')}</span> : <span className="text-gray-600">—</span>}</td>
                          <td className="py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${src.cls}`}>{src.label}</span></td>
                          <td className="py-2 text-right text-gray-300">{d.volume || '—'}</td>
                          <td className="py-2 text-right text-gray-300">{d.entryPrice != null ? d.entryPrice.toFixed(2) : '—'}</td>
                          <td className="py-2 text-right text-red-400/70">{d.plannedSL != null ? d.plannedSL.toFixed(2) : '—'}</td>
                          <td className="py-2 text-right text-green-400/70">{d.plannedTP != null ? d.plannedTP.toFixed(2) : '—'}</td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <span className="text-gray-300">{d.exitPrice != null ? d.exitPrice.toFixed(2) : '—'}</span>
                            {ek === 'tp' && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-green-500/20 text-green-400">TP</span>}
                            {ek === 'sl' && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/20 text-red-400">SL</span>}
                            {ek === 'other' && d.exitPrice != null && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-gray-600/40 text-gray-400">{t('Manual')}</span>}
                          </td>
                          <td className={`py-2 text-right font-semibold ${d.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{d.net >= 0 ? '+' : ''}{d.net.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-500">{d.closeTime ? new Date(d.closeTime).toLocaleString(dtLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
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
      </div>

      {/* 3) Sinjalet aktive (lista e plotë) — sinjale të vjetra, klik për të mbushur formën */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />{t('Sinjalet')}</h3>
          <button onClick={() => onNavigate('signals')} className="text-amber-400 text-xs hover:text-amber-300">{t('Të gjitha')}</button>
        </div>
        {signals.filter(s => signalVisible(s.created_at)).length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë sinjal aktiv tani.')}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {signals.filter(s => signalVisible(s.created_at)).map(s => {
              const fresh = signalIsFresh(s.created_at);
              const isNew = signalIsNew(s.created_at);
              return (
              <button key={s.id} onClick={() => applySignal(s)} className={`text-left rounded-xl px-3 py-2 transition-colors border ${appliedSignalId === s.id ? 'bg-amber-500/10 border-amber-500/40' : isNew ? 'bg-green-500/10 border-green-500/40' : 'bg-gray-800/40 border-transparent hover:bg-gray-800'} ${fresh ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2">
                    {isNew && (
                      <span className="relative flex h-2.5 w-2.5" title={t('Sinjal i ri')}>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                      </span>
                    )}
                    <span className="text-white text-sm font-bold">{s.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isShortHorizon(s.timeframe) ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{horizonLabel(s.timeframe)}</span>
                    {isNew
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">{t('I RI')}</span>
                      : !fresh && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-600/40 text-gray-400">{t('I VJETËR')}</span>}
                  </span>
                  <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                </div>
                <div className="flex gap-3 text-[11px] text-gray-200 flex-wrap">
                  {s.entry_price && <span>{t('Hyrje:')} <span className="text-white font-semibold">{Number(s.entry_price).toLocaleString()}</span></span>}
                  {s.target_price && <span><span className="text-green-400">{t('Objektiv:')}</span> <span className="text-white font-semibold">{Number(s.target_price).toLocaleString()}</span></span>}
                  {s.stop_loss && <span><span className="text-red-400">{t('Stop:')}</span> <span className="text-white font-semibold">{Number(s.stop_loss).toLocaleString()}</span></span>}
                  <span><span className="text-amber-400">{t('Lot:')}</span> <span className="text-white font-semibold">{signalLotByConfidence(Number(s.confidence)).toFixed(2)}</span></span>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">🕒 {fmtTime(s.created_at)}{fresh ? '' : t(' · mos tregto')}</div>
              </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 4) Sinjalet e vjetra (të përfunduara) */}
      <CompletedSignals signals={doneSignals} variant="compact" />

      {/* 5) Historiku diagnostik i skanimeve — pse hyn/s'hyn sinjali (s'prek logjikën) */}
      <SignalScanLog title={t('Historiku i Skanimeve (Live) — pse hyn ose s\'hyn sinjali')} />
    </div>
  );
}
