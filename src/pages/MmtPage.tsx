import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Brain, Power, ShieldAlert, Activity, RefreshCw, Loader2, Clock, TrendingUp, TrendingDown, Zap, FileText, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import Mt5Chart, { type ChartCandle, type PriceLineDef, type ChartMarkerDef } from '../components/Mt5Chart';
import { loadCandles } from '../services/metaapi';

// MMT — SUPER ROBOTI (faqe KOMPLET E VEÇANTË nga Cilësimet e robotëve ekzistues).
// Faza HIJE: tregton vetëm në letër; këtu menaxhohen cilësimet e tij dhe shihet performanca.

interface MmtConfig {
  active: boolean; paper_equity: number; risk_pct: number; rr: number;
  max_open: number; max_same_dir: number; daily_stop_pct: number; kill_after_sl: number;
  adx_trend_min: number; adx_range_max: number; er_trend_min: number;
  overext_atr: number; overext_days: number; sessions: [number, number][];
  blackout_until: string | null; be_at_r: number; trail_at_r: number; trail_lock_pct: number;
  live_enabled: boolean; live_lots: number; live_user_id: string | null;
  spike_mult: number; zone_atr: number; pressure_pct: number;
  momentum_on: boolean; momentum_er: number; momentum_atr: number;
  learn_enabled: boolean; learn_min_trades: number; last_learned_at: string | null;
  scalp_on: boolean; scalp_tp_rr: number; scalp_max_day: number; scalp_cooldown_min: number; scalp_time_stop_min: number;
  scalp_candle_confirm: boolean;
  smart_exit: boolean; tp_time_h: number; tp_time_usd: number;
  fast_on: boolean; fast_move_usd: number; fast_window_s: number; fast_sl_usd: number;
  fast_tp_rr: number; fast_stall_s: number; fast_max_day: number; fast_cooldown_s: number;
  fast_kill_after_sl: number; fast_daily_stop_usd: number; fast_pullback_usd: number;
}
interface LearnRow { id: number; learned_at: string; param: string; old_value: string | null; new_value: string | null; reason: string | null; sample_n: number | null; expectancy: number | null; }
interface MmtTrade {
  id: string; side: string; strategy: string; regime: string; entry_price: number; sl: number; tp: number;
  lots: number; status: string; exit_price: number | null; pnl_usd: number | null; r_multiple: number | null;
  reason: string | null; opened_at: string; closed_at: string | null; live?: boolean;
}
interface ScanRow { id: number; scanned_at: string; price: number | null; regime: string | null; decision: string | null; reject_reason: string | null; adx: number | null; er: number | null; rsi15: number | null; }

// Emrat zyrtarë të robotëve MMT (kërkesa e pronarit) — shfaqen kudo: pozicione, tregtime, raporte, grafik.
const robotName = (strategy: string): string =>
  strategy === 'scalp' ? 'MMT-Scalp' : strategy === 'fast' ? 'MMT-Fast' : 'MMT-Long';
const robotCls = (strategy: string): string =>
  strategy === 'scalp' ? 'bg-amber-500/20 text-amber-400'
  : strategy === 'fast' ? 'bg-purple-500/20 text-purple-300'
  : 'bg-sky-500/20 text-sky-300';

// Seksion i PALOSSHËM ("hamburger") për cilësimet — rrinë të mbyllura që të mos
// zënë vend dhe të mos preken numrat aksidentalisht; hapen vetëm me prekje të
// vetëdijshme te koka. Gjendja (ON/GJALLË) duket edhe pa e hapur.
function Fold({ title, icon, badge, tint, children }: {
  title: string; icon?: ReactNode; badge?: ReactNode; tint?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border ${tint || 'bg-gray-900 border-gray-800'}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left">
        <span className="text-white font-semibold text-sm flex items-center gap-2 flex-wrap">{icon}{title}{badge}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

const REGJIME: Record<string, string> = {
  TREND_UP: 'Trend LART', TREND_DOWN: 'Trend POSHTË', RANGE: 'Range (anësor)',
  TRANSITION: 'Tranzicion (pa tregti)', EVENT: 'Ngjarje (blackout)',
};

export default function MmtPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [cfg, setCfg] = useState<MmtConfig | null>(null);
  const [trades, setTrades] = useState<MmtTrade[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [learns, setLearns] = useState<LearnRow[]>([]);
  const [chartCandles, setChartCandles] = useState<ChartCandle[]>([]);
  const [tf, setTf] = useState<'1m' | '5m' | '15m' | '1h'>('1m');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessionsTxt, setSessionsTxt] = useState('7-10,13-17');

  const load = useCallback(async () => {
    const [{ data: c }, { data: tr }, { data: sc }, { data: ln }] = await Promise.all([
      supabase.from('mmt_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('mmt_trades').select('*').order('opened_at', { ascending: false }).limit(150),
      supabase.from('mmt_scan_log').select('*').order('scanned_at', { ascending: false }).limit(12),
      supabase.from('mmt_learning').select('*').order('learned_at', { ascending: false }).limit(10),
    ]);
    if (c) {
      setCfg(c as MmtConfig);
      const s = (c as MmtConfig).sessions;
      if (Array.isArray(s)) setSessionsTxt(s.map(([a, b]) => `${a}-${b}`).join(','));
    }
    setTrades((tr ?? []) as MmtTrade[]);
    setScans((sc ?? []) as ScanRow[]);
    setLearns((ln ?? []) as LearnRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Rifreskim i shpeshtë (7s) — pozicionet e mbyllura zhduken shpejt, pa "fantazma"
    // që dukeshin ende të hapura me çmim mbi TP para se tabela të rifreskohej.
    const id = setInterval(load, 7000);
    return () => clearInterval(id);
  }, [load]);

  // GRAFIKU (TradingView lightweight-charts) — KOHË REALE nga BROKERI (MetaApi/MT5, i njëjti
  // çmim që sheh në aplikacionin MT5). PAXG (Binance) mbetet vetëm REZERVË kur MT5 s'përgjigjet
  // (p.sh. fundjava) — se ka diferencë ~$5-6 dhe vonesë ndaj brokerit real.
  const [chartSrc, setChartSrc] = useState<'mt5' | 'paxg'>('paxg');
  const loadChart = useCallback(async () => {
    // 1) MT5 real (brokeri) — i pari.
    try {
      const r = await loadCandles('XAUUSD', tf, 240) as { error?: unknown; candles?: { time: string; open: number; high: number; low: number; close: number }[] };
      if (!r.error && Array.isArray(r.candles) && r.candles.length > 0) {
        setChartCandles(r.candles.map(c => ({ time: Math.floor(new Date(c.time).getTime() / 1000), open: c.open, high: c.high, low: c.low, close: c.close })));
        setChartSrc('mt5');
        return;
      }
    } catch { /* provo rezervën */ }
    // 2) Nëse MT5 tashmë ka dhënë qirinj më parë, MOS kalo te PAXG (shkallë tjetër çmimi → linjat zhvendosen).
    if (chartSrc === 'mt5' && chartCandles.length > 0) return;
    // 3) Rezerva: Binance PAXG (24/7).
    try {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=${tf}&limit=240`);
      if (!r.ok) return;
      const raw = (await r.json()) as unknown[][];
      setChartCandles(raw.map(k => ({ time: Math.floor(Number(k[0]) / 1000), open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) })));
      setChartSrc('paxg');
    } catch { /* rrjeti — provohet në tik-un tjetër */ }
  }, [tf, chartSrc, chartCandles.length]);
  useEffect(() => {
    loadChart();
    const id = setInterval(loadChart, 3000); // kohë reale (rifreskim çdo 3s)
    return () => clearInterval(id);
  }, [loadChart]);

  // ÇMIMI I FUNDIT (nga qiriu më i ri) + P&L LUNDRUES në kohë reale për çdo pozicion të hapur —
  // si te Tregto Live: (çmimi tani − hyrja) × drejtimi × $100/lot × lotët.
  const lastPx = chartCandles.length ? chartCandles[chartCandles.length - 1].close : null;
  // Tregtimet në LETËR mbahen me çmimin e burimit të motorit (PAXG), që është
  // ~5$ larg çmimit MT5 — P&L-ja e tyre DUHET llogaritur me çmimin e vet,
  // ndryshe shfaqet fitim/humbje fantazmë. Çmimi i motorit merret nga heartbeat-i.
  const enginePx = useMemo(() => {
    const s = scans.find(v => v.price != null);
    return s ? Number(s.price) : null;
  }, [scans]);
  const pxFor = useCallback((x: MmtTrade): number | null => (x.live ? lastPx : (enginePx ?? lastPx)), [lastPx, enginePx]);
  const floatOf = useCallback((x: MmtTrade): number | null => {
    const px = pxFor(x);
    if (px == null) return null;
    return (px - Number(x.entry_price)) * (x.side === 'BUY' ? 1 : -1) * 100 * Number(x.lots);
  }, [pxFor]);
  const openTrades = trades.filter(x => x.status === 'open');
  const floatingTotal = openTrades.reduce((a, x) => a + (floatOf(x) ?? 0), 0);

  // Linjat mbi grafik: hyrja/SL/TP e çdo trade-i MMT të HAPUR (blu/kuqe/jeshile, si te Live).
  const chartLines = useMemo<PriceLineDef[]>(() => {
    const out: PriceLineDef[] = [];
    trades.filter(x => x.status === 'open').forEach((x, i) => {
      // Vlera në $ e TP/SL për KËTË pozicion (lot × $100/lot × distanca) + pips (ari: 1 pip = $0.10).
      const lots = Number(x.lots), e = Number(x.entry_price);
      const tpUsd = Math.abs(Number(x.tp) - e) * 100 * lots;
      const slUsd = Math.abs(e - Number(x.sl)) * 100 * lots;
      const tpPips = Math.round(Math.abs(Number(x.tp) - e) * 10);
      const slPips = Math.round(Math.abs(e - Number(x.sl)) * 10);
      out.push({ price: e, color: '#3b82f6', title: `Hyrje #${i + 1} ${x.side} (${robotName(x.strategy)})` });
      out.push({ price: Number(x.sl), color: '#ef4444', title: `SL #${i + 1} −$${slUsd.toFixed(0)} (${slPips}p)` });
      out.push({ price: Number(x.tp), color: '#22c55e', title: `TP #${i + 1} +$${tpUsd.toFixed(0)} (${tpPips}p)` });
    });
    return out;
  }, [trades]);

  // SHËNJIMET mbi grafik: hyrja (shigjetë me emrin e robotit) + dalja (rreth me fitim/humbje)
  // për ÇDO tregtim MMT — edhe të mbyllurit shihen AKU ku ndodhën, jo vetëm në tabelë.
  const tfSec = tf === '1m' ? 60 : tf === '5m' ? 300 : tf === '15m' ? 900 : 3600;
  const chartMarkers = useMemo<ChartMarkerDef[]>(() => {
    const robotColor = (s: string) => (s === 'scalp' ? '#f59e0b' : s === 'fast' ? '#a855f7' : '#38bdf8');
    const bucket = (iso: string) => Math.floor(new Date(iso).getTime() / 1000 / tfSec) * tfSec;
    const out: ChartMarkerDef[] = [];
    for (const x of trades.slice(0, 40)) {
      const isBuy = x.side === 'BUY';
      out.push({
        time: bucket(x.opened_at), position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown', color: robotColor(x.strategy),
        text: robotName(x.strategy).replace('MMT-', ''),
      });
      if (x.closed_at && x.pnl_usd != null) {
        const pnl = Number(x.pnl_usd);
        out.push({
          time: bucket(x.closed_at), position: isBuy ? 'aboveBar' : 'belowBar',
          shape: 'circle', color: pnl >= 0 ? '#22c55e' : '#ef4444',
          text: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$`,
        });
      }
    }
    return out;
  }, [trades, tfSec]);

  const set = <K extends keyof MmtConfig>(k: K, v: MmtConfig[K]) => setCfg(p => (p ? { ...p, [k]: v } : p));
  const save = async (patch?: Partial<MmtConfig>) => {
    if (!cfg) return;
    setSaving(true);
    // Sesionet nga teksti "7-10,13-17" → [[7,10],[13,17]] (injoro pjesët e pavlefshme).
    const sessions = sessionsTxt.split(',').map(p => p.split('-').map(x => parseInt(x.trim(), 10)))
      .filter(a => a.length === 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]) && a[0] >= 0 && a[1] <= 24 && a[0] < a[1]) as [number, number][];
    const body = { ...cfg, ...patch, sessions: sessions.length ? sessions : cfg.sessions, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('mmt_config').update(body).eq('id', 1);
    if (!error && patch) setCfg(p => (p ? { ...p, ...patch } : p));
    setSaving(false);
  };

  if (loading || !cfg) {
    return <div className="p-6 flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />{t('Duke ngarkuar…')}</div>;
  }

  const closed = trades.filter(x => x.status !== 'open');
  const wins = closed.filter(x => Number(x.pnl_usd) > 0);
  const totalPnl = closed.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
  const totalR = closed.reduce((a, x) => a + Number(x.r_multiple ?? 0), 0);
  const lastScan = scans[0];

  const num = (label: string, key: keyof MmtConfig, step = '0.1', hint?: string) => (
    <label className="block">
      <span className="text-[11px] text-gray-400">{label}</span>
      <input type="number" step={step} value={String(cfg[key] ?? '')}
        onChange={e => set(key, Number(e.target.value) as never)} onBlur={() => save()}
        className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
    </label>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Brain className="w-6 h-6 text-amber-400" />MMT — Super Roboti</h2>
        <p className="text-gray-400 text-sm mt-1">{t('Motor krejt i veçantë (regjim + ansambël + mbrojtje prop-style). Faza HIJE: tregton vetëm në letër — asnjë para reale.')}</p>
      </div>

      {/* STATUSI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Regjimi tani')}</p>
          <p className="text-white font-bold text-sm mt-1">{lastScan?.regime ? (REGJIME[lastScan.regime] || lastScan.regime) : '—'}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">ADX {lastScan?.adx ?? '—'} · ER {lastScan?.er ?? '—'} · RSI15 {lastScan?.rsi15 ?? '—'}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Bilanci (letër)')}</p>
          <p className={`font-bold text-sm mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} $</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{totalR >= 0 ? '+' : ''}{totalR.toFixed(1)} R gjithsej</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Fitore / Humbje')}</p>
          <p className="text-white font-bold text-sm mt-1">{wins.length}W / {closed.length - wins.length}L</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{closed.length ? Math.round((wins.length / closed.length) * 100) : 0}% {t('fitore')}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Skanimi i fundit')}</p>
          <p className="text-white font-bold text-sm mt-1">{lastScan ? new Date(lastScan.scanned_at).toLocaleTimeString() : '—'}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{lastScan?.decision || '—'}{lastScan?.reject_reason ? ` · ${lastScan.reject_reason}` : ''}</p>
        </div>
      </div>

      {/* NDEZ/FIK + rifresko */}
      <div className="flex items-center gap-3">
        <button onClick={() => save({ active: !cfg.active })}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold transition ${cfg.active ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
          <Power className="w-4 h-4" />{cfg.active ? 'MMT (Hije): ON' : 'MMT (Hije): OFF'}
        </button>
        <button onClick={load} className="p-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
        {saving && <span className="text-[11px] text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t('Duke ruajtur…')}</span>}
      </div>

      {/* KILL-SWITCH BANNER — i dukshëm kur mbrojtja e ka ndalur gjuetinë; rihapje me 1 prekje. */}
      {(() => {
        const todayKey = new Date().toLocaleDateString();
        const slToday = trades.filter(x => x.status === 'sl' && x.closed_at && new Date(x.closed_at).toLocaleDateString() === todayKey).length;
        const engaged = slToday >= Number(cfg.kill_after_sl || 2);
        if (!engaged) return null;
        return (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-red-300 font-bold text-sm">🛑 {t('Kill-switch aktiv')} — {slToday} SL {t('sot')} (kufiri: {cfg.kill_after_sl})</p>
              <p className="text-[11px] text-red-200/70 mt-0.5">{t('Gjuetia u ndal vetë për të mbrojtur ditën (rregulli i Dhomës së Ekspertëve). Rifillon vetë nesër — ose rihape tani me kufi më të lartë.')}</p>
            </div>
            <button type="button" onClick={() => save({ kill_after_sl: slToday + 1 })}
              className="px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/50 text-red-200 text-sm font-bold hover:bg-red-500/30">
              {t('Rihap gjuetinë sot')} (kufiri → {slToday + 1})
            </button>
          </div>
        );
      })()}

      {/* GRAFIKU (TradingView) — qirinjtë live + hyrjet/SL/TP e MMT të vizatuara */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" />XAUUSD — {t('grafiku i MMT (hyrjet, SL, TP)')}</h3>
          <div className="flex gap-1">
            {(['1m', '5m', '15m', '1h'] as const).map(x => (
              <button key={x} onClick={() => setTf(x)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${tf === x ? 'bg-amber-500 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{x}</button>
            ))}
          </div>
        </div>
        {chartCandles.length === 0 ? (
          <div className="h-[380px] flex items-center justify-center text-gray-600 text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" />{t('Duke ngarkuar qirinjtë…')}</div>
        ) : (
          <Mt5Chart candles={chartCandles} lines={chartLines} markers={chartMarkers} height={380} fitKey={`mmt_${tf}`} maxLineExpand={1.2} />
        )}
        {/* Përmbledhja live nën grafik — si te Tregto Live */}
        <div className="flex items-center gap-3 mt-2 text-[12px]">
          <span className="text-gray-500">{t('Tani:')}</span>
          <span className={`font-bold ${floatingTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>{floatingTotal >= 0 ? '+' : ''}{floatingTotal.toFixed(2)} $</span>
          <span className="text-gray-600">· {openTrades.length} {t('pozicione hapur')}</span>
          {lastPx != null && <span className="text-gray-600 ml-auto">XAU {lastPx.toFixed(2)}</span>}
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          {chartSrc === 'mt5'
            ? t('Burimi: MT5 REAL (brokeri yt, kohë reale — i njëjti çmim si aplikacioni MT5). Linjat: blu = hyrja, e kuqe = SL, jeshile = TP.')
            : t('Burimi: Binance PAXG (rezervë — MT5 s\'u përgjigj; ka diferencë ~$5-6 nga brokeri). Linjat: blu = hyrja, e kuqe = SL, jeshile = TP.')}
        </p>
      </div>

      {/* POZICIONET E HAPURA (MMT) — raport në kohë reale për secilin: fitim/humbje tani + distanca te TP/SL */}
      {openTrades.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-green-400" />{t('Pozicionet e hapura (MMT) — live')}
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
          </h3>
          <div className="space-y-2">
            {openTrades.map(x => {
              const fl = floatOf(x);
              const isBuy = x.side === 'BUY';
              const pxX = pxFor(x);
              // Distanca me shenjë: nëse çmimi e ka KALUAR TP-në/SL-në, trego "prekur", jo distancë.
              const tpRem = pxX != null ? (isBuy ? Number(x.tp) - pxX : pxX - Number(x.tp)) : null;
              const slRem = pxX != null ? (isBuy ? pxX - Number(x.sl) : Number(x.sl) - pxX) : null;
              const toTP = tpRem != null ? Math.abs(tpRem) : null;
              const toSL = slRem != null ? Math.abs(slRem) : null;
              return (
                <div key={x.id} className={`rounded-xl px-3 py-2.5 border ${fl == null ? 'border-gray-800 bg-gray-800/40' : fl >= 0 ? 'border-green-500/25 bg-green-500/5' : 'border-red-500/25 bg-red-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">
                      {isBuy ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                      <span className="text-white font-bold">{x.side}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${robotCls(x.strategy)}`}>{robotName(x.strategy)}</span>
                      <span className="text-gray-300 text-xs">@{Number(x.entry_price).toFixed(2)} · {x.lots} lot</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${x.live ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-300'}`}>{x.live ? 'REALE' : t('Letër')}</span>
                    </span>
                    <span className={`text-sm font-bold ${fl == null ? 'text-gray-500' : fl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fl == null ? '—' : `${fl >= 0 ? '+' : ''}${fl.toFixed(2)} $`}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-1 text-[11px] text-gray-400 flex-wrap">
                    {(() => {
                      const lots2 = Number(x.lots), e2 = Number(x.entry_price);
                      const tpUsd = Math.abs(Number(x.tp) - e2) * 100 * lots2;
                      const slUsd = Math.abs(e2 - Number(x.sl)) * 100 * lots2;
                      const tpPips = Math.round(Math.abs(Number(x.tp) - e2) * 10);
                      const slPips = Math.round(Math.abs(e2 - Number(x.sl)) * 10);
                      return (<>
                        <span><span className="text-green-400">TP</span> {Number(x.tp).toFixed(2)} = <span className="text-green-400 font-semibold">+{tpUsd.toFixed(2)}$</span> <span className="text-gray-600">({tpPips} pips{toTP != null ? (tpRem! <= 0 ? ' · PREKUR' : ` · edhe ${toTP.toFixed(2)}$`) : ''})</span></span>
                        <span><span className="text-red-400">SL</span> {Number(x.sl).toFixed(2)} = <span className="text-red-400 font-semibold">−{slUsd.toFixed(2)}$</span> <span className="text-gray-600">({slPips} pips{toSL != null ? (slRem! <= 0 ? ' · PREKUR' : ` · ${toSL.toFixed(2)}$ larg`) : ''})</span></span>
                      </>);
                    })()}
                    <span className="text-gray-600 ml-auto">🕒 {new Date(x.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CILËSIMET — të VEÇANTA nga robotët e tjerë; TË PALOSURA (hamburger) që të mos
          zënë vend dhe të mos preken numrat aksidentalisht. */}
      <Fold title={t('Cilësimet MMT (vetëm ky robot)')} icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {num(t('Kapitali i letrës ($)'), 'paper_equity', '50')}
          {num(t('Rreziku për trade (%)'), 'risk_pct', '0.1', t('PTJ: max 1%'))}
          {num('R:R (trend)', 'rr', '0.5', t('MMTI mësoi 1:4'))}
          {num(t('Pozicione maks.'), 'max_open', '1')}
          {num(t('Maks. në 1 drejtim'), 'max_same_dir', '1', t('anti-stacking'))}
          {num(t('Stop ditor (%)'), 'daily_stop_pct', '0.5', t('prop-firm: 4-5%'))}
          {num(t('Kill pas N SL/ditë'), 'kill_after_sl', '1', t('Dhoma: 2'))}
          {num('ADX min (trend)', 'adx_trend_min', '1', t('industri: 25'))}
          {num('ADX max (range)', 'adx_range_max', '1')}
          {num('ER min (trend)', 'er_trend_min', '0.05')}
          {num(t('Mbi-ekstension (×ATR)'), 'overext_atr', '0.1', t('mos shit te fundi'))}
          {num(t('Dritarja e ekstremit (ditë)'), 'overext_days', '1')}
          {num('Break-even në (+R)', 'be_at_r', '0.1')}
          {num('Trailing pas (+R)', 'trail_at_r', '0.1')}
          {num('Trailing mban (%)', 'trail_lock_pct', '5')}
          {num(t('Roja e spike-ve (×mes 1m)'), 'spike_mult', '0.5', t('qiri > kaq × mesatarja → prit'))}
          {num(t('Zona e rrezikut (×ATR)'), 'zone_atr', '0.1', t('S/R + nivele $50'))}
          {num(t('Presioni kundër maks (%)'), 'pressure_pct', '5', t('rrjedha e parasë 1m'))}
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Momentum (BUY+SELL)')}</span>
            <button type="button" onClick={() => save({ momentum_on: !cfg.momentum_on })}
              className={`mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold border ${cfg.momentum_on ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {cfg.momentum_on ? 'ON' : 'OFF'}
            </button>
            <span className="text-[10px] text-gray-600">{t('kap shpërthimet e forta')}</span>
          </label>
          {num(t('Momentum: lëvizja min (×ATR)'), 'momentum_atr', '0.1', t('në 12 min'))}
          {num(t('Momentum: pastërtia (ER)'), 'momentum_er', '0.05', t('0.65 = lëvizje e pastër'))}
          {num(t('Merr fitimin pas (orë)'), 'tp_time_h', '0.5', t('0 = fikur'))}
          {num(t('…me fitim min ($)'), 'tp_time_usd', '1', t('liron vendin për trade të reja'))}
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Dalja e Mençur')}</span>
            <button type="button" onClick={() => save({ smart_exit: !(cfg.smart_exit !== false) })}
              className={`mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold border ${cfg.smart_exit !== false ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {cfg.smart_exit !== false ? 'ON' : 'OFF'}
            </button>
            <span className="text-[10px] text-gray-600">{t('merr fitimin ≥2R kur 15m kthehet fort')}</span>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Sesionet (orë UTC)')}</span>
            <input value={sessionsTxt} onChange={e => setSessionsTxt(e.target.value)} onBlur={() => save()}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="7-10,13-17" />
            {/* SINKRONIZIM AUTOMATIK me orën lokale të përdoruesit (shfletuesi e di zonën vetë). */}
            {(() => {
              const toLocal = (h: number) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
              const wins = (cfg.sessions || []) as [number, number][];
              const local = wins.map(([a, b]) => `${toLocal(a)}–${toLocal(b)}`).join(', ');
              const hU = new Date().getUTCHours();
              const inS = wins.some(([a, b]) => hU >= a && hU < b);
              const next = wins.map(([a]) => a).filter(a => a > hU).sort((a, b) => a - b)[0] ?? wins.map(([a]) => a).sort((a, b) => a - b)[0];
              return (
                <span className="text-[10px] block mt-0.5">
                  <span className="text-amber-400/90">{t('Në orën tënde:')} {local || '—'}</span>
                  {' · '}
                  {inS
                    ? <span className="text-green-400 font-semibold">{t('gjuetia HAPUR tani')}</span>
                    : <span className="text-gray-400">{t('mbyllur — rihapet në')} <span className="text-white font-semibold">{next != null ? toLocal(next) : '—'}</span></span>}
                </span>
              );
            })()}
          </label>
        </div>
        <label className="block sm:max-w-xs">
          <span className="text-[11px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{t('Blackout ngjarjesh deri më (UTC)')}</span>
          <input type="datetime-local" value={cfg.blackout_until ? cfg.blackout_until.slice(0, 16) : ''}
            onChange={e => set('blackout_until', e.target.value ? new Date(e.target.value).toISOString() : null)} onBlur={() => save()}
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          <span className="text-[10px] text-gray-600">{t('P.sh. para fjalimeve të Fed — pa hyrje të reja deri atëherë.')}</span>
        </label>
      </Fold>

      {/* MMT-SCALP (Blic) — tregtime të shkurta 1m, kontroll çdo minutë; ON/OFF nga pronari. */}
      <Fold title={t('SCALP (Blic) — tregtime të shkurta 1m')}
        icon={<Zap className={`w-4 h-4 ${cfg.scalp_on ? 'text-amber-400' : 'text-gray-500'}`} />}
        badge={cfg.scalp_on ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{t('AKTIV')}</span> : undefined}
        tint={cfg.scalp_on ? 'bg-amber-500/5 border-amber-500/40' : undefined}>
        <p className="text-[11px] text-gray-400 leading-snug">
          {t('Ndjek qirinjtë 1-minutësh ÇDO MINUTË: hyn me EMA9/21 + pullback + RSI7 (në drejtim të 15m), SL i ngushtë, TP 1.5R. Del vetë kur momenti venitet (EMA kryqëzohet mbrapsht) ose kur s\'lëviz brenda kohës (time-stop). Fitime të vogla e të shpeshta — humbje të vogla e të prera shpejt.')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
          <button type="button" onClick={() => save({ scalp_on: !cfg.scalp_on })}
            className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition ${cfg.scalp_on ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
            <Zap className="w-4 h-4" />{cfg.scalp_on ? 'SCALP: ON' : 'SCALP: OFF'}
          </button>
          {num('TP (×SL)', 'scalp_tp_rr', '0.1', t('eksp.: ≥1.5'))}
          {num(t('Maks. scalp/ditë'), 'scalp_max_day', '1')}
          {num(t('Pushim mes tyre (min)'), 'scalp_cooldown_min', '1')}
          {num('Time-stop (min)', 'scalp_time_stop_min', '1', t('dil nëse s\'lëviz'))}
        </div>
        {/* KONFIRMIMI ME FIGURË QIRIU — konfluencë e provuar në kërkim; matet gjithmonë,
            bllokon hyrjen vetëm kur ndizet. Filloi OFF: mbledhim provën A/B para se ta ndezim. */}
        <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-white font-medium">{t('Konfirmim me figurë qiriu (Engulfing / Morning-Evening Star / Pin Bar)')}</span>
            <button type="button" onClick={() => save({ scalp_candle_confirm: !cfg.scalp_candle_confirm })}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${cfg.scalp_candle_confirm ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.scalp_candle_confirm ? 'ON — kërkon figurë' : 'OFF — vetëm mat'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">
            {t('OFF (rekomanduar tani): çdo scalp etiketohet “figurë:…” ose “pa figurë” pa e ndryshuar sjelljen — mbledhim provën. Kur të dhënat te raporti tregojnë se hyrjet me figurë fitojnë më shumë, ndize ON që të kërkojë figurë para çdo hyrjeje.')}
          </p>
        </div>
      </Fold>

      {/* MMT-FAST (Rruga A) — roboti tik-pas-tiku; ON/OFF nga pronari. */}
      {(() => {
        const fastBeat = scans.find(s => s.regime === 'FAST');
        const fastAlive = fastBeat && (Date.now() - new Date(fastBeat.scanned_at).getTime()) < 12 * 60 * 1000;
        return (
          <Fold title={t('FAST (tik-pas-tiku) — roboti i sekondave')}
            icon={<Activity className={`w-4 h-4 ${cfg.fast_on ? 'text-purple-400' : 'text-gray-500'}`} />}
            badge={<>
              {cfg.fast_on && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">ON</span>}
              {fastAlive
                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">{t('WORKER GJALLË')}</span>
                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-500">{t('WORKER JO AKTIV')}</span>}
            </>}
            tint={cfg.fast_on ? 'bg-purple-500/5 border-purple-500/40' : undefined}>
            <p className="text-[11px] text-gray-400 leading-snug">
              {t('NDJEKËSI i lëvizjes: pa indikatorë (analizat i bëjnë Long/Scalp) — ndjek ÇDO TIK live (milisekonda), hyn sapo nis lëvizja (ngritje → BUY, rënie → SELL), në +$0.50 e çon mbrojtjen në 0, dhe DEL sapo çmimi kthehet nga kulmi — me fitim të kyçur ose në 0. SL i plotë vetëm si frenë fatkeqësie.')}
            </p>
            <p className="text-[11px] text-purple-300/90 leading-snug">
              {t('I PAVARUR: e ndalin vetëm çelësi FAST më poshtë dhe kufijtë e tij — sesionet, blackout-i i lajmeve dhe kill-switch-i i përbashkët i MMT NUK e prekin. Gjuan pa ndalim sa herë tregu i arit është i hapur (mbyllet vetëm fundjavën).')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
              <button type="button" onClick={() => save({ fast_on: !cfg.fast_on })}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition ${cfg.fast_on ? 'bg-purple-500/15 border-purple-500/40 text-purple-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                <Activity className="w-4 h-4" />{cfg.fast_on ? 'FAST: ON' : 'FAST: OFF'}
              </button>
              {num(t('Burst min ($/dritare)'), 'fast_move_usd', '0.1')}
              {num(t('Dritarja (sek)'), 'fast_window_s', '1')}
              {num('SL ($)', 'fast_sl_usd', '0.5')}
              {num('TP (×SL)', 'fast_tp_rr', '0.1')}
              {num(t('Ngecja: dil pas (sek)'), 'fast_stall_s', '5')}
              {num(t('Maks. fast/ditë'), 'fast_max_day', '1')}
              {num(t('Pushim pas daljes (sek)'), 'fast_cooldown_s', '10')}
              {num(t('Kill FAST pas N SL/ditë'), 'fast_kill_after_sl', '1', t('vetëm SL-të e Fast'))}
              {num(t('Stop ditor FAST ($)'), 'fast_daily_stop_usd', '1', t('vetëm humbjet e Fast'))}
              {num(t('Dil kur kthehet ($ nga kulmi)'), 'fast_pullback_usd', '0.1', t('fitimi kyçet këtu'))}
            </div>
          </Fold>
        );
      })()}

      {/* LIVE — çelësi në dorën e pronarit (default OFF). Kur ndizet, MMT ekzekuton REALISHT te MT5. */}
      <Fold title={t('LIVE — para reale')}
        icon={<Power className={`w-4 h-4 ${cfg.live_enabled ? 'text-red-400' : 'text-gray-500'}`} />}
        badge={cfg.live_enabled ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">{t('AKTIV')}</span> : undefined}
        tint={cfg.live_enabled ? 'bg-red-500/5 border-red-500/40' : undefined}>
        <p className="text-[11px] text-gray-400 leading-snug">
          {t('Kur ky çelës është ON, çdo hyrje e MMT ekzekutohet REALISHT te llogaria MT5 (me lot fiks të vogël), përveç regjistrimit në letër. Rekomandim: lëre OFF derisa hija të mbledhë 50+ trade dhe rezultatet të të bindin — pastaj nise me 0.01.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <button type="button"
            onClick={() => save({ live_enabled: !cfg.live_enabled, live_user_id: cfg.live_user_id || user?.id || null })}
            className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition ${cfg.live_enabled ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
            <Power className="w-4 h-4" />{cfg.live_enabled ? t('LIVE: ON — po tregton realisht') : t('LIVE: OFF — vetëm letër')}
          </button>
          {num(t('Lot live (fiks)'), 'live_lots', '0.01', t('fillimi i sigurt: 0.01'))}
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Llogaria MT5')}</span>
            <button type="button" onClick={() => save({ live_user_id: user?.id || null })}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-white text-left">
              {cfg.live_user_id ? (cfg.live_user_id === user?.id ? t('✓ Llogaria ime MT5') : `${cfg.live_user_id.slice(0, 8)}…`) : t('Kliko: përdor llogarinë time')}
            </button>
          </label>
        </div>
      </Fold>

      {/* TRADE-T HIJE */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-amber-400" />{t('Tregtimet në hije (letër)')}</h3>
        {trades.length === 0 ? <p className="text-gray-600 text-xs text-center py-3">{t('Ende asnjë trade — motori pret regjimin dhe sesionin e duhur.')}</p> : (
          <div className="space-y-2">
            {trades.slice(0, 12).map(x => (
              <div key={x.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  {x.side === 'BUY' ? <TrendingUp className="w-3.5 h-3.5 text-green-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  <span className="text-white font-semibold">{x.side}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${robotCls(x.strategy)}`}>{robotName(x.strategy)}</span>
                  <span className="text-gray-300">@{Number(x.entry_price).toFixed(2)}</span>
                  <span className="text-gray-500">SL {Number(x.sl).toFixed(2)} · TP {Number(x.tp).toFixed(2)} · {x.lots} lot</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${x.status === 'open' ? 'bg-blue-500/20 text-blue-300' : Number(x.pnl_usd) > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{x.status}</span>
                  {x.pnl_usd != null && <span className={Number(x.pnl_usd) >= 0 ? 'text-green-400' : 'text-red-400'}>{Number(x.pnl_usd) >= 0 ? '+' : ''}{Number(x.pnl_usd).toFixed(2)}$ ({Number(x.r_multiple).toFixed(1)}R)</span>}
                  <span className="text-gray-600">{new Date(x.opened_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RAPORTET MMT — si te Tregto Live, por vetëm me të dhënat e MMT */}
      {(() => {
        const closedAll = trades.filter(x => x.closed_at);
        const dayKey = (iso: string) => new Date(iso).toLocaleDateString();
        const todayKey = new Date().toLocaleDateString();
        const closedToday = closedAll.filter(x => dayKey(x.closed_at!) === todayKey);
        const pnlToday = closedToday.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
        const byDay = new Map<string, { n: number; w: number; pnl: number; r: number }>();
        closedAll.forEach(x => {
          const k = dayKey(x.closed_at!);
          const d = byDay.get(k) || { n: 0, w: 0, pnl: 0, r: 0 };
          d.n++; if (Number(x.pnl_usd) > 0) d.w++;
          d.pnl += Number(x.pnl_usd ?? 0); d.r += Number(x.r_multiple ?? 0);
          byDay.set(k, d);
        });
        const days = [...byDay.entries()].slice(0, 7);
        return (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-amber-400" />{t('Raportet MMT (vetëm ky robot)')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
              <div className="bg-gray-800/40 rounded-xl p-3">
                <p className="text-[11px] text-gray-500">{t('Live (hapur tani)')}</p>
                <p className={`font-bold text-sm mt-0.5 ${floatingTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>{floatingTotal >= 0 ? '+' : ''}{floatingTotal.toFixed(2)} $</p>
                <p className="text-[10px] text-gray-600">{openTrades.length} {t('pozicione')}</p>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-3">
                <p className="text-[11px] text-gray-500">{t('Fitim/Humbje sot')}</p>
                <p className={`font-bold text-sm mt-0.5 ${(pnlToday + floatingTotal) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(pnlToday + floatingTotal) >= 0 ? '+' : ''}{(pnlToday + floatingTotal).toFixed(2)} $</p>
                <p className="text-[10px] text-gray-600">{t('realizuar')} {pnlToday >= 0 ? '+' : ''}{pnlToday.toFixed(2)}$ + {t('lundrues')}</p>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-3">
                <p className="text-[11px] text-gray-500">{t('Trade sot')}</p>
                <p className="text-white font-bold text-sm mt-0.5">{closedToday.length} <span className="text-gray-500 font-normal">({closedToday.filter(x => Number(x.pnl_usd) > 0).length}W)</span></p>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-3">
                <p className="text-[11px] text-gray-500">{t('Gjithsej (letër+live)')}</p>
                <p className={`font-bold text-sm mt-0.5 ${(totalPnl + floatingTotal) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(totalPnl + floatingTotal) >= 0 ? '+' : ''}{(totalPnl + floatingTotal).toFixed(2)} $</p>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-3">
                <p className="text-[11px] text-gray-500">{t('Saktësia')}</p>
                <p className="text-white font-bold text-sm mt-0.5">{closed.length ? Math.round((wins.length / closed.length) * 100) : 0}% <span className="text-gray-500 font-normal">({totalR >= 0 ? '+' : ''}{totalR.toFixed(1)}R)</span></p>
              </div>
            </div>
            {/* RAPORTE TË PLOTA TË NDARA PËR SECILIN ROBOT (kërkesa e pronarit): kartë e
                veçantë me SAKTËSINË në %, fitimin total/sot, R dhe pozicionet — që të
                krahasohet qartë se cili robot po sjell fitimet më të mira. */}
            {(() => {
              const order: [string, string][] = [['MMT-Long', 'trend'], ['MMT-Scalp', 'scalp'], ['MMT-Fast', 'fast']];
              const stratOf = (s: string) => (s === 'scalp' ? 'scalp' : s === 'fast' ? 'fast' : 'trend');
              return (
                <div className="mb-3">
                  <p className="text-[11px] text-gray-500 mb-1.5">{t('Raporti sipas robotit — krahaso kush po fiton më mirë')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {order.map(([name, strat]) => {
                      const mine = trades.filter(x => stratOf(x.strategy) === strat);
                      const cl = mine.filter(x => x.closed_at);
                      const w = cl.filter(x => Number(x.pnl_usd) > 0).length;
                      const wr = cl.length ? Math.round((w / cl.length) * 100) : 0;
                      const pnl = cl.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
                      const r = cl.reduce((a, x) => a + Number(x.r_multiple ?? 0), 0);
                      const tod = cl.filter(x => dayKey(x.closed_at!) === todayKey);
                      const todPnl = tod.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
                      const opens = mine.filter(x => x.status === 'open');
                      const flo = opens.reduce((a, x) => a + (floatOf(x) ?? 0), 0);
                      const avg = cl.length ? pnl / cl.length : 0;
                      return (
                        <div key={name} className="bg-gray-800/40 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${robotCls(strat)}`}>{name}</span>
                            <span className={`text-lg font-bold ${wr >= 50 ? 'text-green-400' : cl.length === 0 ? 'text-gray-500' : 'text-amber-400'}`}>
                              {cl.length ? `${wr}%` : '—'}
                            </span>
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between"><span className="text-gray-500">{t('Saktësia')}</span><span className="text-gray-300">{w}W / {cl.length - w}L ({cl.length} {t('mbyllur')})</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">{t('Fitimi total')}</span><span className={`font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$ ({r >= 0 ? '+' : ''}{r.toFixed(1)}R)</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">{t('Mesatarja/trade')}</span><span className={avg >= 0 ? 'text-green-400' : 'text-red-400'}>{avg >= 0 ? '+' : ''}{avg.toFixed(2)}$</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">{t('Sot')}</span><span className={`${todPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{tod.length ? `${todPnl >= 0 ? '+' : ''}${todPnl.toFixed(2)}$ (${tod.length})` : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">{t('Hapur tani')}</span><span className="text-gray-300">{opens.length ? `${opens.length} · ${flo >= 0 ? '+' : ''}${flo.toFixed(2)}$ ${t('lundrues')}` : '—'}</span></div>
                            {/* PROVA A/B për Scalp: fitorja e hyrjeve ME figurë vs PA figurë (nga eksperimenti). */}
                            {strat === 'scalp' && (() => {
                              const withP = cl.filter(x => (x.reason ?? '').includes('figurë:'));
                              const noP = cl.filter(x => (x.reason ?? '').includes('pa figurë'));
                              const wr2 = (arr: MmtTrade[]) => arr.length ? Math.round(arr.filter(y => Number(y.pnl_usd) > 0).length / arr.length * 100) : null;
                              const wP = wr2(withP), wN = wr2(noP);
                              return (
                                <div className="mt-1.5 pt-1.5 border-t border-gray-700/50 space-y-0.5">
                                  <div className="flex justify-between"><span className="text-emerald-400/80">{t('Me figurë')}</span><span className="text-gray-300">{wP != null ? `${wP}% (${withP.length})` : t('ende s\'ka')}</span></div>
                                  <div className="flex justify-between"><span className="text-gray-500">{t('Pa figurë')}</span><span className="text-gray-300">{wN != null ? `${wN}% (${noP.length})` : t('ende s\'ka')}</span></div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {days.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-gray-500 mb-1">{t('Raporti ditor (7 ditët e fundit)')}</p>
                {days.map(([d, v]) => (
                  <div key={d} className="flex items-center justify-between text-[11px] border-b border-gray-800/60 pb-1">
                    <span className="text-gray-400">{d}</span>
                    <span className="text-gray-400">{v.n} trade · {v.w}W/{v.n - v.w}L</span>
                    <span className={v.pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{v.pnl >= 0 ? '+' : ''}{v.pnl.toFixed(2)}$ ({v.r >= 0 ? '+' : ''}{v.r.toFixed(1)}R)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* MËSIMI NGA VETVETJA (L5) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-amber-400" />{t('Mësimi nga vetvetja')}</h3>
          <button type="button" onClick={() => save({ learn_enabled: !cfg.learn_enabled })}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.learn_enabled !== false ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
            {cfg.learn_enabled !== false ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 leading-snug mb-3">
          {t('Çdo 24 orë MMT analizon rezultatet e veta (14 ditët e fundit) dhe përshtat parametrat: strategjitë humbëse bëhen më selektive ose fiken, oraret humbëse hiqen, fituesit lehtësohen pak. Rreziku KURRË nuk rritet vetë. Çdo ndryshim shfaqet këtu.')}
        </p>
        {learns.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-2">{t('Ende asnjë mësim — duhen të paktën')} {cfg.learn_min_trades} {t('trade të mbyllura që analiza të jetë e besueshme.')}</p>
        ) : (
          <div className="space-y-1.5">
            {learns.map(l => (
              <div key={l.id} className="text-[11px] text-gray-400 border-b border-gray-800/60 pb-1.5">
                <span className="text-gray-500">{new Date(l.learned_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {' · '}<span className="text-amber-400 font-semibold">{l.param}</span>: {l.old_value} → <span className="text-white">{l.new_value}</span>
                {' — '}{l.reason} <span className="text-gray-600">({l.sample_n} trade, {Number(l.expectancy).toFixed(2)}R mes.)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LOGU I SKANIMEVE */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">{t('Historiku i skanimeve MMT — regjimi & vendimi')}</h3>
        <div className="space-y-1.5">
          {scans.map(s => (
            <div key={s.id} className="flex items-center justify-between text-[11px] text-gray-400 border-b border-gray-800/60 pb-1.5">
              <span>{new Date(s.scanned_at).toLocaleTimeString()} · <span className="text-gray-300">{s.regime ? (REGJIME[s.regime] || s.regime) : '—'}</span></span>
              <span className={s.decision?.startsWith('open') ? 'text-green-400 font-semibold' : ''}>{s.decision}{s.reject_reason ? ` — ${s.reject_reason}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
