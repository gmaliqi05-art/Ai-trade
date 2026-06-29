import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, RefreshCw, TrendingUp, TrendingDown, Activity, Wallet, BarChart2, AlertCircle, Loader2, Calendar, Bot, Zap, Hand, Server } from 'lucide-react';
import { loadTradeHistory, checkMetaApiConnection, loadPositionCloses, type HistoryDeal, type AccountInfo } from '../services/metaapi';
import { groupDeals, attachSource, fasttFromExecutions, closesFromPositions, type ClosedTrade, type TradeSource, type ExecRow, type FasttExecRow } from '../services/closedTrades';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n, dtLocale } from '../i18n/i18n';

interface DayRow { date: string; count: number; wins: number; losses: number; net: number; pct: number; }
interface SigRow { id: string; symbol: string; type: string; status: string; confidence: number | null; result_pct: number | null; closed_at: string | null; }

const PERIODS: { v: number | 'today'; label: string }[] = [
  { v: 'today', label: 'Sot' },
  { v: 7, label: '7 ditë' },
  { v: 30, label: '30 ditë' },
  { v: 90, label: '90 ditë' },
];

// A është kjo datë sot (në kohën lokale të pajisjes)?
const isToday = (iso?: string) => {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

// Data e sotme si YYYY-MM-DD (kohë lokale) + a bie një ISO në një ditë të caktuar (lokale)?
const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isOnDay = (iso: string | undefined, ymd: string) => {
  if (!iso) return false;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === ymd;
};

// Grupon deal-et e MT5 në trade të mbyllura — te `services/closedTrades`.
function dailyBreakdown(trades: ClosedTrade[], balance: number): DayRow[] {
  const byDay = new Map<string, DayRow>();
  for (const t of trades) {
    const day = (t.closeTime || '').slice(0, 10);
    if (!day) continue;
    const g = byDay.get(day) || { date: day, count: 0, wins: 0, losses: 0, net: 0, pct: 0 };
    g.count++; g.net += t.net;
    if (t.net > 0) g.wins++; else if (t.net < 0) g.losses++;
    byDay.set(day, g);
  }
  return [...byDay.values()]
    .map(d => ({ ...d, pct: balance > 0 ? (d.net / balance) * 100 : 0 }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

const fmtMoney = (n: number, cur = '') => `${n >= 0 ? '+' : ''}${n.toFixed(2)}${cur ? ' ' + cur : ''}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fmtDT = (iso?: string) => iso ? new Date(iso).toLocaleString(dtLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(dtLocale(), { weekday: 'short', day: '2-digit', month: 'short' });
const colr = (n: number) => n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-gray-400';

export default function ReportsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [period, setPeriod] = useState<number | 'today' | 'day'>('today');
  const [customDate, setCustomDate] = useState<string>(todayYMD()); // ditë e caktuar (YYYY-MM-DD)
  const periodLabel = period === 'today' ? t('Sot')
    : period === 'day' ? new Date(customDate + 'T00:00:00').toLocaleDateString(dtLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
    : t('{period} ditët e fundit', { period });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [trades, setTrades] = useState<ClosedTrade[]>([]);
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState('');
  const [sigClosed, setSigClosed] = useState<SigRow[]>([]); // sinjalet e mbyllura (TP/SL/skaduar) — pavarësisht MT5

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotConnected(false);
    // Sinjalet e mbyllura në periudhë (rolling 24h për 'Sot'; dritare ditore për 'ditë') — gjithmonë, edhe pa MT5.
    let sigQuery = supabase.from('signals')
      .select('id, symbol, type, status, confidence, result_pct, closed_at')
      .in('status', ['hit_tp', 'hit_sl', 'expired']);
    if (period === 'day') {
      const start = new Date(customDate + 'T00:00:00');
      const end = new Date(start); end.setDate(end.getDate() + 1);
      sigQuery = sigQuery.gte('closed_at', start.toISOString()).lt('closed_at', end.toISOString());
    } else {
      const sigSince = new Date(Date.now() - (period === 'today' ? 86400000 : (period as number) * 86400000)).toISOString();
      sigQuery = sigQuery.gte('closed_at', sigSince);
    }
    sigQuery.order('closed_at', { ascending: false }).limit(100).then(({ data }) => setSigClosed((data as SigRow[]) || []));
    try {
      // Sa ditë histori MT5 të marrim: për 'ditë' mjaft sa të mbulojë atë datë + buffer.
      const fetchDays = period === 'today' ? 2
        : period === 'day' ? Math.max(2, Math.ceil((Date.now() - new Date(customDate + 'T00:00:00').getTime()) / 86400000) + 2)
        : period;
      const [chk, hist] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(fetchDays)]);
      if ((chk.error || hist.error) === 'metaapi_not_configured') { setNotConnected(true); setTrades([]); return; }
      const acc = (chk.account || {}) as AccountInfo;
      setBalance(Number(acc.balance) || 0);
      setCurrency(acc.currency || '');
      // Trade-t e FastT-it ndërtohen DIREKT nga logu i robotit (trade_executions) — shfaqen GJITHMONË,
      // edhe nëse historiku i MT5 dështon (502). Trade-t e tjera (manual/auto) merren nga historiku i MT5.
      let fastt: ClosedTrade[] = [];
      let mt5NonFastt: ClosedTrade[] = [];
      let posCloses: ClosedTrade[] = [];
      let posCloseIds = new Set<string>();
      if (user) {
        const sinceMs = (period === 'today' ? Date.now() - 2 * 86400000 : Date.now() - (fetchDays as number) * 86400000) - 6 * 3600 * 1000;
        const [{ data: execsAll }, posCloseRows] = await Promise.all([
          supabase.from('trade_executions')
            .select('status, action, symbol, volume, entry_price, stop_loss, take_profit, signal_id, reason, created_at, metaapi_order_id')
            .eq('user_id', user.id).gte('created_at', new Date(sinceMs).toISOString())
            .order('created_at', { ascending: false }).limit(1000),
          loadPositionCloses(user.id, Math.max(2, fetchDays as number)),
        ]);
        // Mbylljet e regjistruara nga serveri (close-tracker + manual) — burim i qëndrueshëm, S'varet nga MT5.
        posCloses = closesFromPositions(posCloseRows);
        posCloseIds = new Set(posCloses.map(p => p.id));
        const rows = (execsAll || []) as Array<FasttExecRow & ExecRow>;
        fastt = fasttFromExecutions(rows).filter(f => !posCloseIds.has(f.id));
        const fasttIds = new Set(fastt.map(f => f.id));
        if (!hist.error && Array.isArray(hist.deals)) {
          const grouped = groupDeals((hist.deals || []) as HistoryDeal[]);
          attachSource(grouped, rows.filter(r => r.status === 'executed') as ExecRow[]);
          mt5NonFastt = grouped.filter(t => !posCloseIds.has(t.id) && (t.source !== 'fastt' || !fasttIds.has(t.id)));
        }
      } else if (!hist.error && Array.isArray(hist.deals)) {
        mt5NonFastt = groupDeals((hist.deals || []) as HistoryDeal[]);
      }
      // Nëse historiku i MT5 dështoi DHE s'kemi as trade FastT/server → shfaq gabimin.
      if (hist.error && fastt.length === 0 && posCloses.length === 0) {
        setError(chk.message || hist.message || t('S\'u lexuan dot të dhënat e tregtimit.')); setTrades([]); return;
      }
      setTrades([...posCloses, ...fastt, ...mt5NonFastt].sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || '')));
    } catch (e) {
      setError((e as Error).message || t('Gabim gjatë leximit.'));
    } finally {
      setLoading(false);
    }
  }, [period, customDate, user]);

  useEffect(() => { load(); }, [load]);

  // 'Sot' → vetëm trade-t e sotme; 'ditë' → vetëm ato të datës së zgjedhur; përndryshe gjithë periudha.
  const shown = period === 'today' ? trades.filter(t => isToday(t.closeTime))
    : period === 'day' ? trades.filter(t => isOnDay(t.closeTime, customDate))
    : trades;

  // Përmbledhja totale.
  const totalNet = shown.reduce((s, t) => s + t.net, 0);
  const wins = shown.filter(t => t.net > 0).length;
  const losses = shown.filter(t => t.net < 0).length;
  const decided = wins + losses;
  const winRate = decided ? Math.round((wins / decided) * 100) : 0;
  const totalPct = balance > 0 ? (totalNet / balance) * 100 : 0;
  const best = shown.reduce<ClosedTrade | null>((m, t) => (t.net > (m?.net ?? -Infinity) ? t : m), null);
  const worst = shown.reduce<ClosedTrade | null>((m, t) => (t.net < (m?.net ?? Infinity) ? t : m), null);
  const days_ = dailyBreakdown(shown, balance);

  // Sinjalet e mbyllura (rezultatet) — pavarësisht lidhjes me MT5.
  const sigTp = sigClosed.filter(s => s.status === 'hit_tp').length;
  const sigSl = sigClosed.filter(s => s.status === 'hit_sl').length;
  const sigExp = sigClosed.filter(s => s.status === 'expired').length;
  const sigDecided = sigTp + sigSl;
  const sigWr = sigDecided ? Math.round((sigTp / sigDecided) * 100) : 0;

  // Përmbledhje + grupim sipas BURIMIT (auto / sinjal / manual / direkt MT5).
  const SOURCE_ORDER: TradeSource[] = ['fastt', 'auto', 'signal', 'manual', 'mt5'];
  const sourceMeta: Record<TradeSource, { label: string; icon: typeof Bot; color: string }> = {
    fastt: { label: t('FastT'), icon: Zap, color: 'text-rose-400' },
    auto: { label: t('Auto (Roboti)'), icon: Bot, color: 'text-amber-400' },
    signal: { label: t('Nga sinjali'), icon: Zap, color: 'text-blue-400' },
    manual: { label: t('Manual'), icon: Hand, color: 'text-green-400' },
    mt5: { label: t('Direkt në MT5'), icon: Server, color: 'text-gray-400' },
  };
  const bySource = SOURCE_ORDER.map(src => {
    const list = shown.filter(tr => (tr.source || 'mt5') === src);
    const net = list.reduce((s, tr) => s + tr.net, 0);
    const w = list.filter(tr => tr.net > 0).length, l = list.filter(tr => tr.net < 0).length;
    return { src, list, net, wins: w, losses: l };
  }).filter(g => g.list.length > 0);

  const exportCSV = () => {
    const lines: string[] = [];
    lines.push(t('GOLDTRADE — Raport tregtimi ({periodLabel})', { periodLabel }));
    lines.push(t('Gjeneruar: {date}', { date: new Date().toLocaleString(dtLocale()) }));
    lines.push(t('Balanca: {balance} {currency}', { balance: balance.toFixed(2), currency }));
    lines.push('');
    lines.push(t('PERMBLEDHJE'));
    lines.push(t('Trade gjithsej,{count}', { count: shown.length }));
    lines.push(t('Fituese,{wins}', { wins }));
    lines.push(t('Humbese,{losses}', { losses }));
    lines.push(t('Shkalla e suksesit,{winRate}%', { winRate }));
    lines.push(t('P&L neto,{net} {currency}', { net: totalNet.toFixed(2), currency }));
    lines.push(t('P&L %,{pct}%', { pct: totalPct.toFixed(2) }));
    lines.push('');
    lines.push(t('RAPORTI DITOR'));
    lines.push(t('Data,Trade,Fituese,Humbese,P&L,P&L %'));
    days_.forEach(d => lines.push(`${d.date},${d.count},${d.wins},${d.losses},${d.net.toFixed(2)},${d.pct.toFixed(2)}%`));
    lines.push('');
    lines.push(t('TRADE-T E DETAJUARA'));
    lines.push(t('Mbyllur,Simboli,Drejtimi,Burimi,Lot,Hyrje,Dalje,P&L'));
    shown.forEach(tr => lines.push(`${tr.closeTime ? new Date(tr.closeTime).toLocaleString(dtLocale()) : ''},${tr.symbol},${tr.direction},${sourceMeta[tr.source || 'mt5'].label},${tr.volume},${tr.entryPrice ?? ''},${tr.exitPrice ?? ''},${tr.net.toFixed(2)}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `goldtrade_raport_${period === 'today' ? 'sot' : period === 'day' ? customDate : period + 'd'}_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-400" />{t('Raporte tregtimi')}
          </h2>
          <p className="text-gray-400 text-sm mt-1">{t('Performanca reale e trade-ve të tua nga MT5 — fitime, humbje, raport ditor me total dhe përqindje.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-700 rounded-xl transition-all"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={exportCSV} disabled={shown.length === 0} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all"><Download className="w-4 h-4" />{t('Shkarko CSV')}</button>
        </div>
      </div>

      {/* Periudha */}
      <div className="flex gap-2 flex-wrap items-center">
        {PERIODS.map(p => (
          <button key={String(p.v)} onClick={() => setPeriod(p.v)} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${period === p.v ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>{t(p.label)}</button>
        ))}
        {/* Ditë e caktuar — zgjidh një datë specifike */}
        <label className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all cursor-pointer ${period === 'day' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>
          <Calendar className="w-4 h-4" />
          <span className="hidden sm:inline">{t('Një ditë:')}</span>
          <input type="date" value={customDate} max={todayYMD()}
            onChange={e => { if (e.target.value) { setCustomDate(e.target.value); setPeriod('day'); } }}
            className="bg-transparent text-inherit text-sm focus:outline-none [color-scheme:dark]" />
        </label>
      </div>

      {/* Sinjalet e mbyllura — gjithmonë (edhe pa lidhje MT5). Këtu vjen aktiviteti i 24h që fshihet nga Sinjalet. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-400" />{t('Sinjalet e mbyllura ({periodLabel})', { periodLabel })}</h3>
        {sigClosed.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-3">{t('Asnjë sinjal i mbyllur në këtë periudhë.')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-2.5"><div className="text-[11px] text-gray-500">{t('Gjithsej')}</div><div className="text-white font-bold text-lg">{sigClosed.length}</div></div>
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-2.5"><div className="text-[11px] text-gray-500">{t('Arriti TP')}</div><div className="text-green-400 font-bold text-lg">{sigTp}</div></div>
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-2.5"><div className="text-[11px] text-gray-500">{t('Arriti SL')}</div><div className="text-red-400 font-bold text-lg">{sigSl}</div></div>
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-2.5"><div className="text-[11px] text-gray-500">{t('Sukses · Skaduar')}</div><div className="font-bold text-lg"><span className={sigWr >= 50 ? 'text-green-400' : 'text-red-400'}>{sigDecided ? `${sigWr}%` : '—'}</span> <span className="text-gray-600 text-sm">· {sigExp}</span></div></div>
            </div>
            <div className="mt-3 space-y-1">
              {sigClosed.slice(0, 8).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs bg-gray-800/30 rounded-lg px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="text-white font-medium">{s.symbol}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.status === 'hit_tp' ? 'bg-green-500/15 text-green-400' : s.status === 'hit_sl' ? 'bg-red-500/15 text-red-400' : 'bg-gray-700 text-gray-400'}`}>{s.status === 'hit_tp' ? t('TP') : s.status === 'hit_sl' ? t('SL') : t('Skaduar')}</span>
                  </span>
                  <span className="text-gray-500">{fmtDT(s.closed_at || undefined)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center py-16"><Loader2 className="w-7 h-7 text-amber-400 animate-spin" /></div>
      ) : notConnected ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
          <Wallet className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">{t('Lidh llogarinë MT5')}</p>
          <p className="text-gray-500 text-sm mt-1">{t('Raportet ndërtohen nga trade-t reale të MT5. Konfiguro lidhjen te "Lidhja & Konfigurimi".')}</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : (
        <>
          {/* Përmbledhja totale */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <Activity className="w-4 h-4 text-amber-400 mb-2" />
              <div className="text-white font-bold text-xl">{shown.length}</div>
              <div className="text-gray-500 text-xs mt-0.5">{t('Trade të mbyllura')}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <BarChart2 className={`w-4 h-4 mb-2 ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`} />
              <div className={`font-bold text-xl ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{decided ? `${winRate}%` : '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">{t('Sukses ({wins}F / {losses}H)', { wins, losses })}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <Wallet className={`w-4 h-4 mb-2 ${colr(totalNet)}`} />
              <div className={`font-bold text-xl ${colr(totalNet)}`}>{fmtMoney(totalNet)}</div>
              <div className="text-gray-500 text-xs mt-0.5">{t('P&L neto {currency}', { currency })}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              {totalPct >= 0 ? <TrendingUp className="w-4 h-4 text-green-400 mb-2" /> : <TrendingDown className="w-4 h-4 text-red-400 mb-2" />}
              <div className={`font-bold text-xl ${colr(totalPct)}`}>{fmtPct(totalPct)}</div>
              <div className="text-gray-500 text-xs mt-0.5">{t('P&L % e balancës')}</div>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
              <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-white font-medium">{period === 'today' ? t('Asnjë trade i mbyllur sot') : t('Asnjë trade i mbyllur në këtë periudhë')}</p>
              <p className="text-gray-500 text-sm mt-1">{t('Sapo të mbyllen trade, performanca shfaqet këtu automatikisht.')}</p>
            </div>
          ) : (
            <>
              {/* Raporti ditor */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  <h3 className="text-white font-semibold text-sm">{t('Raporti ditor')}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left font-medium px-4 py-2">{t('Data')}</th>
                        <th className="text-center font-medium px-4 py-2">{t('Trade')}</th>
                        <th className="text-center font-medium px-4 py-2">{t('F / H')}</th>
                        <th className="text-right font-medium px-4 py-2">{t('P&L {currency}', { currency })}</th>
                        <th className="text-right font-medium px-4 py-2">P&L %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {days_.map(d => (
                        <tr key={d.date} className="hover:bg-gray-800/30">
                          <td className="px-4 py-2.5 text-white capitalize">{fmtDay(d.date)}</td>
                          <td className="px-4 py-2.5 text-center text-gray-300">{d.count}</td>
                          <td className="px-4 py-2.5 text-center"><span className="text-green-400">{d.wins}</span> / <span className="text-red-400">{d.losses}</span></td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${colr(d.net)}`}>{fmtMoney(d.net)}</td>
                          <td className={`px-4 py-2.5 text-right ${colr(d.pct)}`}>{fmtPct(d.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-700 bg-gray-800/30 font-bold">
                        <td className="px-4 py-2.5 text-white">{t('TOTAL')}</td>
                        <td className="px-4 py-2.5 text-center text-white">{shown.length}</td>
                        <td className="px-4 py-2.5 text-center"><span className="text-green-400">{wins}</span> / <span className="text-red-400">{losses}</span></td>
                        <td className={`px-4 py-2.5 text-right ${colr(totalNet)}`}>{fmtMoney(totalNet)}</td>
                        <td className={`px-4 py-2.5 text-right ${colr(totalPct)}`}>{fmtPct(totalPct)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Përmbledhje sipas burimit — cila mënyrë po sjell më shumë fitim */}
              {bySource.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><BarChart2 className="w-4 h-4 text-amber-400" />{t('Sipas burimit')}</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {bySource.map(g => {
                      const Icon = sourceMeta[g.src].icon;
                      const dec = g.wins + g.losses;
                      const wr = dec ? Math.round((g.wins / dec) * 100) : 0;
                      return (
                        <div key={g.src} className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-3">
                          <div className={`flex items-center gap-1.5 text-xs font-semibold ${sourceMeta[g.src].color}`}><Icon className="w-3.5 h-3.5" />{sourceMeta[g.src].label}</div>
                          <div className={`font-bold text-lg mt-1 ${colr(g.net)}`}>{fmtMoney(g.net)}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{t('{count} trade · {wins}F/{losses}H · {wr}%', { count: g.list.length, wins: g.wins, losses: g.losses, wr })}</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">{t('Krahaso burimet: numri pozitiv = fitim. Kështu sheh cila mënyrë (auto, sinjal, manual) po punon më mirë për ty.')}</p>
                </div>
              )}

              {/* Trade-t e detajuara — të grupuara sipas burimit me vijë ndarëse */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" />{t('Lëvizjet e tua (trade-t)')}</h3>
                  {best && worst && (
                    <span className="text-xs text-gray-500">{t('Më i miri:')} <span className="text-green-400">{fmtMoney(best.net)}</span> · {t('Më i keqi:')} <span className="text-red-400">{fmtMoney(worst.net)}</span></span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left font-medium px-4 py-2">{t('Mbyllur')}</th>
                        <th className="text-left font-medium px-4 py-2">{t('Simboli')}</th>
                        <th className="text-left font-medium px-4 py-2">{t('Drejtimi')}</th>
                        <th className="text-right font-medium px-4 py-2">{t('Lot')}</th>
                        <th className="text-right font-medium px-4 py-2">{t('Hyrje')}</th>
                        <th className="text-right font-medium px-4 py-2">{t('Dalje')}</th>
                        <th className="text-right font-medium px-4 py-2">{t('P&L {currency}', { currency })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {bySource.map(g => {
                        const Icon = sourceMeta[g.src].icon;
                        return [
                          // Vija ndarëse / titulli i grupit
                          <tr key={`${g.src}-h`} className="bg-gray-800/50 border-t-2 border-gray-700">
                            <td colSpan={6} className="px-4 py-2">
                              <span className={`flex items-center gap-1.5 text-xs font-bold ${sourceMeta[g.src].color}`}>
                                <Icon className="w-3.5 h-3.5" />{sourceMeta[g.src].label} · {g.list.length}
                              </span>
                            </td>
                            <td className={`px-4 py-2 text-right font-bold text-xs ${colr(g.net)}`}>{fmtMoney(g.net)}</td>
                          </tr>,
                          ...g.list.map(tr => (
                            <tr key={tr.id} className="hover:bg-gray-800/30">
                              <td className="px-4 py-2.5 text-gray-400">{fmtDT(tr.closeTime)}</td>
                              <td className="px-4 py-2.5 text-white font-medium">{tr.symbol}</td>
                              <td className="px-4 py-2.5">
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tr.direction === 'BUY' ? 'bg-green-500/20 text-green-400' : tr.direction === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400'}`}>
                                  {tr.direction === 'BUY' ? t('BLEJ') : tr.direction === 'SELL' ? t('SHIT') : '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-300">{tr.volume || '—'}</td>
                              <td className="px-4 py-2.5 text-right text-gray-300">{tr.entryPrice != null ? tr.entryPrice.toLocaleString() : '—'}</td>
                              <td className="px-4 py-2.5 text-right text-gray-300">{tr.exitPrice != null ? tr.exitPrice.toLocaleString() : '—'}</td>
                              <td className={`px-4 py-2.5 text-right font-bold ${colr(tr.net)}`}>{fmtMoney(tr.net)}</td>
                            </tr>
                          )),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-gray-600 text-xs text-center">
                {t('P&L përfshin fitimin + komisionin + swap. Përqindja llogaritet mbi balancën aktuale ({balance} {currency}). Të dhënat janë reale nga MT5.', { balance: balance.toFixed(2), currency })}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
