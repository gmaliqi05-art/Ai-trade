import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Wallet, Activity, FlaskConical, Power, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import Mt5Chart, { type ChartCandle, type PriceLineDef } from '../components/Mt5Chart';
import { fetchBinanceCandles, type Timeframe } from '../ai-trader/market/candles';
import CompletedSignals, { type DoneSignal } from '../components/CompletedSignals';

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
  id: string; symbol: string; side: string; volume: number; signal_id: string | null;
  entry_price: number; sl: number | null; tp: number | null;
  status: string; exit_price: number | null; exit_reason: string | null;
  profit: number | null; opened_at: string; closed_at: string | null;
};

// Afati & Burimi i një demo-trade (si te live): scalp (pa sinjal) = afat-shkurt; swing (me sinjal) = afat-gjatë.
const tradeKind = (t: DemoTrade) => (t.signal_id == null
  ? { horizon: 'short' as const, src: 'Scalp', cls: 'bg-amber-500/20 text-amber-400' }
  : { horizon: 'long' as const, src: 'Sinjal', cls: 'bg-blue-500/20 text-blue-400' });

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
  const [balance, setBalance] = useState<number>(100);
  const [startBalance, setStartBalance] = useState<number>(100);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [trades, setTrades] = useState<DemoTrade[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
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
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const [{ data: prof }, { data: tr }, { data: assets }, { data: sig }, { data: done }] = await Promise.all([
      supabase.from('profiles').select('demo_balance, demo_start_balance, demo_enabled').eq('id', user.id).maybeSingle(),
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
      setEnabled(!!prof.demo_enabled);
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

  // Grafiku i arit (XAUUSD → PAXG nga Binance) — i njëjti çmim real si te Live, pa MetaApi.
  const loadCandles = useCallback(async () => {
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

  const open = useMemo(() => trades.filter((t) => t.status === 'open'), [trades]);
  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);

  const unrealizedOf = useCallback((t: DemoTrade): number => {
    const px = prices[normSym(t.symbol)];
    if (px == null) return 0;
    const dir = (t.side || '').toLowerCase() === 'buy' ? 1 : -1;
    return (px - Number(t.entry_price)) * dir * Number(t.volume) * valuePerPrice(t.symbol);
  }, [prices]);

  const floating = useMemo(() => open.reduce((s, t) => s + unrealizedOf(t), 0), [open, unrealizedOf]);
  const equity = balance + floating;
  const curPrice = prices[normSym(formSym)] ?? null;

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
      setMsg({ type: 'success', text: `U hap ${side === 'buy' ? 'BLEJ' : 'SHIT'} ${formSym} @ ${fmt(Number((data as { entry?: number }).entry ?? 0))}` });
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

  // Linjat Entry/SL/TP të pozicioneve demo të arit mbi grafik (si te terminali Live).
  const chartLines = useMemo<PriceLineDef[]>(() => {
    const lines: PriceLineDef[] = [];
    const gold = open.filter((t) => normSym(t.symbol).includes('XAU') || normSym(t.symbol).includes('GOLD'));
    for (const t of gold.slice(0, 4)) {
      const buy = (t.side || '').toLowerCase() === 'buy';
      lines.push({ price: Number(t.entry_price), color: buy ? '#3b82f6' : '#f59e0b', title: `Hyrje ${buy ? 'BLEJ' : 'SHIT'}` });
      if (t.sl != null) lines.push({ price: Number(t.sl), color: '#ef4444', title: 'SL' });
      if (t.tp != null) lines.push({ price: Number(t.tp), color: '#22c55e', title: 'TP' });
    }
    return lines;
  }, [open]);

  const realizedPnl = useMemo(() => closed.reduce((s, t) => s + (Number(t.profit) || 0), 0), [closed]);
  const wins = closed.filter((t) => (Number(t.profit) || 0) > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;

  async function toggleEnabled() {
    if (!user) return;
    const next = !enabled;
    setEnabled(next);
    await supabase.from('profiles').update({ demo_enabled: next }).eq('id', user.id);
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
              Tregto Demo
              <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded">Virtual</span>
            </h1>
            <p className="text-xs text-gray-400">Roboti tregton virtualisht me çmimet reale të arit — pa para reale, pa MetaApi.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleEnabled}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${enabled ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
            <Power className="w-3.5 h-3.5" /> {enabled ? 'Demo ON' : 'Demo OFF'}
          </button>
          <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Balanca demo" value={`€${fmt(balance)}`} icon={<Wallet className="w-4 h-4 text-amber-400" />} />
        <Card label="Equity" value={`€${fmt(equity)}`} icon={<Activity className="w-4 h-4 text-blue-400" />} />
        <Card label="Fitim/Humbje (hapur)" value={`${floating >= 0 ? '+' : ''}€${fmt(floating)}`}
          tone={floating >= 0 ? 'pos' : 'neg'} icon={floating >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />} />
        <Card label="Pozicione të hapura" value={`${open.length}`} sub={`nga starti €${fmt(startBalance)}`} icon={<Activity className="w-4 h-4 text-violet-400" />} />
      </div>

      {/* Performance strip */}
      <div className="grid grid-cols-3 gap-3">
        <Mini label="P&L i realizuar" value={`${realizedPnl >= 0 ? '+' : ''}€${fmt(realizedPnl)}`} tone={realizedPnl >= 0 ? 'pos' : 'neg'} />
        <Mini label="Trade të mbyllura" value={`${closed.length}`} />
        <Mini label="Win rate" value={`${winRate}%`} tone={winRate >= 50 ? 'pos' : undefined} />
      </div>

      {/* Chart — gold (same real price feed as Live), with demo position lines */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-amber-500/15 text-amber-400 px-2 py-1 rounded">XAUUSD</span>
            <span className="text-[11px] text-gray-500">Ar · çmim real (demo)</span>
          </div>
          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((x) => (
              <button key={x} onClick={() => setTf(x)}
                className={`text-[11px] px-2 py-1 rounded transition ${tf === x ? 'bg-amber-500 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{x}</button>
            ))}
          </div>
        </div>
        {candles.length === 0
          ? <div className="h-[320px] flex items-center justify-center text-xs text-gray-500">Po ngarkohet grafiku…</div>
          : <Mt5Chart candles={candles} lines={chartLines} height={320} fitKey={`XAUUSD-${tf}`} />}
      </div>

      {/* Manual order form (demo) — like Live: click a signal to fill, then BLEJ/SHIT */}
      <div ref={formRef} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">Porosi e re — {formSym} <span className="text-violet-400 text-[11px]">(demo)</span></h3>
          {curPrice != null && <span className="text-[11px] text-gray-400">Çmimi tani: <span className="text-white">{fmt(curPrice)}</span></span>}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button onClick={() => setSide('buy')} className={`flex-1 py-2 text-sm font-semibold transition ${side === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>BLEJ</button>
          <button onClick={() => setSide('sell')} className={`flex-1 py-2 text-sm font-semibold transition ${side === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>SHIT</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs shrink-0 w-8">Lot</label>
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
            <input type="number" step="0.01" value={formSl} onChange={(e) => setFormSl(e.target.value)} placeholder="opsionale"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-red-500" />
          </div>
          <div>
            <label className="block text-[10px] text-green-400 mb-1">Take Profit</label>
            <input type="number" step="0.01" value={formTp} onChange={(e) => setFormTp(e.target.value)} placeholder="opsionale"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-green-500" />
          </div>
        </div>
        {msg && <div className={`text-[11px] rounded-lg px-2 py-1.5 ${msg.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{msg.text}</div>}
        <button onClick={execute} disabled={busy}
          className={`w-full py-2.5 rounded-lg text-sm font-bold text-white transition disabled:opacity-50 ${side === 'buy' ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400'}`}>
          {busy ? 'Po hapet…' : side === 'buy' ? 'BLEJ (demo)' : 'SHIT (demo)'}
        </button>
        <p className="text-[10px] text-gray-600">Hapet virtualisht me çmimin real aktual. Roboti e mbyll te SL/TP, ose mbylle vetë te tabela poshtë.</p>
      </div>

      {/* Open positions */}
      <Section title={`Pozicione të hapura (${open.length})`}>
        {loading ? <Empty text="Po ngarkohet…" /> : open.length === 0 ? (
          <Empty text="Asnjë pozicion i hapur. Roboti hap trade virtuale kur dalin sinjale të reja." />
        ) : (
          <Table head={['Lloji', 'Simboli', 'Afati', 'Burimi', 'Lot', 'Hyrja', 'SL', 'TP', 'P&L tani', '']}>
            {open.map((t) => {
              const pnl = unrealizedOf(t);
              const buy = (t.side || '').toLowerCase() === 'buy';
              const k = tradeKind(t);
              return (
                <tr key={t.id} className="border-t border-gray-800">
                  <Td><span className={`inline-flex items-center gap-1 font-medium ${buy ? 'text-emerald-400' : 'text-rose-400'}`}>{buy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{buy ? 'BLEJ' : 'SHIT'}</span></Td>
                  <Td>{t.symbol}</Td>
                  <Td><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.cls}`}>{k.horizon === 'short' ? 'Shkurt' : 'Gjatë'}</span></Td>
                  <Td><span className="text-[10px] text-gray-400">{k.src}</span></Td>
                  <Td>{fmt(Number(t.volume), 2)}</Td>
                  <Td>{fmt(Number(t.entry_price))}</Td>
                  <Td>{t.sl != null ? fmt(Number(t.sl)) : '—'}</Td>
                  <Td>{t.tp != null ? fmt(Number(t.tp)) : '—'}</Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                  <Td><button onClick={() => closeTrade(t.id)} disabled={busy} className="text-[11px] px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition disabled:opacity-40">Mbyll</button></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {/* History */}
      <Section title={`Historiku (${closed.length})`}>
        {closed.length === 0 ? <Empty text="Ende s'ka trade të mbyllura." /> : (
          <Table head={['Lloji', 'Simboli', 'Afati', 'Burimi', 'Lot', 'Hyrja', 'Dalja', 'Arsyeja', 'P&L', 'Mbyllur']}>
            {closed.slice(0, 50).map((t) => {
              const buy = (t.side || '').toLowerCase() === 'buy';
              const pnl = Number(t.profit) || 0;
              const k = tradeKind(t);
              return (
                <tr key={t.id} className="border-t border-gray-800">
                  <Td><span className={buy ? 'text-emerald-400' : 'text-rose-400'}>{buy ? 'BLEJ' : 'SHIT'}</span></Td>
                  <Td>{t.symbol}</Td>
                  <Td><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.cls}`}>{k.horizon === 'short' ? 'Shkurt' : 'Gjatë'}</span></Td>
                  <Td><span className="text-[10px] text-gray-400">{k.src}</span></Td>
                  <Td>{fmt(Number(t.volume), 2)}</Td>
                  <Td>{fmt(Number(t.entry_price))}</Td>
                  <Td>{t.exit_price != null ? fmt(Number(t.exit_price)) : '—'}</Td>
                  <Td><span className={`text-[11px] uppercase ${t.exit_reason === 'tp' ? 'text-emerald-400' : t.exit_reason === 'sl' ? 'text-rose-400' : 'text-gray-400'}`}>{t.exit_reason || '—'}</span></Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                  <Td><span className="text-gray-500">{t.closed_at ? new Date(t.closed_at).toLocaleString() : '—'}</span></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {/* Sinjalet aktive — TË NJËJTAT që përdor roboti (njësoj si terminali Live) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-400" />Sinjalet aktive</h3>
        {signals.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">Asnjë sinjal aktiv tani.</p>
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
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? 'BLEJ' : 'SHIT'}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${short ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{short ? 'Afat-shkurt' : 'Afat-gjatë'}</span>
                    </span>
                    <span className="text-amber-400 text-xs font-semibold">{s.confidence}%</span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                    {s.entry_price != null && <span>Hyrje: <span className="text-white">{Number(s.entry_price).toLocaleString()}</span></span>}
                    {s.target_price != null && <span>Objektiv: <span className="text-green-400">{Number(s.target_price).toLocaleString()}</span></span>}
                    {s.stop_loss != null && <span>Stop: <span className="text-red-400">{Number(s.stop_loss).toLocaleString()}</span></span>}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1 flex items-center justify-between">
                    <span>🕒 {fmtTime(s.created_at)}</span>
                    <span className="text-amber-400">Kliko për të tregtuar →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sinjalet e përfunduara (i njëjti komponent si Live) */}
      <CompletedSignals signals={doneSignals} variant="compact" />

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
