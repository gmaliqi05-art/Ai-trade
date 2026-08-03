import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  Activity, RefreshCw, Loader2, Zap,
  AlertCircle, History, ChevronDown, ShieldCheck, Eye, EyeOff,
  ArrowUp, ArrowDown, Clock, X, Maximize2, Minimize2, TrendingUp, TrendingDown, Ban, BookOpen,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClientPage } from '../App';
import Mt5Chart, { type ChartCandle, type PriceLineDef, type EditableSlTp } from '../components/Mt5Chart';
import OpenPositionsPanel from '../components/OpenPositionsPanel';
import CompletedSignals from '../components/CompletedSignals';
import ReportBook, { type ReportRow } from '../components/ReportBook';
import SignalScanLog from '../components/SignalScanLog';
import {
  loadMetaApiConfig, checkMetaApiConnection, executeTrade, loadTradeHistory,
  loadCandles, loadOpenPositions, modifyPosition, loadSymbolPrice, loadPositionCloses, recordClose,
  loadPreOpenOrders, cancelPreOpenOrder, loadPendingOrders, cancelOrder, closePosition,
  type AccountInfo, type HistoryDeal, type OpenPosition, type PreOpenOrder, type PendingOrder,
} from '../services/metaapi';
import { fetchCandles, type Timeframe } from '../ai-trader/market/candles';
import { loadTelegramSignals, loadTelegramEntrySignals, loadTgLegs, sigPnl, type TelegramSignalRow, type TgLegRow } from '../services/telegramSin';
import { metaStream } from '../services/metaStream';
import { useMetaStream } from '../hooks/useMetaStream';
import { groupDeals, attachSource, fasttFromExecutions, closesFromPositions, exitKind, positionHorizon, robotBadgeCls, robotOfPosition, robotOf, type ClosedTrade, type ExecRow, type FasttExecRow, type HorizonExec } from '../services/closedTrades';
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

// SEKSION I PALOSSHËM me kujtesë (localStorage) — pamja klasike e terminalit: koka gjithmonë e
// dukshme, përmbajtja hapet/mbyllet me një klik dhe zgjedhja mbahet mend për herën tjetër.
// `bare` = pa kornizë karte (për seksione që kanë kartat e veta brenda).
// Gjendja bosh brenda një tabele: e qetë, pa alarm — thjesht shpjegon çfarë do të vijë aty.
function TLEmpty({ text }: { text: string }) {
  return <p className="text-[11px] text-gray-500 text-center py-4">{text}</p>;
}

function TLFold({ k, title, icon, right, defaultOpen = true, bare = false, always, children }: {
  k: string; title: string; icon?: ReactNode; right?: ReactNode; defaultOpen?: boolean; bare?: boolean;
  /** Përmbajtje GJITHMONË e dukshme nën kokë — edhe kur seksioni është i mbyllur (p.sh. mesazhi i fundit). */
  always?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem('tl_fold_' + k); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => setOpen(o => { try { localStorage.setItem('tl_fold_' + k, o ? '0' : '1'); } catch { /* */ } return !o; });
  return (
    <div className={bare ? '' : 'bg-gray-900 border border-gray-800 rounded-2xl'}>
      <div className={`flex items-center gap-2 ${bare ? 'px-1 py-1' : 'px-4 py-3'}`}>
        <button onClick={toggle} className="flex-1 flex items-center justify-between text-left min-w-0">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 truncate">{icon}{title}</h3>
          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {right}
      </div>
      {always && <div className={bare ? '' : `px-4 ${open ? 'pb-2' : 'pb-4'}`}>{always}</div>}
      {open && <div className={bare ? 'space-y-5' : 'px-4 pb-4'}>{children}</div>}
    </div>
  );
}

export default function MarketTerminalPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [latestSig, setLatestSig] = useState<Signal | null>(null); // sinjali më i RI (sipas kohës) për widget-in "Sinjali i fundit"
  const [doneSignals, setDoneSignals] = useState<Signal[]>([]);
  // Id-të e pozicioneve FastT (nga logu) — për të klasifikuar saktë pozicionet e hapura si Afatshkurtër
  // edhe kur brokeri NUK ruan komentin "FastT" te pozicioni i kthyer nga MT5.
  const [execLog, setExecLog] = useState<HorizonExec[]>([]);
  const [selected, setSelected] = useState('XAUUSD');
  const [tf, setTf] = useState('1m');
  // Simbolet e lejuara nga cilësimet (auto_symbols). Ari default; të tjerat shtohen te Cilësimet.
  const [allowedSymbols, setAllowedSymbols] = useState<string[]>(['XAUUSD']);

  const [metaConfigured, setMetaConfigured] = useState(false);
  // Roboti i Sinjaleve aktiv? (kill_switch i fikur). I ndalur → tabelat e tij s'shfaqen në Trade Live.
  const [signalsRobotOn, setSignalsRobotOn] = useState(false);
  // VIP? Sinjalet e motorit/MMT shfaqen VETËM për VIP (ose admin) — përdoruesit normalë shohin
  // vetëm GoldSniperFX Algorithm. Burimi i vërtetë = profiles.is_vip/is_admin (jo localStorage).
  const [isVip, setIsVip] = useState(false);
  // Telegram Sin në Trade Live: sinjalet + GJITHË mesazhet e grupeve (raport i shpejtë + feed).
  const [tgSigs, setTgSigs] = useState<TelegramSignalRow[]>([]);
  // Vetëm sinjalet e HYRJES (query e veçantë) — mesazhet e shumta s'i shtyjnë dot jashtë tabelave.
  const [tgEntries, setTgEntries] = useState<TelegramSignalRow[]>([]);
  const [tgLegs, setTgLegs] = useState<TgLegRow[]>([]);
  // Emrat REALË të simboleve te brokeri (symbol_map nga serveri, p.sh. XAUUSD → XAUUSD.s).
  const [symMap, setSymMap] = useState<Record<string, string>>({});
  // Lidhja DIREKTE streaming (websocket) — kredencialet për ta nisur + snapshot-i live.
  const [streamCfg, setStreamCfg] = useState<{ token: string; accountId: string; region: string } | null>(null);
  const stream = useMetaStream();
  const streamLive = stream.status === 'live';
  // "I shëndetshëm" = i lidhur DHE po jep tick-e të freskëta (< 6s). Vetëm atëherë e fikim REST-in;
  // nëse lidhet por s'jep çmim (p.sh. emër simboli ende pa u zgjidhur), REST rikthehet vetvetiu.
  const streamHealthy = streamLive && stream.lastTickAt > 0 && (stream.updatedAt - stream.lastTickAt < 6000);
  // Pasqyrë e gjendjes për funksionet asinkrone: një kërkesë REST e nisur më parë mbaron më vonë
  // dhe do të mbante vlerën e vjetër të 'streamHealthy' po ta lexonte nga closure-i.
  const streamHealthyRef = useRef(false);
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
  // Grafiku në EKRAN TË PLOTË (me butona Buy/Sell/Cancel) — i përshtatshëm horizontal & vertikal.
  const [chartFull, setChartFull] = useState(false);
  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);
  // EKRANI I PLOTË: lartësia e grafikut MATET nga kontejneri, nuk hamendësohet. Më parë ishte
  // 'vh − 100' e ngurtë; kur koka + shiriti BUY/SELL + rreshti i mesazhit dilnin mbi 100px,
  // grafiku bëhej më i gjatë se hapësira dhe 'overflow-hidden' ia priste fundin — pikërisht
  // aty ku ndodhet shiriti i kohës (datat/orët).
  const fullChartRef = useRef<HTMLDivElement | null>(null);
  const [fullChartH, setFullChartH] = useState(0);
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
  // Zgjerimi i tabelës së secilit robot te "Tregtitë e mbyllura sipas robotit" (çelës = emri i robotit).
  const [expandedRobots, setExpandedRobots] = useState<Record<string, boolean>>({});
  const [showSignalInfo, setShowSignalInfo] = useState(false);
  const [confirmNoSLTP, setConfirmNoSLTP] = useState(false);
  const [showBalances, setShowBalances] = useState(false); // privatësi: shifrat e fshehura (të turbullta) si default

  // ---- INVESTITORËT E MËDHENJ (kërkesa e pronarit) ----
  // Nivelet e mëdha në grafik (muret e porosive + zonat e likuiditetit) — çelës me kujtesë.
  const [showBigLevels, setShowBigLevels] = useState<boolean>(() => { try { return localStorage.getItem('tl_biglvl') !== '0'; } catch { return true; } });
  const toggleBigLevels = () => setShowBigLevels(v => { try { localStorage.setItem('tl_biglvl', v ? '0' : '1'); } catch { /* */ } return !v; });

  // COT (Investitorët e Mëdhenj) u HOQ (kërkesa e pronarit, 31 korrik 2026): burimi zyrtar CFTC
  // publikon vetëm një herë në javë — s'mund të ketë përditësim ditor, prandaj tabela u hoq.

  // (2) MURET E POROSIVE: libri REAL i porosive të arit të tokenizuar (PAXG/Binance) — muret më të
  // mëdha blerëse/shitëse pranë çmimit. Ruhen si DELTA nga mid-i, që në grafik të ndjekin
  // automatikisht çmimin live të brokerit (pa offset të ngrirë). Rifreskohen çdo 30s.
  const [obWalls, setObWalls] = useState<{ delta: number; qty: number; side: 'buy' | 'sell' }[]>([]);
  const [obWallsAt, setObWallsAt] = useState(0);
  useEffect(() => {
    if (!/XAU|GOLD/i.test(selected)) { setObWalls([]); return; }
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('https://data-api.binance.vision/api/v3/depth?symbol=PAXGUSDT&limit=500');
        if (!r.ok) return;
        const d = await r.json() as { bids: [string, string][]; asks: [string, string][] };
        if (stop || !d.bids?.length || !d.asks?.length) return;
        const mid = (Number(d.bids[0][0]) + Number(d.asks[0][0])) / 2;
        // Grupim në kova $1; mbaj 2 kovat më të mëdha për anë brenda ±35$ nga çmimi.
        const bucket = (rows: [string, string][], lo: number, hi: number) => {
          const m = new Map<number, number>();
          for (const [p0, q0] of rows) {
            const p = Number(p0), q = Number(q0);
            if (p < lo || p > hi) continue;
            const k = Math.round(p);
            m.set(k, (m.get(k) || 0) + q);
          }
          return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
        };
        const bids = bucket(d.bids, mid - 35, mid - 0.5).map(([p, q]) => ({ delta: p - mid, qty: q, side: 'buy' as const }));
        const asks = bucket(d.asks, mid + 0.5, mid + 35).map(([p, q]) => ({ delta: p - mid, qty: q, side: 'sell' as const }));
        setObWalls([...bids, ...asks]);
        setObWallsAt(Date.now());
      } catch { /* mbaje leximin e fundit */ }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { stop = true; clearInterval(id); };
  }, [selected]);
  const [preOpenOrders, setPreOpenOrders] = useState<PreOpenOrder[]>([]); // porositë para-hapjeje (radhë/pending te brokeri)
  const [nowTs, setNowTs] = useState(Date.now()); // tik për numëruesin e hapjes së tregut
  // Ekran i plotë: paneli "Mbyll" — lista e pozicioneve të hapura + porosive në pritje, secili me buton.
  const [closePanel, setClosePanel] = useState(false);
  const [pendingList, setPendingList] = useState<PendingOrder[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);

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
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // sinjalet > 24h fshihen
    const [ar, sr, lr, dr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, category, current_price').eq('is_active', true).gt('current_price', 0),
      // Sinjalet AKTIVE të 24h të fundit. Filtrin e skadimit (expires_at) e bëjmë në KLIENT (më poshtë),
      // jo me .or() te query-ja: një filtër .or() me timestamp bëhej i brishtë dhe kthente listë bosh
      // edhe kur kishte sinjale aktive (prandaj "Asnjë sinjal aktiv" ndërsa motori kishte prodhuar).
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, timeframe, analysis, expires_at')
        .eq('status', 'active').gte('created_at', since24).order('created_at', { ascending: false }).limit(12),
      // Sinjali më i RI (sipas KOHËS) — për widget-in "Sinjali i fundit". I ndarë nga lista që sinjali
      // i sapoardhur të shfaqet gjithmonë saktë, edhe kur lista pritet te 8 elementët.
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, timeframe, analysis, expires_at')
        .eq('status', 'active').gte('created_at', since24).order('created_at', { ascending: false }).limit(1),
      // Sinjalet e PËRFUNDUARA (TP/SL/skaduar) të 24h të fundit — historiku i plotë te Raportet.
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, outcome, result_pct, closed_at')
        .in('status', ['hit_tp', 'hit_sl', 'expired']).gte('closed_at', since24).order('created_at', { ascending: false }).limit(12),
    ]);
    if (ar.data) setAssets(goldFirst(ar.data as Asset[]));
    if (lr.data) setLatestSig((lr.data as Signal[])[0] ?? null);
    if (sr.data) {
      // Fshih sinjalet e skaduara (expires_at kaluar) në klient — filtër i sigurt, pa .or() të brishtë.
      const nowMs = Date.now();
      const live = (sr.data as Signal[]).filter((s) => {
        const e = (s as { expires_at?: string | null }).expires_at;
        return !e || new Date(e).getTime() > nowMs;
      });
      setSignals(live.slice(0, 8));
    }
    if (dr.data) setDoneSignals(dr.data as Signal[]);
  }, []);

  // Trade-t "extra" nga historiku i rëndë i MT5 (manualet e vjetra jashtë regjistrit) — cache e
  // leximit të fundit të suksesshëm, që tabela të MOS varet nga një thirrje që dështon shpesh (429/502).
  const mt5RestRef = useRef<ClosedTrade[]>([]);
  // account_id i llogarisë MT5 të konfiguruar — raportet nga DB filtrohen sipas tij (jo llogaritë e vjetra).
  const accountIdRef = useRef<string>('');

  // TABELA E MBYLLURA VETËM NGA DB (position_closes + logu i ekzekutimeve) — e shpejtë (~100ms)
  // dhe e PAVARUR nga MetaApi: robotët i shkruajnë mbylljet aty në sekondë, kështu tabela
  // përditësohet çdo 10s edhe kur MetaApi është në rate-limit dhe historiku i rëndë ngec.
  const fetchCloses = useCallback(async () => {
    if (!user) return null;
    // Raportet vetëm për llogarinë AKTUALE të MT5 — pa të dhënat e një llogarie të mëparshme.
    const accId = accountIdRef.current;
    if (!accId) return null;
    const posCloseRows = await loadPositionCloses(user.id, 8, accId);
    const posCloses = closesFromPositions(posCloseRows);
    const posCloseIds = new Set(posCloses.map(p => p.id));
    const sinceIso = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const { data: execsAll } = await supabase
      .from('trade_executions')
      .select('status, action, symbol, volume, entry_price, stop_loss, take_profit, signal_id, reason, created_at, metaapi_order_id')
      .eq('user_id', user.id).eq('account_id', accId)
      .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(1000);
    const rows = (execsAll || []) as Array<FasttExecRow & ExecRow>;
    // PLOTËSIM EKZAKT për mbylljet e serverit (position_closes s'i ruan vetë SL/TP): rreshti i
    // logut me metaapi_order_id == positionId jep SL/TP e planifikuara + robotin — përputhje 1:1.
    const byOrderId = new Map<string, FasttExecRow & ExecRow>();
    for (const r of rows) if (r.status === 'executed' && r.metaapi_order_id) byOrderId.set(String(r.metaapi_order_id), r);
    for (const t of posCloses) {
      const e = byOrderId.get(String(t.id));
      if (!e) continue;
      if (t.plannedSL == null && e.stop_loss != null) t.plannedSL = Number(e.stop_loss);
      if (t.plannedTP == null && e.take_profit != null) t.plannedTP = Number(e.take_profit);
      if (!t.robot) t.robot = robotOf(e.reason, e.signal_id);
    }
    const fastt = fasttFromExecutions(rows);
    const fasttIds = new Set(fastt.map(f => f.id));
    setExecLog(rows as HorizonExec[]);
    // FastT-trade-t e logut që S'janë te position_closes (mbylljet e shpejta të scalp-live).
    const fasttDedup = fastt.filter(f => !posCloseIds.has(f.id));
    const mt5Rest = mt5RestRef.current.filter(t => !posCloseIds.has(t.id) && !fasttIds.has(t.id));
    setHistory([...posCloses, ...fasttDedup, ...mt5Rest].sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || '')));
    return { posCloses, posCloseIds, rows, fastt, fasttIds, fasttDedup };
  }, [user]);

  // Lexon gjendjen reale të MT5: llogaria + historiku i rëndë (plotëson tabelën me manualet e vjetra).
  const fetchMeta = useCallback(async () => {
    if (!user) return;
    let cfg;
    // Dështim kalimtar i ngarkimit (rrjet) → ruaj gjendjen e fundit, mos pulso te "i palidhur".
    try { cfg = await loadMetaApiConfig(user.id); } catch { return; }
    const configured = !!(cfg.account_id && cfg.token);
    accountIdRef.current = cfg.account_id || '';
    setMetaConfigured(configured);
    setSignalsRobotOn(configured && !cfg.kill_switch);
    setMtMode(cfg.mode);
    setSymMap(cfg.symbol_map || {});
    // Ushqe lidhjen direkte streaming (vetëm kur ndryshojnë kredencialet → shmang rinisjet e kota).
    if (configured) {
      setStreamCfg(prev => (prev && prev.token === cfg!.token && prev.accountId === cfg!.account_id && prev.region === cfg!.region)
        ? prev : { token: cfg!.token, accountId: cfg!.account_id, region: cfg!.region });
    } else setStreamCfg(null);
    // Lista e simboleve për tab-et — Ari gjithmonë + ato që ka aktivizuar përdoruesi te Cilësimet.
    setAllowedSymbols(['XAUUSD', ...(cfg.auto_symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'XAUUSD')]);
    if (configured) {
      const [acc, hist, pos] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(), loadOpenPositions()]);
      if (!acc.error && acc.account) setAccount(acc.account);
      const dbRes = await fetchCloses();
      if (dbRes && !hist.error && Array.isArray(hist.deals)) {
        const grouped = groupDeals(hist.deals as HistoryDeal[]);
        attachSource(grouped, dbRes.rows.filter(r => r.status === 'executed') as ExecRow[]);
        // Jo-FastT (sinjal/manual/auto) merren nga MT5; dedup me regjistrin e serverit + logun FastT.
        // Në dështim të historikut, cache-ja e fundit mbetet — rreshtat e vjetër s'zhduken më nga tabela.
        mt5RestRef.current = grouped.filter(t => !dbRes.posCloseIds.has(t.id) && (t.source !== 'fastt' || !dbRes.fasttIds.has(t.id)));
        setHistory([...dbRes.posCloses, ...dbRes.fasttDedup, ...mt5RestRef.current].sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || '')));
      }
      // I njëjti rregull si te poll-i: streaming-u ka përparësi mbi REST-in për pozicionet.
      if (!streamHealthyRef.current && !pos.error && Array.isArray(pos.positions)) setPositions(pos.positions);
    }
    setLastUpdated(new Date());
  }, [user, fetchCloses]);

  // A është përdoruesi VIP (ose admin)? Vetëm atëherë shfaqen sinjalet e motorit/MMT në Trade Live.
  useEffect(() => {
    if (!user) { setIsVip(false); return; }
    let alive = true;
    supabase.from('profiles').select('is_vip, is_admin').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        const p = data as { is_vip?: boolean; is_admin?: boolean } | null;
        if (alive) setIsVip(!!(p?.is_vip || p?.is_admin));
      });
    return () => { alive = false; };
  }, [user]);

  // Rifreskim i SHPEJTË i tabelës së mbyllura (vetëm DB, çdo 10s) — i pavarur nga MetaApi.
  useEffect(() => {
    if (!metaConfigured) return;
    const id = setInterval(() => { fetchCloses().catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [metaConfigured, fetchCloses]);

  // Poll i shpejtë VETËM i pozicioneve (P&L live + numri i tyre) — më i shpeshtë se fetch-i i plotë,
  // pa ri-tërhequr historikun/llogarinë. Përditëson VETËM në sukses (ruan të fundit në gabim kalimtar).
  const fetchPositions = useCallback(async () => {
    if (!user || !metaConfigured) return;
    const pos = await loadOpenPositions();
    // Kur streaming-u punon, ai e di i pari se pozicioni u mbyll. REST-i i MetaApi-t vonon disa
    // sekonda dhe do ta rikthente pozicionin e mbyllur — prej andej vinin linjat që mbeteshin
    // mbi grafik dhe dridhja (shfaqet → zhduket → shfaqet).
    if (streamHealthyRef.current) return;
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

  // Matja e kontejnerit të grafikut në ekran të plotë (ndjek çdo ndryshim: rrotullim,
  // shfaqja/zhdukja e rreshtit të mesazhit, tastiera e telefonit).
  useEffect(() => {
    const el = fullChartRef.current;
    if (!el) { setFullChartH(0); return; }
    const apply = () => setFullChartH(Math.round(el.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartFull, tradeMsg]);

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
  // I jepet emri REAL i brokerit (symbol_map) — te PU Prime 'XAUUSD' pa '.s' nuk jep çmime.
  useEffect(() => {
    if (streamCfg && selected) void metaStream.subscribeSymbol(selected, symMap[selected.toUpperCase()]);
  }, [streamCfg, selected, stream.status, symMap]);

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

  useEffect(() => { streamHealthyRef.current = streamHealthy; }, [streamHealthy]);

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
      // Lot-i REAL i ekzekutuar nga serveri (mund të pritet nga "Lot maksimal" i konfigurimit) —
      // trego atë, jo të kërkuarin, + paralajmërim kur pritet.
      const srvVol = Number((r as { volume?: number }).volume);
      const realVol = Number.isFinite(srvVol) && srvVol > 0 ? srvVol : vol;
      const capNote = realVol < vol ? ` ⚠️ ${t('Lot-i u prit nga "Lot maksimal" ({req} → {real}) — rrite te Lidhja & Konfigurimi.', { req: vol, real: realVol })}` : '';
      if ((r as { queued?: boolean }).queued) {
        setTradeMsg({ type: 'success', text: t('Porosia {dir} {sym} ({vol} lot){extra} u vendos në RADHË — hyn automatikisht kur hapet tregu.', { dir, sym: selected, vol: realVol, extra }) + capNote });
      } else if (r.pending) {
        setTradeMsg({ type: 'success', text: t('Porosi në pritje {dir} {sym} ({vol} lot) @ {price}{extra} — hyn automatik kur çmimi e arrin ({mode}).', { dir, sym: selected, vol: realVol, price: r.open_price ?? entry ?? '', extra, mode: r.mode ?? '' }) + capNote });
      } else {
        setTradeMsg({ type: 'success', text: t('Urdhër {dir} {sym} ({vol} lot){extra} dërguar ({mode}).', { dir, sym: selected, vol: realVol, extra, mode: r.mode ?? '' }) + capNote });
      }
      fetchMeta();
      loadPreOpen();
    }
    setTradeLoading(false);
  };

  // Rimat lartësinë e ekranit të plotë (edhe kur rrotullohet telefoni horizontal/vertikal).
  useEffect(() => {
    if (!chartFull) return;
    const onResize = () => setVh(window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, [chartFull]);

  // TREGTIM I SHPEJTË (butonat Buy/Sell në ekran të plotë) — porosi tregu me lot-in aktual.
  const quickTrade = async (dir: 'buy' | 'sell') => {
    const vol = parseFloat(lot);
    if (isNaN(vol) || vol <= 0) { setTradeMsg({ type: 'error', text: t('Vendos një lot të vlefshëm (p.sh. 0.01).') }); return; }
    if (!metaConfigured) { setTradeMsg({ type: 'error', text: errText(t, 'metaapi_not_configured') }); return; }
    setTradeType(dir); setTradeLoading(true); setTradeMsg(null);
    const r = await executeTrade({ action: dir === 'buy' ? 'BUY' : 'SELL', symbol: selected, volume: vol });
    if (r.error) setTradeMsg({ type: 'error', text: errText(t, r.error, r.message) });
    else {
      const d = dir === 'buy' ? t('BLEJ') : t('SHIT');
      setTradeMsg({ type: 'success', text: t('Urdhër {dir} {sym} ({vol} lot){extra} dërguar ({mode}).', { dir: d, sym: selected, vol, extra: '', mode: r.mode ?? '' }) });
      fetchMeta(); loadPreOpen();
    }
    setTradeLoading(false);
  };


  // Hap panelin "Mbyll": rifreskon pozicionet e hapura + porositë në pritje (që të shfaqen për mbyllje/anulim).
  const openClosePanel = async () => {
    if (!metaConfigured) { setTradeMsg({ type: 'error', text: errText(t, 'metaapi_not_configured') }); return; }
    setClosePanel(true); setTradeMsg(null);
    fetchPositions();
    try {
      const r = await loadPendingOrders();
      const orders = Array.isArray((r as { orders?: PendingOrder[] }).orders) ? (r as { orders: PendingOrder[] }).orders : [];
      setPendingList(orders);
    } catch { setPendingList([]); }
  };

  // Mbyll një pozicion të hapur (buton për secilin te paneli).
  const closeOnePosition = async (id: string) => {
    setClosingId(id); setTradeMsg(null);
    const r = await closePosition(id);
    if (r.error) setTradeMsg({ type: 'error', text: r.message || t('Mbyllja dështoi.') });
    else { setTradeMsg({ type: 'success', text: t('Pozicioni u mbyll.') }); await fetchPositions(); }
    setClosingId(null);
  };

  // Anulo një porosi në pritje (buton për secilën te paneli).
  const cancelOnePending = async (id: string) => {
    setClosingId(id); setTradeMsg(null);
    const r = await cancelOrder(id);
    if (r.error) setTradeMsg({ type: 'error', text: r.message || t('Anulimi dështoi.') });
    else { setTradeMsg({ type: 'success', text: t('Porosia u anulua.') }); setPendingList(list => list.filter(o => String(o.id) !== id)); }
    setClosingId(null);
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

  // Sinjali i fundit i gjeneruar nga sistemi (sipas KOHËS, i marrë veçmas nga DB), për tregti manuale
  // me një klik. Pas 15 min hiqet nga widget-i (pxClock rifreskon çdo 1s → rivlerësohet automatikisht)
  // dhe mbetet te lista poshtë. Përdorim latestSig (renditje sipas kohës) që sinjali i ri me
  // besueshmëri më të ulët të mos humbasë pas listës së renditur sipas besueshmërisë.
  const latestSignal = latestSig && signalVisible(latestSig.created_at) ? latestSig : null;

  // Përmbledhje P&L për pasqyrë: LIVE (lundrues, pozicionet e hapura tani) + SOT (realizuar sot + live)
  // + GJITHSEJ (realizuar nga historiku i disponueshëm + live). I jep përdoruesit gjendjen e tregtimit.
  // Floating-u llogaritet nga SHUMA e pozicioneve të hapura (account.profit shpesh vjen null nga MT5).
  const floatingPnl = positions.length > 0
    ? positions.reduce((a, p) => a + Number(p.profit ?? 0), 0)
    : Number(account?.profit ?? 0);
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
    // KOHA REALE E VËRTETË: kur nis minuta/ora e re dhe MT5 s'e ka sjellë ende qiririn e ri (poll 5s),
    // krijoje VETË qiririn e formimit në sekondën e parë — grafiku s'mbetet kurrë një kandil mbrapa MT5.
    // (pxTick e rifreskon memo-n çdo ~1s edhe kur çmimi s'lëviz, që kalimi i minutës të kapet menjëherë.)
    void pxTick;
    const stepSec = tf === '1m' ? 60 : tf === '5m' ? 300 : tf === '15m' ? 900 : tf === '1h' ? 3600 : tf === '4h' ? 14400 : 86400;
    const nowBucket = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
    const prev = out[out.length - 1];
    // Vetëm kur jemi BRENDA 1-3 hapave nga qiriri i fundit i brokerit — përndryshe (orë brokeri
    // të ndryshme nga UTC, hapje e së dielës, boshllëk fundjave) MOS krijo qiri sintetik të gabuar.
    if (nowBucket > prev.time && nowBucket - prev.time <= stepSec * 3) {
      out.push({ time: nowBucket, open: prev.close, high: Math.max(prev.close, brokerMid), low: Math.min(prev.close, brokerMid), close: brokerMid });
    }
    const last = out[out.length - 1];
    out[out.length - 1] = {
      ...last,
      close: brokerMid,
      high: Math.max(last.high, brokerMid),
      low: Math.min(last.low, brokerMid),
    };
    return out;
  }, [candles, brokerMid, tf, pxTick]);
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
  // (3) ZONAT E LIKUIDITETIT nga qirinjtë realë: maja/funde që u prekën ≥2 herë — aty grumbullohen
  // stop-et dhe porositë e mëdha. Top 2 mbi dhe nën çmimin; secila si BREZ (lo–hi) për hijezim.
  const liqZones = useMemo(() => {
    const c = displayCandles;
    if (!c || c.length < 60) return [] as { lo: number; hi: number; edge: number; touches: number }[];
    const hs: number[] = [], ls: number[] = [];
    for (let i = 2; i < c.length - 2; i++) {
      if (c[i].high >= c[i - 1].high && c[i].high >= c[i - 2].high && c[i].high >= c[i + 1].high && c[i].high >= c[i + 2].high) hs.push(c[i].high);
      if (c[i].low <= c[i - 1].low && c[i].low <= c[i - 2].low && c[i].low <= c[i + 1].low && c[i].low <= c[i + 2].low) ls.push(c[i].low);
    }
    const px = c[c.length - 1].close;
    const cluster = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const out: { lo: number; hi: number; touches: number }[] = [];
      let grp: number[] = [];
      const flush = () => {
        if (grp.length >= 2) {
          let lo = grp[0], hi = grp[grp.length - 1];
          if (hi - lo < 0.6) { const m = (lo + hi) / 2; lo = m - 0.3; hi = m + 0.3; } // trashësi minimale e dukshme
          out.push({ lo, hi, touches: grp.length });
        }
        grp = [];
      };
      for (const x of s) { if (grp.length && x - grp[grp.length - 1] > 1.5) flush(); grp.push(x); }
      flush();
      return out;
    };
    // 'edge' = skaji ku FILLON zona (ana më e afërt me çmimin) — aty vizatohet vija e kuqe e lehtë.
    const above = cluster(hs).filter(z => z.lo > px).sort((a, b) => a.lo - b.lo).slice(0, 2)
      .map(z => ({ ...z, edge: z.lo }));
    const below = cluster(ls).filter(z => z.hi < px).sort((a, b) => b.hi - a.hi).slice(0, 2)
      .map(z => ({ ...z, edge: z.hi }));
    return [...above, ...below];
  }, [displayCandles]);

  // Brezat e hijezuar për grafikun (kuqe e lehtë në sfond) — memo që të mos rikrijohen çdo render.
  const liqBands = useMemo(() =>
    showBigLevels ? liqZones.map(z => ({ top: z.hi, bottom: z.lo, fill: 'rgba(239,68,68,0.12)' })) : [],
  [liqZones, showBigLevels]);

  // Ngjyra e linjës së Hyrjes sipas ROBOTIT (e njëjta paletë me raportet) — që në grafik të
  // dallohet menjëherë cili robot e hapi trade-in; blu = manual/i panjohur.
  const robotLineColor = (robot: string | null): string =>
    robot === 'MMT-Long' ? '#38bdf8' : robot === 'MMT-Scalp' ? '#f59e0b' : robot === 'MMT-Fast' ? '#a855f7'
    : robot === 'Sinjalet' ? '#10b981' : robot === 'Sinjalet-Scalp' ? '#14b8a6' : robot === 'FastT' ? '#f43f5e' : '#3b82f6';
  // Linjat: Hyrje/SL/TP për ÇDO pozicion + linja "Tani". SL/TP të pozicionit AKTIV (në editim) nuk
  // vizatohen këtu — i mbulon doreza e tërheqshme (që mos të dyfishohen).
  const chartLines: PriceLineDef[] = [
    ...posnsForSymbol.flatMap((p, i): PriceLineDef[] => {
      const isScalp = isPosScalp(p);
      const robot = robotOfPosition(p);
      const who = robot ?? (isScalp ? t('Afatshkurtër') : t('Afatgjatë'));
      const pnl = livePnlOf(p), risk = riskOf(p), reward = rewardOf(p);
      const tag = multiPos ? ` #${i + 1}` : '';
      const editing = activePosId === p.id;
      return [
        ...(p.openPrice ? [{ price: p.openPrice, color: robotLineColor(robot), title: `${t('Hyrje')}${tag} · ${who}${pnl != null ? ` · ${pnl >= 0 ? '+' : ''}${r2(pnl)} ${fcur}` : ''}` }] : []),
        ...((p.stopLoss && !editing) ? [{ price: p.stopLoss, color: '#ef4444', title: `SL${tag}${risk != null ? ` · -${r2(risk)} ${fcur}` : ''}` }] : []),
        ...((p.takeProfit && !editing) ? [{ price: p.takeProfit, color: '#22c55e', title: `TP${tag}${reward != null ? ` · +${r2(reward)} ${fcur}` : ''}` }] : []),
      ];
    }),
    // BID/ASK si në MetaTrader 5: vija me pika (e kuqe = Bid, blu = Ask) që lëvizin live.
    ...((brokerPx && pxFresh)
      ? [
          { price: Math.round(brokerPx.bid * 100) / 100, color: '#ef5350', title: 'Bid', style: 'dotted' as const, width: 1 as const },
          { price: Math.round(brokerPx.ask * 100) / 100, color: '#42a5f5', title: 'Ask', style: 'dotted' as const, width: 1 as const },
        ]
      : []),
    ...((livePrice != null && posnsForSymbol.length)
      ? [{ price: livePrice, color: pxFresh ? '#fbbf24' : '#6b7280',
          title: (pxFresh && totalLivePnl != null)
            ? `${t('Tani')} · ${totalLivePnl >= 0 ? '+' : ''}${r2(totalLivePnl)} ${fcur}`
            : `${t('Tani')} · ${t('çmim jo-live — mos mbyll')}` }]
      : []),
    // NIVELET E MËDHA (çelësi 🏦): muret reale të porosive (PAXG, ≤2 min të vjetra, ndjekin
    // çmimin live të brokerit) + zonat e likuiditetit nga qirinjtë (maja/funde të prekura ≥2×).
    ...((showBigLevels && /XAU|GOLD/i.test(selected) && brokerPx && pxFresh && Date.now() - obWallsAt < 120_000)
      ? obWalls.map(w => ({
          price: Math.round(((brokerPx!.bid + brokerPx!.ask) / 2 + w.delta) * 100) / 100,
          color: w.side === 'buy' ? '#22d3ee' : '#fb923c',
          title: `${w.side === 'buy' ? t('Mur blerësish') : t('Mur shitësish')} · ~${Math.round(w.qty)} oz`,
        }))
      : []),
    // Vija e kuqe e lehtë te SKAJI ku fillon zona (brezi vetë hijezon sfondin — shih liqBands).
    ...(showBigLevels
      ? liqZones.map(z => ({ price: Math.round(z.edge * 100) / 100, color: '#f87171', title: `${t('Zonë likuiditeti')} · ${z.touches} ${t('prekje')}` }))
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

  // Sinjalet e Telegram Sin (rifreskohen çdo 30s) — për tabelën e shpejtë + feed-in e mesazheve.
  useEffect(() => {
    if (!user) return;
    const load = () => {
      loadTelegramSignals(user.id, 60).then(setTgSigs).catch(() => {});
      loadTelegramEntrySignals(user.id, 150).then(setTgEntries).catch(() => {});
      loadTgLegs(user.id).then(setTgLegs).catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [user]);
  const TG_CHAN_LABEL: Record<string, string> = {
    '-1003603315504': 'BESA DIGITAL VIP',
    '-1003278125980': 'FX+ | XNINE LEVEL 2',
    'platform': 'GoldSniper|FX',
  };
  // Sinjalet që kanë HYRË në trade (jo komentet/injoruarat) — të ndara në tri tabela:
  // LIVE në trade · në pritje · raportet (të mbyllura/anuluara). (Kërkesa e pronarit.)
  const tgSigEntries = tgEntries.filter((s) => ['pending', 'executed', 'partial', 'closed', 'canceled'].includes(s.status));
  const tgLegsOf = (sigId: string) => tgLegs.filter((l) => l.signal_id === sigId);
  const tgPending = tgSigEntries.filter((s) => s.status === 'pending');
  const tgDone = tgSigEntries.filter((s) => ['closed', 'canceled'].includes(s.status));

  // Rreshtat e raportit (Telegram Sin) — të gjitha kanalet bashkë; kanali shfaqet te kolona "Burimi".
  const tgReportRows: ReportRow[] = tgDone.map((s) => {
    const legs = tgLegsOf(s.id);
    const pnl = sigPnl(legs);
    // Data e raportit = MBYLLJA e fundit e trade-it (nëse ka) — një sinjal i hapur sot që
    // mbyllet nesër shfaqet ditën e mbylljes, jo të hapjes.
    const lastClose = legs.map((l) => l.closed_at).filter(Boolean).sort().pop();
    return {
      id: s.id, date: new Date(lastClose || s.created_at),
      label: TG_CHAN_LABEL[String(s.tg_chat_id ?? '')] || s.tg_sender || 'Telegram',
      direction: (s.direction as 'buy' | 'sell' | null) ?? null,
      entry: s.entry_price ?? null, market: s.entry_type === 'market',
      sl: s.stop_loss ?? null, tps: Array.isArray(s.tps) ? s.tps : [],
      pips: pnl.pips, net: pnl.net, status: s.status, tpHit: s.tp_hit ?? 0,
    };
  });

  // Hyrjet MANUALE (nga historiku i MT5): trade të mbyllura pa robot (tregtim i drejtpërdrejtë yti).
  const manualReportRows: ReportRow[] = history
    .filter((h) => h.robot === 'Manuale' || h.source === 'manual')
    .map((h) => {
      const isGold = /XAU|GOLD/i.test(h.symbol || '');
      const dir = h.direction === 'BUY' ? 1 : -1;
      const pips = (isGold && h.entryPrice != null && h.exitPrice != null)
        ? Math.round((h.exitPrice - h.entryPrice) * dir * 10 * 10) / 10 : null;
      return {
        id: h.id, date: new Date(h.closeTime || h.openTime || 0),
        label: h.symbol, direction: h.direction === 'BUY' ? 'buy' : h.direction === 'SELL' ? 'sell' : null,
        entry: h.entryPrice ?? null, market: false, sl: h.plannedSL ?? null,
        tps: h.plannedTP != null ? [h.plannedTP] : [], pips, net: h.net, status: 'closed', tpHit: 0,
      } as ReportRow;
    });
  // Tabela e përbashkët e sinjaleve të Telegram Sin (përdoret nga të tri seksionet).
  const renderTgSinTable = (list: TelegramSignalRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 pr-3 font-medium">{t('Data / Ora')}</th>
            <th className="text-left py-2 pr-3 font-medium">{t('Kanali')}</th>
            <th className="text-left py-2 pr-3 font-medium">{t('Drejtimi')}</th>
            <th className="text-right py-2 pr-3 font-medium">{t('Hyrja')}</th>
            <th className="text-right py-2 pr-3 font-medium">SL</th>
            <th className="text-left py-2 pr-3 font-medium">TP</th>
            <th className="text-right py-2 pr-3 font-medium">Pips</th>
            <th className="text-right py-2 pr-3 font-medium">{t('Fitimi')}</th>
            <th className="text-left py-2 pr-3 font-medium">{t('Statusi')}</th>
            <th className="text-left py-2 font-medium">{t('Rezultati')}</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, 15).map((s) => {
            const d = new Date(s.created_at);
            const tps = Array.isArray(s.tps) ? s.tps : [];
            const pnl = sigPnl(tgLegsOf(s.id));
            return (
              <tr key={s.id} className="border-b border-gray-800/60">
                <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-2 pr-3 text-sky-300 whitespace-nowrap">{TG_CHAN_LABEL[String(s.tg_chat_id ?? '')] || s.tg_sender || '—'}</td>
                <td className={`py-2 pr-3 font-semibold ${s.direction === 'buy' ? 'text-green-400' : s.direction === 'sell' ? 'text-red-400' : 'text-gray-400'}`}>{s.direction ? s.direction.toUpperCase() : '—'}</td>
                <td className="py-2 pr-3 text-right text-gray-300 tabular-nums">{s.entry_type === 'market' ? 'MKT' : (s.entry_price ?? '—')}</td>
                <td className="py-2 pr-3 text-right text-gray-300 tabular-nums">{s.stop_loss ?? '—'}</td>
                <td className="py-2 pr-3 text-gray-300 tabular-nums whitespace-nowrap">{tps.length ? tps.join(' / ') : '—'}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${pnl.pips == null ? 'text-gray-600' : pnl.pips >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl.pips == null ? '—' : Math.abs(pnl.pips)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${pnl.net == null ? 'text-gray-600' : pnl.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl.net == null ? '—' : `${pnl.net >= 0 ? '+' : ''}${pnl.net.toFixed(2)}$`}</td>
                <td className="py-2 pr-3">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    s.status === 'pending' ? 'bg-blue-500/15 text-blue-300'
                    : s.status === 'canceled' ? 'bg-amber-500/15 text-amber-300'
                    : s.status === 'closed' ? 'bg-gray-600/30 text-gray-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                  }`}>{s.status === 'pending' ? t('Në pritje') : s.status === 'canceled' ? t('Anuluar') : s.status === 'closed' ? t('Mbyllur') : t('Në trade')}</span>
                </td>
                <td className="py-2">
                  {(s.tp_hit ?? 0) > 0
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">→ TP{s.tp_hit}</span>
                    : s.status === 'canceled'
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">✕ Cancel</span>
                      : s.status === 'closed'
                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300">SL</span>
                        : <span className="text-gray-600 text-[10px]">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const money = (n?: number) => (n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const cur = account?.currency || '$';

  return (
    <div className="p-4 sm:p-6 space-y-3">
      {/* Titulli + LIVE + rifreskimi NË NJË RRESHT — pa rresht më vete poshtë (pa zbrazëtira). */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-amber-400" />{t('MetaTrader 5 — Live')}
          </h2>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            !metaConfigured ? 'bg-gray-700/50 text-gray-400 border-gray-600'
            : mtMode === 'live' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
          }`}>{!metaConfigured ? t('PA LIDHJE') : mtMode === 'live' ? t('● LIVE') : t('● DEMO')}</span>
          <button onClick={refreshAll} disabled={refreshing} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all disabled:opacity-60"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /></button>
        </div>
        <p className="text-gray-400 text-[11px] mt-0.5">
          {t('Llogaria jote reale MT5, grafiku, tregtimi dhe trade-t — live')}
          {lastUpdated && <span className="ml-2 text-gray-600">· {lastUpdated.toLocaleTimeString()}</span>}
        </p>
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
          className="bg-gray-900 border border-gray-800 rounded-2xl px-3 py-2.5 cursor-pointer select-none grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 sm:divide-x sm:divide-gray-800">
          {/* SHIRIT KLASIK 6-vlerësh (si terminalet klasike): Balanca · Equity · Marzhi · P&L sot ·
              P&L 8 ditë · Live — një bar i vetëm në vend të dy rreshtave me karta. */}
          {[
            { label: t('Balanca'), value: `${money(account?.balance)} ${cur}`, cls: 'text-white', eye: true },
            { label: t('Equity'), value: `${money(account?.equity)} ${cur}`, cls: 'text-white' },
            { label: t('Marzh i lirë'), value: `${money(account?.freeMargin)} ${cur}`, cls: 'text-white' },
            { label: t('Fitim/Humbje sot'), value: pnlCard(pnlToday), cls: pnlCls(pnlToday) },
            { label: t('Fitim/Humbje (8 ditët e fundit)'), value: pnlCard(pnlTotal), cls: pnlCls(pnlTotal) },
            { label: t('Live (hapur tani)'), value: pnlCard(floatingPnl), cls: pnlCls(floatingPnl) },
          ].map((c) => (
            <div key={c.label} className="min-w-0 sm:pl-4 sm:first:pl-0">
              <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-0.5 truncate">
                <span className="truncate">{c.label}</span>
                {c.eye && (showBalances ? <Eye className="w-3 h-3 text-gray-500 shrink-0" /> : <EyeOff className="w-3 h-3 text-gray-500 shrink-0" />)}
              </div>
              <div className={`font-bold text-sm tabular-nums truncate transition-all ${c.cls} ${showBalances ? '' : 'blur-[6px]'}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Njoftimi për orarin u zhvendos te faqja "Lidhja & Konfigurimi" (zinte hapësirë këtu).
          Banner-i i para-hapjes u zhvendos NË FUND të faqes (kërkesa e pronarit). */}

      {/* TICKER LIVE — kompakt e i palosshëm (hamburger): titulli tregon çmimin e vogël live;
          hapja shfaq Bid/Ask/Spread + gjendjen e lidhjes (kërkesa e pronarit — zinte shumë vend). */}
      <details className="bg-gray-900 border border-gray-800 rounded-2xl group">
        <style>{`@keyframes mtPulse{0%,100%{opacity:1}50%{opacity:.25}}.mt-pulse{animation:mtPulse 1.2s ease-in-out infinite}@keyframes mtFlash{from{background-color:rgba(251,191,36,.16)}to{background-color:transparent}}.mt-flash{animation:mtFlash .5s ease-out}`}</style>
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white font-bold text-xs shrink-0">{selected}</span>
            <span key={pxTick} className="mt-flash rounded-md px-1 inline-flex items-center gap-1">
              <span className={`text-sm font-bold tabular-nums ${!pxFresh ? 'text-gray-500' : pxDir === 'up' ? 'text-green-400' : pxDir === 'down' ? 'text-red-400' : 'text-white'}`}>
                {livePrice != null ? livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
              </span>
              {pxDir === 'up' && <ArrowUp className="w-3 h-3 text-green-400" />}
              {pxDir === 'down' && <ArrowDown className="w-3 h-3 text-red-400" />}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pxFresh ? 'bg-green-400 mt-pulse' : brokerPx ? 'bg-amber-500 mt-pulse' : 'bg-gray-600'}`} />
          </div>
          <ChevronDown className="w-4 h-4 text-gray-500 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-3 pt-1 flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs flex-wrap border-t border-gray-800/60">
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
      </details>

      {/* GRAFIK — pamje TradingView (sfond #131722), të dhëna reale nga MT5 + funksionet tona (linjat). */}
      <div className="border border-[#2a2e39] rounded-2xl overflow-hidden" style={{ background: '#131722' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2e39] flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {assets.filter(a => allowedSymbols.includes(a.symbol)).map(a => (
                  <button key={a.id} onClick={() => pickSymbol(a.symbol)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${selected === a.symbol ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {a.symbol}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map(t => (
                    <button key={t} onClick={() => setTf(t)} className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${tf === t ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>{t === '1d' ? '1D' : t}</button>
                  ))}
                </div>
                {/* Çelësi 🏦 — muret e porosive + zonat e likuiditetit në grafik (me kujtesë). */}
                <button onClick={toggleBigLevels} title={t('Muret e porosive (blerës/shitës të mëdhenj) + zonat e likuiditetit në grafik')}
                  className={`text-[11px] px-2 py-1 rounded-lg font-semibold transition-colors border ${showBigLevels ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-gray-800 text-gray-500 border-transparent hover:text-white'}`}>
                  🏦 {t('Nivelet')}
                </button>
                {/* EKRAN I PLOTË — zmadho grafikun në gjithë ekranin me butona Buy/Sell/Cancel. */}
                <button onClick={() => setChartFull(true)} title={t('Ekran i plotë')}
                  className="text-[11px] px-2 py-1 rounded-lg font-semibold bg-gray-800 text-gray-400 hover:text-white border border-transparent">
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="px-2 pb-2">
              {candles.length === 0 ? (
                <div className="h-[460px] flex items-center justify-center text-gray-600 text-sm">{t('Po ngarkohet grafiku…')}</div>
              ) : (
                <Mt5Chart candles={displayCandles} lines={chartLines} bands={liqBands} height={460} fitKey={`${selected}_${tf}`}
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
                {(() => {
                  // Etiketa nën grafik: emri i saktë i robotit kur dihet; ndryshe afati si më parë.
                  const rb = posForSymbol ? robotOfPosition(posForSymbol) : null;
                  return rb
                    ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${robotBadgeCls(rb)}`}>{rb}</span>
                    : <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${posIsScalp ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{posIsScalp ? t('Afatshkurtër') : t('Afatgjatë')}</span>;
                })()}
                {totalLivePnl != null && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400" />{t('Tani')}: <span className={`font-bold ${totalLivePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalLivePnl >= 0 ? '+' : ''}{r2(totalLivePnl)} {fcur}</span></span>
                )}
                {multiPos && <span className="text-gray-400">· {posnsForSymbol.length} {t('pozicione hapur')}</span>}
              </div>
            )}
      </div>

      {/* ===== EKRAN I PLOTË — grafiku në gjithë ekranin + butona Buy/Sell/Cancel (horizontal & vertikal) ===== */}
      {chartFull && (
        <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: '#131722', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {/* Shiriti i sipërm: simboli, çmimi, periudhat, Nivelet, dalja — GJITHMONË NJË RRESHT.
              Në mobil emri/çmimi/pillat zvogëlohen që të nxënë të gjitha pa krijuar rresht të dytë;
              në desktop/tablet ka hapësirë — të njëjtat elemente, më të mëdha. */}
          <div className="flex items-center justify-between gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 border-b border-[#2a2e39]">
            <div className="flex items-center gap-1 sm:gap-2 min-w-0 shrink">
              <span className="text-white font-bold text-[11px] sm:text-sm truncate">{selected}</span>
              {livePrice != null && <span className={`text-[11px] sm:text-sm font-black tabular-nums whitespace-nowrap ${!pxFresh ? 'text-gray-500' : pxDir === 'up' ? 'text-green-400' : pxDir === 'down' ? 'text-red-400' : 'text-white'}`}>{livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <div className="flex gap-0.5 sm:gap-1 bg-gray-800 rounded-lg p-0.5">
                {['1m', '5m', '15m', '1h', '4h', '1d'].map(tt => (
                  <button key={tt} onClick={() => setTf(tt)} className={`text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md font-medium ${tf === tt ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>{tt === '1d' ? '1D' : tt}</button>
                ))}
              </div>
              {/* Çelësi 🏦 Nivelet — i njëjti si te pamja normale (muret e porosive + zonat e likuiditetit).
                  Në mobil vetëm ikona (kursen vend); teksti shfaqet nga sm: e lart. */}
              <button onClick={toggleBigLevels} title={t('Muret e porosive (blerës/shitës të mëdhenj) + zonat e likuiditetit në grafik')}
                className={`text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-lg font-semibold transition-colors border ${showBigLevels ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-gray-800 text-gray-500 border-transparent hover:text-white'}`}>
                🏦<span className="hidden sm:inline"> {t('Nivelet')}</span>
              </button>
              <button onClick={() => setChartFull(false)} className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white" title={t('Dil nga ekrani i plotë')}><Minimize2 className="w-4 h-4" /></button>
            </div>
          </div>
          {/* Grafiku — mbush gjithë hapësirën e mbetur. Lartësia llogaritet ngushtë (vh − shiritat
              lart+poshtë ≈ 100px) që të MOS mbetet brez bosh mbi butonat — grafiku sa më i madh. */}
          <div ref={fullChartRef} className="flex-1 min-h-0 overflow-hidden">
            {candles.length > 0 && fullChartH > 0 && (
              <Mt5Chart candles={displayCandles} lines={chartLines} bands={liqBands} height={Math.max(220, fullChartH)} fitKey={`full_${selected}_${tf}`}
                positions={editables} activeId={activePosId} onActiveChange={setActivePosId} onCommitSlTp={onCommitSlTp} />
            )}
          </div>
          {/* Shiriti i tregtimit: lot (me butona −/+ jashtë fushës) + BUY / SELL / OPEN ORDER —
              NJË RRESHT, butona kompaktë që të rrinë të gjithë brenda edhe në telefon vertikal.

              HAPËSIRA PAS LOTIT (kërkesë e pronarit, 3 gusht 2026): butoni '+' i lotit ishte ngjitur
              me BUY-n, ndaj gishti e prekte BUY-n aksidentalisht ndërsa ndryshohej loti — një klik i
              gabuar hap tregti reale. Tani mes tyre ka një brez të vdekur, që nuk reagon në prekje.
              Rritet me ekranin (telefon → tablet/iPad → PC); BUY/SELL/Open Order janë 'flex-1', pra
              shkurtohen vetvetiu për ta bërë vend — pikërisht siç u kërkua. */}
          <div className="border-t border-[#2a2e39] px-2 py-1.5 flex items-center gap-1.5 sm:gap-2">
            <div className="flex items-stretch shrink-0 rounded-lg overflow-hidden border border-gray-700 bg-black/40 mr-2 sm:mr-4 lg:mr-6">
              <button onClick={() => setLot(l => (Math.max(0.01, Math.round(((parseFloat(l) || 0.01) - 0.01) * 100) / 100)).toFixed(2))}
                title={t('Ul lotin')} aria-label={t('Ul lotin')}
                className="px-2 text-gray-300 hover:bg-gray-700 hover:text-white font-bold text-sm">−</button>
              <input type="number" step="0.01" min="0.01" value={lot} onChange={e => setLot(e.target.value)}
                title={t('Lot')} aria-label={t('Lot')}
                className="w-11 bg-transparent py-1.5 text-white text-xs text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <button onClick={() => setLot(l => (Math.max(0.01, Math.round(((parseFloat(l) || 0.01) + 0.01) * 100) / 100)).toFixed(2))}
                title={t('Rrit lotin')} aria-label={t('Rrit lotin')}
                className="px-2 text-gray-300 hover:bg-gray-700 hover:text-white font-bold text-sm">+</button>
            </div>
            <button onClick={() => quickTrade('buy')} disabled={tradeLoading}
              className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-500 hover:bg-green-400 text-white font-bold text-xs disabled:opacity-50">
              {tradeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}BUY
            </button>
            <button onClick={() => quickTrade('sell')} disabled={tradeLoading}
              className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white font-bold text-xs disabled:opacity-50">
              {tradeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingDown className="w-3.5 h-3.5" />}SELL
            </button>
            {/* "Open Order" (jo "Close") — hap dritaren me porositë e hapura live (kërkesa e pronarit).
                Në telefon vetëm "Order": hapësira e re para BUY-t ia merr disa piksela, dhe pa këtë
                etiketa thyhej në dy rreshta e trashte shiritin. Nga sm: e lart teksti është i plotë. */}
            <button onClick={openClosePanel} disabled={tradeLoading}
              className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 font-bold text-xs whitespace-nowrap disabled:opacity-50">
              <Activity className="w-3.5 h-3.5 shrink-0" /><span><span className="hidden sm:inline">Open </span>Order</span>
            </button>
          </div>
          {tradeMsg && (
            <div className={`px-3 py-1.5 text-[11px] ${tradeMsg.type === 'success' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>{tradeMsg.text}</div>
          )}
          {/* PANELI "MBYLL": lista e pozicioneve të hapura + porosive në pritje — secili me butonin e vet. */}
          {closePanel && (
            <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/60" onClick={() => setClosePanel(false)}>
              <div className="bg-[#1a1e27] border-t border-[#2a2e39] rounded-t-2xl max-h-[70%] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e39]">
                  <span className="text-white font-semibold text-sm">{t('Pozicionet e hapura')}</span>
                  <button onClick={() => setClosePanel(false)} className="p-1 rounded-lg text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="overflow-y-auto p-3 space-y-2">
                  {positions.length === 0 && pendingList.length === 0 && (
                    <div className="text-[12px] text-gray-500 text-center py-6">{t('Asnjë pozicion i hapur apo porosi në pritje.')}</div>
                  )}
                  {positions.map((p) => {
                    const isBuy = (p.type || '').includes('BUY');
                    const profit = Number(p.profit ?? 0);
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-2 bg-black/30 rounded-xl px-3 py-2.5">
                        <span className="flex items-center gap-2 min-w-0 flex-wrap text-xs">
                          {isBuy ? <TrendingUp className="w-4 h-4 text-green-400 shrink-0" /> : <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />}
                          <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span>
                          <span className="text-white">{p.symbol}</span>
                          <span className="text-gray-400">{p.volume} {t('lot')}</span>
                          {p.openPrice != null && <span className="text-gray-500">@ {p.openPrice}</span>}
                          <span className={`font-semibold tabular-nums ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{profit >= 0 ? '+' : ''}{profit.toFixed(2)}</span>
                        </span>
                        <button onClick={() => closeOnePosition(String(p.id))} disabled={closingId === String(p.id)}
                          className="shrink-0 inline-flex items-center gap-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40 px-3 py-1.5 rounded-lg font-bold text-xs disabled:opacity-50">
                          {closingId === String(p.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}{t('Mbyll')}
                        </button>
                      </div>
                    );
                  })}
                  {pendingList.length > 0 && (
                    <div className="pt-1 text-[11px] text-gray-400 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-400" />{t('Porositë në pritje')}</div>
                  )}
                  {pendingList.map((o) => {
                    const isBuy = (o.type || '').includes('BUY');
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2.5">
                        <span className="flex items-center gap-2 text-xs">
                          <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span>
                          <span className="text-white">{o.symbol}</span>
                          <span className="text-gray-500">{o.volume} {t('lot')}</span>
                          {o.openPrice != null && <span className="text-amber-400">@ {o.openPrice}</span>}
                        </span>
                        <button onClick={() => cancelOnePending(String(o.id))} disabled={closingId === String(o.id)}
                          className="shrink-0 inline-flex items-center gap-1 bg-gray-700/60 hover:bg-gray-700 text-gray-200 border border-gray-600 px-3 py-1.5 rounded-lg font-bold text-xs disabled:opacity-50">
                          {closingId === String(o.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}{t('Anulo')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RENDITJA (kërkesa e pronarit): Porosia e re (1) → Pozicionet e hapura (2) → Sinjali i fundit. */}
      <div className="flex flex-col gap-3">

      {/* Sinjali i fundit (motori/MMT) — VETËM kur roboti i Sinjaleve është aktiv DHE përdoruesi është VIP.
          Përdoruesit normalë s'e shohin fare — ata marrin vetëm GoldSniperFX Algorithm (kërkesa e pronarit). */}
      {signalsRobotOn && isVip && (
      <div className="order-4 bg-gray-900 border border-gray-800 rounded-2xl p-3">
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
      )}
        {/* Porosia BLEJ/SHIT — order-1: MENJËHERË nën grafik. Vetëm manuale; e palosur si default. */}
        <div className="order-1 bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2 h-fit">
          <button onClick={() => setShowNewOrder(v => !v)} className="w-full flex items-center justify-between text-left">
            <h3 className="text-white font-semibold text-sm">{t('Porosi e re — {sym}', { sym: selected })} <span className="text-[10px] text-gray-500 font-normal">{t('(manual)')}</span></h3>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showNewOrder ? 'rotate-180' : ''}`} />
          </button>
          {showNewOrder && (<>
          {/* RRESHTI 1 — BLEJ/SHIT + presetet e lotit (chips të vegjël), të gjitha në një rresht. */}
          <div className="flex items-stretch gap-1.5">
            <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0">
              <button onClick={() => setTradeType('buy')} className={`px-3 py-1.5 text-xs font-bold transition-all ${tradeType === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('BLEJ')}</button>
              <button onClick={() => setTradeType('sell')} className={`px-3 py-1.5 text-xs font-bold transition-all ${tradeType === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{t('SHIT')}</button>
            </div>
            {/* Presetet e lotit — gjerësi FIKSE në desktop (jo flex-1), që të mos fryhen sa gjithë rreshti. */}
            <div className="flex gap-1 flex-1 sm:flex-initial">
              {['0.01', '0.05', '0.10', '0.25'].map(v => (
                <button key={v} onClick={() => setLot(v)} className={`flex-1 sm:flex-none sm:w-16 text-[11px] py-1.5 rounded-md transition-colors ${lot === v ? 'bg-amber-500 text-gray-950 font-semibold' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}>{v}</button>
              ))}
            </div>
          </div>
          {/* RRESHTI 2 — 4 fusha kompakte: Lot · Hyrje · SL · TP (2 kolona në telefon → 2 rreshta). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div>
              <label className="block text-[9px] text-gray-400 mb-0.5">{t('Lot')}</label>
              <input type="number" value={lot} onChange={e => setLot(e.target.value)} min="0.01" step="0.01"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white text-xs tabular-nums focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[9px] text-amber-400 mb-0.5">{t('Hyrje')} <span className="text-gray-600">{t('(tregu)')}</span></label>
              <input type="number" step="0.01" value={newEntry} onChange={e => setNewEntry(e.target.value)} placeholder={t('tregu')}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white text-xs tabular-nums focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[9px] text-red-400 mb-0.5">SL</label>
              <input type="number" step="0.01" value={newSl} onChange={e => setNewSl(e.target.value)} placeholder={t('ops.')}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white text-xs tabular-nums focus:outline-none focus:border-red-500" />
            </div>
            <div>
              <label className="block text-[9px] text-green-400 mb-0.5">TP</label>
              <input type="number" step="0.01" value={newTp} onChange={e => setNewTp(e.target.value)} placeholder={t('ops.')}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white text-xs tabular-nums focus:outline-none focus:border-green-500" />
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
          {/* RRESHTI 3 — veprimi: BLEJ/SHIT. Në desktop me gjerësi të kufizuar (jo sa gjithë rreshti). */}
          <div className="flex">
            <button onClick={handleTrade} disabled={tradeLoading || !metaConfigured}
              className={`w-full sm:w-auto sm:min-w-[16rem] sm:px-10 py-2 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${tradeType === 'buy' ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}>
              {tradeLoading && <Loader2 className="w-4 h-4 animate-spin" />}{tradeType === 'buy' ? t('BLEJ') : t('SHIT')} {selected}
            </button>
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
          </>)}
        </div>

      {/* Pozicionet e hapura (live) — order-2: menjëherë pas Porosisë (kërkesa e pronarit). */}
      <div className="order-2">
        <OpenPositionsPanel configured={metaConfigured} section="positions" />
      </div>
      </div>

      {/* NISJA (llogari e re): pa lidhje me MetaTrader, të gjitha tabelat më poshtë rrinë bosh.
          Pa këtë kartë, përdoruesi i ri shihte një faqe të zbrazët pa e ditur pse. E çojmë te
          MANUALI, sepse aty janë të gjitha hapat: brokeri (Vantage), MetaTrader dhe MetaApi. */}
      {!metaConfigured && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-white font-bold text-sm">{t('Lidh MetaTrader-in që të nisë gjithçka')}</h3>
              <p className="text-[12px] text-gray-400 leading-relaxed mt-1">
                {t('Pozicionet e hapura, sinjalet e GoldSniperFX, raportet dhe mesazhet shfaqen sapo llogaria jote e tregtimit të lidhet. Të duhen tri gjëra me radhë:')}
              </p>
              <ol className="text-[12px] text-gray-300 mt-2 space-y-1 list-decimal list-inside">
                <li>{t('Një llogari te një broker (p.sh. Vantage) — pa broker nuk hapet dot MetaTrader.')}</li>
                <li>{t('Llogaria MetaTrader (MT4 ose MT5) te ai broker.')}</li>
                <li>{t('MetaApi, që e lidh MetaTrader-in me platformën (Account ID + Token).')}</li>
              </ol>
              <p className="text-[11px] text-gray-500 mt-2">
                {t('Manuali i përdorimit i ka të gjitha hapat me pamje ekrani, nga hapja e llogarisë deri te lidhja.')}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => onNavigate('manual')}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950">
                  <BookOpen className="w-4 h-4" />{t('Hap Manualin e përdorimit')}
                </button>
                <button onClick={() => onNavigate('telegram_sin')}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
                  {t('Kam gjithçka — lidhe tani')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TELEGRAM SIN — TRI TABELAT (kërkesa e pronarit): LIVE në trade · në pritje · raportet.
          Tabelat e robotëve të tjerë u HOQËN nga Trade Live (i gjen te faqja Raporte). */}
      {/* Tabelat rrinë GJITHMONË në faqe — edhe kur janë bosh, edhe pa lidhje me MetaTrader.
          Kështu përdoruesi e sheh strukturën që do t'i mbushet sapo të nisë tregtimi, në vend
          që faqja t'i dukej e zbrazët (kërkesa e pronarit). */}
      {/* "LIVE në trade" U HOQ: te "Pozicionet e hapura (live nga MT5)" më lart shfaqen tashmë
          TË GJITHA pozicionet e hapura, përfshirë ato të hapura nga sinjalet — ishte e njëjta
          punë dy herë (kërkesa e pronarit).
          "Porositë në pritje" shfaqet VETËM kur ka vërtet ndonjë — një tabelë që thotë
          "asnjë porosi" nuk i shërben askujt; raportet dhe mesazhet mbeten gjithmonë. */}
      {tgPending.length > 0 && (
        <TLFold k="tgpend" title={t('GoldSniperFX Algorithm — porositë në pritje')} icon={<Clock className="w-4 h-4 text-blue-400" />}>
          <p className="text-[10px] text-gray-500 mb-2">{t('Porosia rri në pritje derisa çmimi të arrijë hyrjen (ose derisa të mbyllet nga sinjali/ti).')}</p>
          {renderTgSinTable(tgPending)}
        </TLFold>
      )}
      <TLFold k="tgdone" title={t('GoldSniperFX')} icon={<History className="w-4 h-4 text-sky-400" />}>
        {/* NDARJE DITORE + përmbledhje ditore & e përgjithshme + filtër date (ditë/interval). */}
        {tgReportRows.length > 0
          ? <ReportBook rows={tgReportRows} lossLabel="SL" defaultToday />
          : <TLEmpty text={t('Raportet e sinjaleve shfaqen këtu sapo të mbyllet tregtia e parë.')} />}
      </TLFold>

      {/* HYRJET MANUALE (kërkesa e pronarit): raport i veçantë, model hamburger, me ndarje ditore
          + përmbledhje (sa hyrje, sa profit, sa humbje, bilanci) + filtër date. */}
      <TLFold k="tgmanual" title={t('Hyrjet manuale — raportet')} icon={<History className="w-4 h-4 text-amber-400" />}>
        {manualReportRows.length > 0
          ? <ReportBook rows={manualReportRows} defaultToday />
          : <TLEmpty text={t('Raportet e hyrjeve manuale shfaqen këtu pas tregtisë sate të parë.')} />}
      </TLFold>

      {/* MESAZHET E GRUPEVE (kërkesa e pronarit): mesazhi MË I RI gjithmonë i dukshëm nën kokë;
          të tjerët hapen me klik te shiriti (model hamburger) — feed-i i plotë, i lexueshëm. */}
      {(() => {
        const msgCard = (s: (typeof tgSigs)[number]) => {
          const d = new Date(s.created_at);
          const isSig = s.kind === 'entry' && s.status !== 'ignored';
          return (
            <div key={s.id} className={`rounded-lg border px-3 py-2 ${isSig ? 'border-sky-500/25 bg-sky-500/[0.05]' : 'border-gray-800 bg-gray-900/60'}`}>
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <span className="text-[10px] text-sky-300 font-semibold">{TG_CHAN_LABEL[String(s.tg_chat_id ?? '')] || s.tg_sender || 'Telegram'}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                    isSig ? 'bg-emerald-500/15 text-emerald-300'
                    : s.kind === 'modify' ? 'bg-sky-500/15 text-sky-300'
                    : s.kind === 'exit' ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-gray-700/50 text-gray-400'
                  }`}>{isSig ? t('SINJAL') : s.kind === 'modify' ? t('Modifikim') : s.kind === 'exit' ? t('Dalje') : t('Koment')}</span>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">{d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              </div>
              <p className="text-[11px] text-gray-300 whitespace-pre-wrap break-words leading-snug">{s.raw_text || '—'}</p>
            </div>
          );
        };
        const older = tgSigs.slice(1, 40);
        return (
          <TLFold k="tgmsgs" defaultOpen={false} title={t('Mesazhet')} icon={<Zap className="w-4 h-4 text-sky-400" />}
            always={tgSigs.length > 0 ? msgCard(tgSigs[0]) : <TLEmpty text={t('Mesazhet e kanalit shfaqen këtu sapo të vijë i pari.')} />}>
            {older.length > 0 ? (
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">{older.map(msgCard)}</div>
            ) : (
              <p className="text-[11px] text-gray-500">{t('S\'ka mesazhe më të vjetra.')}</p>
            )}
          </TLFold>
        );
      })()}

      {/* 4+5) Analizat e sinjaleve (motori/MMT) — VETËM kur roboti i Sinjaleve është aktiv DHE VIP.
          Përdoruesit normalë s'i shohin — vetëm GoldSniperFX Algorithm (kërkesa e pronarit). */}
      {signalsRobotOn && isVip && (
        <TLFold k="history" bare defaultOpen={false} title={t('Analiza e sinjaleve — të përfunduarat + historiku i skanimeve')} icon={<History className="w-4 h-4 text-amber-400" />}>
          <CompletedSignals signals={doneSignals} variant="compact" />
          <SignalScanLog title={t('Historiku i Skanimeve (Live) — pse hyn ose s\'hyn sinjali')} />
        </TLFold>
      )}

      {/* PARA-HAPJEJE — tregu i mbyllur OSE i ngrirë (çmimi s'lëviz): numëruesi + porositë në radhë.
          NË FUND të faqes (kërkesa e pronarit — mos e zërë hapësirën lart). */}
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
    </div>
  );
}
