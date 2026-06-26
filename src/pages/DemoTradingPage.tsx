import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Wallet, Activity, FlaskConical, Power, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import Mt5Chart, { type ChartCandle, type PriceLineDef } from '../components/Mt5Chart';
import { fetchBinanceCandles, type Timeframe } from '../ai-trader/market/candles';
import { loadCandles as loadMt5Candles, loadSymbolPrice, loadTradeHistory, type HistoryDeal } from '../services/metaapi';
import CompletedSignals, { type DoneSignal } from '../components/CompletedSignals';
import { useI18n } from '../i18n/i18n';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

type Signal = {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  source: string; created_at: string; timeframe?: string | null;
};

// Të njëjtët ndihmës si terminali Live — afati nga periudha e sinjalit, freskia 30 min.
const SHORT_TFS = ['1m', '5m', '15m'];
const isShortHorizon = (tf?: string | null) => !!tf && SHORT_TFS.includes(tf);
const signalIsFresh = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity) <= 30;
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Faqja Demo — pasqyron terminalin live, por tregton VIRTUALISHT (demo_trades + demo_balance),
// me çmimet reale të arit. E pavarur nga MetaApi: punon edhe kur MetaApi është poshtë.
// Konfigurimet (preset/rrezik) janë të njëjta si live (te "Lidhja & Konfigurimi").

type DemoTrade = {
  id: string; symbol: string; side: string; volume: number; signal_id: string | null; source: string | null;
  entry_price: number; sl: number | null; tp: number | null;
  status: string; exit_price: number | null; exit_reason: string | null;
  profit: number | null; opened_at: string; closed_at: string | null;
};

// Burimi i një demo-trade: manual (user) ose auto (robot: scalp/sinjal).
const srcOf = (t: DemoTrade) => t.source || (t.signal_id != null ? 'signal' : 'scalp');
const isAuto = (t: DemoTrade) => srcOf(t) !== 'manual';
// Afati & etiketa e burimit (si te live).
const tradeKind = (t: DemoTrade) => {
  const s = srcOf(t);
  if (s === 'manual') return { horizon: 'short' as const, src: 'Manual', cls: 'bg-emerald-500/20 text-emerald-400' };
  if (s === 'signal') return { horizon: 'long' as const, src: 'Sinjal', cls: 'bg-blue-500/20 text-blue-400' };
  return { horizon: 'short' as const, src: 'Scalp', cls: 'bg-amber-500/20 text-amber-400' };
};

const normSym = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function valuePerPrice(symbol: string): number {
  const s = normSym(symbol);
  if (s.includes('XAU') || s.includes('GOLD')) return 100;
  if (s.includes('OIL') || s.includes('WTI') || s.includes('BRENT')) return 1000;
  return 100000;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DemoTradingPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [balance, setBalance] = useState<number>(100);
  const [startBalance, setStartBalance] = useState<number>(100);
  const [enabled, setEnabled] = useState<boolean>(false); // robot auto-demo (opt-in, OFF si default)
  const [liveOn, setLiveOn] = useState<boolean>(false);   // tregto LIVE me llogarinë reale (metaapi_config.auto_trade)
  const [scalpOn, setScalpOn] = useState<boolean>(false); // tregtime të SHKURTA (scalp); default OFF
  // Lidhja live e robotit të sinjaleve — për të gjithë përdoruesit (platform-wide).
  const canLive = !!user;
  const [liveDeals, setLiveDeals] = useState<HistoryDeal[]>([]);  // trade-t e mbyllura LIVE (nga MetaApi)
  const [trades, setTrades] = useState<DemoTrade[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [livePx, setLivePx] = useState<number | null>(null); // çmimi real-time i arit (Binance, ~2s)
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [tf, setTf] = useState<Timeframe>('5m');
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [doneSignals, setDoneSignals] = useState<DoneSignal[]>([]);
  // Forma manuale BLEJ/SHIT (si te Live): klik sinjalin → mbushen vlerat → klik BLEJ/SHIT.
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [lot, setLot] = useState('0.01');
  const [formSl, setFormSl] = useState('');
  const [formTp, setFormTp] = useState('');
  const [formSym, setFormSym] = useState('XAUUSD');
  const [appliedSignalId, setAppliedSignalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [srcFilter, setSrcFilter] = useState<'all' | 'auto' | 'manual'>('all'); // filtri i raporteve
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const [{ data: prof }, { data: tr }, { data: assets }, { data: sig }, { data: done }] = await Promise.all([
      supabase.from('profiles').select('demo_balance, demo_start_balance, demo_auto').eq('id', user.id).maybeSingle(),
      supabase.from('demo_trades').select('*').eq('user_id', user.id).order('opened_at', { ascending: false }).limit(200),
      supabase.from('assets').select('symbol, current_price'),
      // Të NJËJTAT sinjale të motorit si te terminali Live (roboti demo tregton mbi këto).
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, source, created_at, timeframe')
        .eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${nowIso}`).gte('created_at', since24)
        .order('confidence', { ascending: false }).limit(8),
      supabase.from('signals').select('id, type, symbol, confidence, entry_price, target_price, stop_loss, outcome, result_pct, closed_at, created_at')
        .in('status', ['hit_tp', 'hit_sl', 'expired']).gte('closed_at', since24).order('closed_at', { ascending: false }).limit(12),
    ]);
    if (prof) {
      setBalance(Number(prof.demo_balance ?? 100));
      setStartBalance(Number(prof.demo_start_balance ?? 100));
      setEnabled(!!prof.demo_auto);
    }
    if (canLive) {
      const { data: mc } = await supabase.from('metaapi_config').select('auto_trade, strategy_scalp').eq('user_id', user.id).maybeSingle();
      setLiveOn(!!mc?.auto_trade);
      setScalpOn(!!mc?.strategy_scalp);
      // Historiku LIVE (deals e mbyllura me profit real) nga MetaApi — best-effort, mos e rrëzo faqen.
      try {
        const hist = await loadTradeHistory(7) as { deals?: HistoryDeal[] };
        const outs = (hist?.deals ?? []).filter((d) => (d.entryType || '').includes('OUT') || d.profit != null);
        setLiveDeals(outs);
      } catch { /* lidhja live mund të jetë jashtë; demoja punon pa të */ }
    }
    if (tr) setTrades(tr as DemoTrade[]);
    if (sig) setSignals(sig as Signal[]);
    if (done) setDoneSignals(done as DoneSignal[]);
    if (assets) {
      const m: Record<string, number> = {};
      for (const a of assets as { symbol: string; current_price: number | null }[]) {
        if (a.current_price != null) m[normSym(a.symbol)] = Number(a.current_price);
      }
      setPrices(m);
    }
    setLoading(false);
    setNow(Date.now());
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  // Grafiku i arit — çmimi REAL i brokerit (MetaApi, i njëjti si te MT5/Live). Fallback te PAXG nëse MT5 s'është gati.
  const loadCandles = useCallback(async () => {
    try {
      const r = await loadMt5Candles('XAUUSD', tf, 200) as { error?: string; candles?: Array<{ time: string; open: number; high: number; low: number; close: number }> };
      if (!r.error && Array.isArray(r.candles) && r.candles.length > 0) {
        setCandles(r.candles.map((c) => ({
          time: Math.floor(new Date(c.time).getTime() / 1000), open: +c.open, high: +c.high, low: +c.low, close: +c.close,
        })));
        return;
      }
    } catch { /* fallback PAXG */ }
    try {
      const raw = await fetchBinanceCandles('PAXGUSDT', tf, 200);
      setCandles(raw.map((c) => ({ time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close })));
    } catch { /* mban të fundit */ }
  }, [tf]);
  useEffect(() => { loadCandles(); }, [loadCandles]);
  useEffect(() => {
    const t = setInterval(loadCandles, 15000);
    return () => clearInterval(t);
  }, [loadCandles]);

  // Çmimi real-time i arit — REAL nga brokeri (MetaApi, si te MT5), me fallback te Binance PAXG.
  // Që grafiku, P&L-ja dhe mbyllja të jenë në TË NJËJTËN shkallë reale si MT5 (jo PAXG → pa mospërputhje 4015 vs 4007).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await loadSymbolPrice('XAUUSD') as { error?: string; price?: { bid?: number; ask?: number } };
        const bid = Number(r?.price?.bid), ask = Number(r?.price?.ask);
        if (alive && !r?.error && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) { setLivePx((bid + ask) / 2); return; }
      } catch { /* fallback PAXG */ }
      try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT', { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const j = await r.json();
        const p = Number(j.price);
        if (alive && p > 0) setLivePx(p);
      } catch { /* mban të fundit */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Çmimi i përdorur për një simbol: ar → çmimi real-time i Binance; përndryshe → assets.
  const priceFor = useCallback((symbol: string): number | null => {
    const g = normSym(symbol);
    if ((g.includes('XAU') || g.includes('GOLD')) && livePx != null) return livePx;
    return prices[g] ?? null;
  }, [livePx, prices]);

  const open = useMemo(() => trades.filter((t) => t.status === 'open'), [trades]);
  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);
  // Filtri Auto/Manual për tabelat (raportet).
  const matchSrc = useCallback((t: DemoTrade) => srcFilter === 'all' || (srcFilter === 'auto' ? isAuto(t) : !isAuto(t)), [srcFilter]);
  const fOpen = useMemo(() => open.filter(matchSrc), [open, matchSrc]);
  const fClosed = useMemo(() => closed.filter(matchSrc), [closed, matchSrc]);

  const unrealizedOf = useCallback((t: DemoTrade): number => {
    const px = priceFor(t.symbol);
    if (px == null) return 0;
    const dir = (t.side || '').toLowerCase() === 'buy' ? 1 : -1;
    return (px - Number(t.entry_price)) * dir * Number(t.volume) * valuePerPrice(t.symbol);
  }, [priceFor]);

  const floating = useMemo(() => open.reduce((s, t) => s + unrealizedOf(t), 0), [open, unrealizedOf]);
  const equity = balance + floating;
  const curPrice = priceFor(formSym);

  // Klik mbi një sinjal → mbush formën (anë, SL, TP) dhe rrëshqit te forma (si te Live).
  const applySignal = (s: Signal) => {
    setSide(s.type === 'sell' ? 'sell' : 'buy');
    setFormSym(s.symbol || 'XAUUSD');
    setFormSl(s.stop_loss != null ? String(s.stop_loss) : '');
    setFormTp(s.target_price != null ? String(s.target_price) : '');
    setAppliedSignalId(s.id);
    setMsg({ type: 'success', text: `Sinjali u aplikua — kliko ${s.type === 'sell' ? 'SHIT' : 'BLEJ'} për ta hapur virtualisht.` });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Hap trade virtual me çmimin real aktual + SL/TP nga forma.
  const execute = async () => {
    const vol = parseFloat(lot);
    if (!(vol >= 0.01)) { setMsg({ type: 'error', text: 'Vendos një lot të vlefshëm (p.sh. 0.01).' }); return; }
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke('demo-trade-action', {
      body: { action: 'open', side, volume: vol, sl: formSl, tp: formTp, symbol: formSym, signal_id: appliedSignalId },
    });
    if (error || (data as { error?: string })?.error) {
      setMsg({ type: 'error', text: `Hapja dështoi: ${(data as { error?: string })?.error || error?.message || ''}` });
    } else {
      setMsg({ type: 'success', text: `U hap ${side === 'buy' ? t('BLEJ') : t('SHIT')} ${formSym} @ ${fmt(Number((data as { entry?: number }).entry ?? 0))}` });
      setAppliedSignalId(null);
      await load();
    }
    setBusy(false);
  };

  // Mbyll manualisht një pozicion demo (llogarit P&L në € dhe përditëson balancën).
  const closeTrade = async (id: string) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('demo-trade-action', { body: { action: 'close', id } });
    if (error || (data as { error?: string })?.error) {
      setMsg({ type: 'error', text: `Mbyllja dështoi: ${(data as { error?: string })?.error || error?.message || ''}` });
    } else {
      const p = Number((data as { profit?: number }).profit ?? 0);
      setMsg({ type: p >= 0 ? 'success' : 'error', text: `Pozicioni u mbyll · ${p >= 0 ? '+' : ''}€${fmt(p)}` });
      await load();
    }
    setBusy(false);
  };

  // Linjat Entry/SL/TP të pozicioneve demo të arit + vija "Tani" te çmimi real-time (si te Live).
  const chartLines = useMemo<PriceLineDef[]>(() => {
    const lines: PriceLineDef[] = [];
    const gold = open.filter((row) => normSym(row.symbol).includes('XAU') || normSym(row.symbol).includes('GOLD'));
    if (livePx != null) {
      const goldPnl = gold.reduce((s, row) => s + unrealizedOf(row), 0);
      lines.push({ price: livePx, color: '#fbbf24', title: gold.length ? `${t('Tani')} · ${goldPnl >= 0 ? '+' : ''}€${fmt(goldPnl)}` : t('Tani') });
    }
    const multi = gold.length > 1;
    gold.slice(0, 4).forEach((row, i) => {
      const buy = (row.side || '').toLowerCase() === 'buy';
      const entry = Number(row.entry_price);
      const vpp = valuePerPrice(row.symbol), vol = Number(row.volume);
      const pnl = unrealizedOf(row);
      const term = tradeKind(row).horizon === 'long' ? t('Afatgjatë') : t('Afatshkurtër');
      const tag = multi ? ` #${i + 1}` : '';
      // HYRJA: drejtimi + afati + P&L tani (si te terminali Live)
      lines.push({ price: entry, color: buy ? '#3b82f6' : '#f59e0b',
        title: `${t('Hyrje')}${tag} ${buy ? t('BLEJ') : t('SHIT')} · ${term} · ${pnl >= 0 ? '+' : ''}€${fmt(pnl)}` });
      // SL: rreziku në € (sa humb nëse preket)
      if (row.sl != null) {
        const risk = Math.abs(entry - Number(row.sl)) * vol * vpp;
        lines.push({ price: Number(row.sl), color: '#ef4444', title: `SL${tag} · -€${fmt(risk)}` });
      }
      // TP: shpërblimi në € (sa fiton nëse preket)
      if (row.tp != null) {
        const reward = Math.abs(Number(row.tp) - entry) * vol * vpp;
        lines.push({ price: Number(row.tp), color: '#22c55e', title: `TP${tag} · +€${fmt(reward)}` });
      }
    });
    return lines;
  }, [open, livePx, unrealizedOf]);

  const realizedPnl = useMemo(() => fClosed.reduce((s, t) => s + (Number(t.profit) || 0), 0), [fClosed]);
  const wins = fClosed.filter((t) => (Number(t.profit) || 0) > 0).length;
  const winRate = fClosed.length ? Math.round((wins / fClosed.length) * 100) : 0;

  async function toggleEnabled() {
    if (!user) return;
    const next = !enabled;
    setEnabled(next);
    await supabase.from('profiles').update({ demo_auto: next }).eq('id', user.id);
  }

  // Ndez/fik tregtimin LIVE me llogarinë reale. Kur NDIZET: fik automatikisht TË GJITHË robotët e
  // tjerë (scalp + FastT) — tregton VETËM roboti i sinjaleve (swing).
  async function toggleLive() {
    if (!user || !canLive) return;
    const next = !liveOn;
    if (next && !window.confirm(t('Ndez tregtimin LIVE me llogarinë reale? Roboti i sinjaleve do hapë trade me PARA TË VËRTETA. Të gjithë robotët e tjerë do fiken.'))) return;
    setLiveOn(next);
    if (next) setScalpOn(false); // tregtimet e shkurta nisin OFF
    const patch = next
      ? { auto_trade: true, strategy_swing: true, strategy_scalp: false, scalp_live_enabled: false, kill_switch: false }
      : { auto_trade: false };
    const { error } = await supabase.from('metaapi_config').update(patch).eq('user_id', user.id);
    if (error) { setLiveOn(!next); setMsg({ type: 'error', text: t('Nuk u ruajt — provo sërish.') }); return; }
    setMsg({ type: 'success', text: next ? t('LIVE u ndez — vetëm roboti i sinjaleve tregton me llogarinë reale (të tjerët u fikën).') : t('LIVE u fik — kthehet vetëm demo.') });
  }

  // Ndez/fik tregtimet e SHKURTA (scalp). Default OFF. Tregtimet e gjata (sinjale) janë gjithmonë ON.
  async function toggleScalp() {
    if (!user || !canLive) return;
    const next = !scalpOn;
    setScalpOn(next);
    const { error } = await supabase.from('metaapi_config').update({ strategy_scalp: next }).eq('user_id', user.id);
    if (error) { setScalpOn(!next); setMsg({ type: 'error', text: t('Nuk u ruajt — provo sërish.') }); return; }
    setMsg({ type: 'success', text: next ? t('Tregtimet e shkurta (scalp) u ndezën.') : t('Tregtimet e shkurta u fikën — vetëm tregtime të gjata (sinjale).') });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              {t('Tregto Demo')}
              <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded">{t('Virtual')}</span>
            </h1>
            <p className="text-xs text-gray-400">{t('Hapësira jote personale — tregto manualisht me çmime reale të arit. Ndez "Robot AUTO" nëse do që roboti të tregtojë vetë te demoja jote. Pa para reale.')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleEnabled}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${enabled ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
            <Power className="w-3.5 h-3.5" /> {enabled ? t('Robot AUTO') : t('Vetëm manual')}
          </button>
          {canLive && (
            <button onClick={toggleLive} title={t('I njëjti robot sinjalesh tregton me llogarinë reale; ndez = fik robotët e tjerë')}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${liveOn ? 'bg-red-500/20 border-red-500/50 text-red-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              <Power className="w-3.5 h-3.5" /> {liveOn ? t('LIVE: Llogaria REALE ON') : t('Signal → Live (OFF)')}
            </button>
          )}
          {canLive && liveOn && (
            <button onClick={toggleScalp} title={t('Tregtimet e gjata (sinjale) janë gjithmonë ON. Ky ndez/fik tregtimet e SHKURTA (scalp). Default OFF.')}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${scalpOn ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {scalpOn ? t('Tregtime të shkurta: ON') : t('Tregtime të shkurta: OFF')}
            </button>
          )}
          <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('Balanca demo')} value={`€${fmt(balance)}`} icon={<Wallet className="w-4 h-4 text-amber-400" />} />
        <Card label={t('Equity')} value={`€${fmt(equity)}`} icon={<Activity className="w-4 h-4 text-blue-400" />} />
        <Card label={t('Fitim/Humbje (hapur)')} value={`${floating >= 0 ? '+' : ''}€${fmt(floating)}`}
          tone={floating >= 0 ? 'pos' : 'neg'} icon={floating >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />} />
        <Card label={t('Pozicione të hapura')} value={`${open.length}`} sub={`${t('nga starti')} €${fmt(startBalance)}`} icon={<Activity className="w-4 h-4 text-violet-400" />} />
      </div>

      {/* Performance strip */}
      <div className="grid grid-cols-3 gap-3">
        <Mini label={t('P&L i realizuar')} value={`${realizedPnl >= 0 ? '+' : ''}€${fmt(realizedPnl)}`} tone={realizedPnl >= 0 ? 'pos' : 'neg'} />
        <Mini label={t('Trade të mbyllura')} value={`${fClosed.length}`} />
        <Mini label={t('Win rate')} value={`${winRate}%`} tone={winRate >= 50 ? 'pos' : undefined} />
      </div>

      {/* Chart — gold (same real price feed as Live), with demo position lines */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-amber-500/15 text-amber-400 px-2 py-1 rounded">XAUUSD</span>
            <span className="text-[11px] text-gray-500">{t('Ar · çmim real (demo)')}</span>
          </div>
          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((x) => (
              <button key={x} onClick={() => setTf(x)}
                className={`text-[11px] px-2 py-1 rounded transition ${tf === x ? 'bg-amber-500 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{x}</button>
            ))}
          </div>
        </div>
        {candles.length === 0
          ? <div className="h-[320px] flex items-center justify-center text-xs text-gray-500">{t('Po ngarkohet grafiku…')}</div>
          : <Mt5Chart candles={candles} lines={chartLines} height={320} fitKey={`XAUUSD-${tf}`} />}
      </div>

      {/* Manual order form (demo) — like Live: click a signal to fill, then BLEJ/SHIT */}
      <div ref={formRef} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">{t('Porosi e re —')} {formSym} <span className="text-violet-400 text-[11px]">(demo)</span></h3>
          {curPrice != null && <span className="text-[11px] text-gray-400">{t('Çmimi tani:')} <span className="text-white">{fmt(curPrice)}</span></span>}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button onClick={() => setSide('buy')} className={`flex-1 py-2 text-sm font-semibold transition ${side === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>BLEJ</button>
          <button onClick={() => setSide('sell')} className={`flex-1 py-2 text-sm font-semibold transition ${side === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>SHIT</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs shrink-0 w-8">{t('Lot')}</label>
          <input type="number" value={lot} onChange={(e) => setLot(e.target.value)} min="0.01" step="0.01"
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {['0.01', '0.05', '0.10', '0.25'].map((v) => (
            <button key={v} onClick={() => setLot(v)} className={`text-[11px] py-1.5 rounded-lg transition ${lot === v ? 'bg-amber-500 text-gray-950 font-medium' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}>{v}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-red-400 mb-1">Stop Loss</label>
            <input type="number" step="0.01" value={formSl} onChange={(e) => setFormSl(e.target.value)} placeholder={t('opsionale')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-red-500" />
          </div>
          <div>
            <label className="block text-[10px] text-green-400 mb-1">Take Profit</label>
            <input type="number" step="0.01" value={formTp} onChange={(e) => setFormTp(e.target.value)} placeholder={t('opsionale')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-green-500" />
          </div>
        </div>
        {msg && <div className={`text-[11px] rounded-lg px-2 py-1.5 ${msg.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{msg.text}</div>}
        <button onClick={execute} disabled={busy}
          className={`w-full py-2.5 rounded-lg text-sm font-bold text-white transition disabled:opacity-50 ${side === 'buy' ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400'}`}>
          {busy ? t('Po hapet…') : side === 'buy' ? t('BLEJ (demo)') : t('SHIT (demo)')}
        </button>
        <p className="text-[10px] text-gray-600">{t('Hapet virtualisht me çmimin real aktual. Roboti e mbyll te SL/TP, ose mbylle vetë te tabela poshtë.')}</p>
      </div>

      {/* Filtri i raporteve: Të gjitha / Auto / Manual */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">{t('Filtro raportet:')}</span>
        {([['all', 'Të gjitha'], ['auto', 'Auto (robot)'], ['manual', 'Manual']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setSrcFilter(v)}
            className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${srcFilter === v ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>{t(l)}</button>
        ))}
      </div>

      {/* Open positions */}
      <Section title={`${t('Pozicione të hapura')} (${fOpen.length})`}>
        {loading ? <Empty text={t('Po ngarkohet…')} /> : fOpen.length === 0 ? (
          <Empty text={srcFilter === 'manual' ? t('Asnjë pozicion manual i hapur. Hap një trade nga forma poshtë.') : srcFilter === 'auto' ? t("Asnjë pozicion auto i hapur. Ndez 'Robot AUTO'.") : t("Asnjë pozicion i hapur. Hap një trade nga forma poshtë, ose ndez 'Robot AUTO'.")} />
        ) : (
          <Table head={[t('Lloji'), t('Simboli'), t('Afati'), t('Burimi'), t('Lot'), t('Hyrja'), 'SL', 'TP', t('P&L tani'), '']}>
            {fOpen.map((row) => {
              const pnl = unrealizedOf(row);
              const buy = (row.side || '').toLowerCase() === 'buy';
              const k = tradeKind(row);
              return (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td><span className={`inline-flex items-center gap-1 font-medium ${buy ? 'text-emerald-400' : 'text-rose-400'}`}>{buy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{buy ? t('BLEJ') : t('SHIT')}</span></Td>
                  <Td>{row.symbol}</Td>
                  <Td><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.cls}`}>{k.horizon === 'short' ? t('Shkurt') : t('Gjatë')}</span></Td>
                  <Td><span className="text-[10px] text-gray-400">{k.src}</span></Td>
                  <Td>{fmt(Number(row.volume), 2)}</Td>
                  <Td>{fmt(Number(row.entry_price))}</Td>
                  <Td>{row.sl != null ? fmt(Number(row.sl)) : '—'}</Td>
                  <Td>{row.tp != null ? fmt(Number(row.tp)) : '—'}</Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                  <Td><button onClick={() => closeTrade(row.id)} disabled={busy} className="text-[11px] px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition disabled:opacity-40">{t('Mbyll')}</button></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {/* History */}
      <Section title={`${t('Historiku')} (${fClosed.length})`}>
        {fClosed.length === 0 ? <Empty text={srcFilter === 'all' ? t("Ende s'ka trade të mbyllura.") : t('Asnjë trade {kind} i mbyllur.', { kind: srcFilter === 'manual' ? 'manual' : 'auto' })} /> : (
          <Table head={[t('Lloji'), t('Simboli'), t('Afati'), t('Burimi'), t('Lot'), t('Hyrja'), t('Dalja'), t('Arsyeja'), 'P&L', t('Mbyllur')]}>
            {fClosed.slice(0, 50).map((row) => {
              const buy = (row.side || '').toLowerCase() === 'buy';
              const pnl = Number(row.profit) || 0;
              const k = tradeKind(row);
              return (
                <tr key={row.id} className="border-t border-gray-800">
                  <Td><span className={buy ? 'text-emerald-400' : 'text-rose-400'}>{buy ? t('BLEJ') : t('SHIT')}</span></Td>
                  <Td>{row.symbol}</Td>
                  <Td><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.cls}`}>{k.horizon === 'short' ? t('Shkurt') : t('Gjatë')}</span></Td>
                  <Td><span className="text-[10px] text-gray-400">{k.src}</span></Td>
                  <Td>{fmt(Number(row.volume), 2)}</Td>
                  <Td>{fmt(Number(row.entry_price))}</Td>
                  <Td>{row.exit_price != null ? fmt(Number(row.exit_price)) : '—'}</Td>
                  <Td><span className={`text-[11px] uppercase ${row.exit_reason === 'tp' ? 'text-emerald-400' : row.exit_reason === 'sl' ? 'text-rose-400' : 'text-gray-400'}`}>{row.exit_reason || '—'}</span></Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                  <Td><span className="text-gray-500">{row.closed_at ? new Date(row.closed_at).toLocaleString() : '—'}</span></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {/* Sinjalet aktive — TË NJËJTAT që përdor roboti (njësoj si terminali Live) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-400" />{t('Sinjalet aktive')}</h3>
        {signals.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë sinjal aktiv tani.')}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {signals.map((s) => {
              const fresh = signalIsFresh(s.created_at);
              const short = isShortHorizon(s.timeframe);
              return (
                <button key={s.id} onClick={() => applySignal(s)}
                  className={`text-left w-full rounded-xl px-3 py-2 border transition ${appliedSignalId === s.id ? 'bg-amber-500/10 border-amber-500/40' : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800'} ${fresh ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2">
                      <span className="text-white text-sm font-bold">{s.symbol}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${short ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{short ? t('Afat-shkurt') : t('Afat-gjatë')}</span>
                    </span>
                    <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                    {s.entry_price != null && <span>{t('Hyrje:')} <span className="text-white">{Number(s.entry_price).toLocaleString()}</span></span>}
                    {s.target_price != null && <span>{t('Objektiv:')} <span className="text-green-400">{Number(s.target_price).toLocaleString()}</span></span>}
                    {s.stop_loss != null && <span>{t('Stop:')} <span className="text-red-400">{Number(s.stop_loss).toLocaleString()}</span></span>}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1 flex items-center justify-between">
                    <span>🕒 {fmtTime(s.created_at)}</span>
                    <span className="text-amber-400">{t('Kliko për të tregtuar →')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sinjalet e përfunduara (i njëjti komponent si Live) */}
      <CompletedSignals signals={doneSignals} variant="compact" />

      {/* RAPORTI LIVE — vetëm për llogarinë e lejuar; trade-t reale të mbyllura nga MetaApi */}
      {canLive && (
        <Section title={t('Raporti LIVE — llogaria reale (7 ditët e fundit)')}>
          {liveDeals.length === 0 ? (
            <Empty text={t('Asnjë trade live i mbyllur ende (ose lidhja MetaApi është jashtë).')} />
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-800">
                {t('Profit total i realizuar:')}{' '}
                {(() => {
                  const lr = liveDeals.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0);
                  return <span className={lr >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>{lr >= 0 ? '+' : ''}{lr.toFixed(2)} €</span>;
                })()}{' '}· {liveDeals.length} {t('trade')}
              </div>
              <Table head={[t('Koha'), t('Simboli'), t('Krahu'), t('Vëllimi'), t('Çmim'), t('Profit (€)')]}>
                {liveDeals.map((d) => {
                  const sell = (d.type || '').includes('SELL');
                  const p = (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0);
                  return (
                    <tr key={d.id} className="border-t border-gray-800">
                      <Td className="text-gray-400">{d.time ? fmtTime(d.time) : '—'}</Td>
                      <Td>{d.symbol || '—'}</Td>
                      <Td><span className={sell ? 'text-rose-400' : 'text-emerald-400'}>{sell ? t('SHIT') : t('BLEJ')}</span></Td>
                      <Td>{d.volume ?? '—'}</Td>
                      <Td>{d.price != null ? Number(d.price).toLocaleString() : '—'}</Td>
                      <Td className={p >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{p >= 0 ? '+' : ''}{p.toFixed(2)}</Td>
                    </tr>
                  );
                })}
              </Table>
            </>
          )}
        </Section>
      )}

      <p className="text-[11px] text-gray-500 text-center">
        Përditësuar: {new Date(now).toLocaleTimeString()} · Modul demo i pavarur — punon edhe kur lidhja live (MetaApi) është jashtë shërbimit.
      </p>
    </div>
  );
}

function Card({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">{label}</span>{icon}
      </div>
      <div className={`text-lg font-semibold mt-1 ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-white">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-gray-500">{head.map((h) => <th key={h} className="text-left font-normal px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap text-gray-200 ${className}`}>{children}</td>;
}
function Empty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-xs text-gray-500">{text}</div>;
}
