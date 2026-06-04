import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, RefreshCw, TrendingUp, TrendingDown, Activity, Wallet, BarChart2, AlertCircle, Loader2, Calendar } from 'lucide-react';
import { loadTradeHistory, checkMetaApiConnection, type HistoryDeal, type AccountInfo } from '../services/metaapi';

// Një trade i mbyllur, i grupuar nga deal-et IN/OUT të MT5 sipas positionId.
interface ClosedTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | '?';
  openTime?: string;
  closeTime?: string;
  volume: number;
  entryPrice?: number;
  exitPrice?: number;
  net: number; // profit + commission + swap
}

interface DayRow { date: string; count: number; wins: number; losses: number; net: number; pct: number; }

const PERIODS: { v: number; label: string }[] = [
  { v: 7, label: '7 ditë' },
  { v: 30, label: '30 ditë' },
  { v: 90, label: '90 ditë' },
];

// Grupon deal-et e MT5 në trade të mbyllura (IN = hapje, OUT = mbyllje).
function groupDeals(deals: HistoryDeal[]): ClosedTrade[] {
  const m = new Map<string, ClosedTrade>();
  for (const d of deals) {
    const pid = d.positionId || d.id;
    if (!pid) continue;
    const et = (d.entryType || '').toUpperCase();
    const g = m.get(pid) || { id: pid, symbol: d.symbol || '—', direction: '?' as const, volume: 0, net: 0 };
    g.net += (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0);
    if (et.includes('IN')) {
      g.direction = (d.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL';
      g.entryPrice = Number(d.price) || g.entryPrice;
      g.openTime = d.time || g.openTime;
      g.volume = Number(d.volume) || g.volume;
      if (d.symbol) g.symbol = d.symbol;
    }
    if (et.includes('OUT')) {
      g.exitPrice = Number(d.price) || g.exitPrice;
      g.closeTime = d.time || g.closeTime;
      if (d.symbol && g.symbol === '—') g.symbol = d.symbol;
    }
    m.set(pid, g);
  }
  return [...m.values()]
    .filter(t => t.closeTime) // vetëm trade të mbyllura
    .sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || ''));
}

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
const fmtDT = (iso?: string) => iso ? new Date(iso).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('sq-AL', { weekday: 'short', day: '2-digit', month: 'short' });
const colr = (n: number) => n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-gray-400';

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [trades, setTrades] = useState<ClosedTrade[]>([]);
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotConnected(false);
    try {
      const [chk, hist] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(days)]);
      if (chk.error || hist.error) {
        if ((chk.error || hist.error) === 'metaapi_not_configured') { setNotConnected(true); setTrades([]); return; }
        setError(chk.message || hist.message || 'S\'u lexuan dot të dhënat e tregtimit.'); return;
      }
      const acc = (chk.account || {}) as AccountInfo;
      setBalance(Number(acc.balance) || 0);
      setCurrency(acc.currency || '');
      setTrades(groupDeals((hist.deals || []) as HistoryDeal[]));
    } catch (e) {
      setError((e as Error).message || 'Gabim gjatë leximit.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // Përmbledhja totale.
  const totalNet = trades.reduce((s, t) => s + t.net, 0);
  const wins = trades.filter(t => t.net > 0).length;
  const losses = trades.filter(t => t.net < 0).length;
  const decided = wins + losses;
  const winRate = decided ? Math.round((wins / decided) * 100) : 0;
  const totalPct = balance > 0 ? (totalNet / balance) * 100 : 0;
  const best = trades.reduce<ClosedTrade | null>((m, t) => (t.net > (m?.net ?? -Infinity) ? t : m), null);
  const worst = trades.reduce<ClosedTrade | null>((m, t) => (t.net < (m?.net ?? Infinity) ? t : m), null);
  const days_ = dailyBreakdown(trades, balance);

  const exportCSV = () => {
    const lines: string[] = [];
    lines.push(`GOLDTRADE — Raport tregtimi (${days} ditët e fundit)`);
    lines.push(`Gjeneruar: ${new Date().toLocaleString('sq-AL')}`);
    lines.push(`Balanca: ${balance.toFixed(2)} ${currency}`);
    lines.push('');
    lines.push('PERMBLEDHJE');
    lines.push(`Trade gjithsej,${trades.length}`);
    lines.push(`Fituese,${wins}`);
    lines.push(`Humbese,${losses}`);
    lines.push(`Shkalla e suksesit,${winRate}%`);
    lines.push(`P&L neto,${totalNet.toFixed(2)} ${currency}`);
    lines.push(`P&L %,${totalPct.toFixed(2)}%`);
    lines.push('');
    lines.push('RAPORTI DITOR');
    lines.push('Data,Trade,Fituese,Humbese,P&L,P&L %');
    days_.forEach(d => lines.push(`${d.date},${d.count},${d.wins},${d.losses},${d.net.toFixed(2)},${d.pct.toFixed(2)}%`));
    lines.push('');
    lines.push('TRADE-T E DETAJUARA');
    lines.push('Mbyllur,Simboli,Drejtimi,Lot,Hyrje,Dalje,P&L');
    trades.forEach(t => lines.push(`${t.closeTime ? new Date(t.closeTime).toLocaleString('sq-AL') : ''},${t.symbol},${t.direction},${t.volume},${t.entryPrice ?? ''},${t.exitPrice ?? ''},${t.net.toFixed(2)}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `goldtrade_raport_${days}d_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-400" />Raporte tregtimi
          </h2>
          <p className="text-gray-400 text-sm mt-1">Performanca reale e trade-ve të tua nga MT5 — fitime, humbje, raport ditor me total dhe përqindje.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-700 rounded-xl transition-all"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={exportCSV} disabled={trades.length === 0} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-gray-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all"><Download className="w-4 h-4" />Shkarko CSV</button>
        </div>
      </div>

      {/* Periudha */}
      <div className="flex gap-2">
        {PERIODS.map(p => (
          <button key={p.v} onClick={() => setDays(p.v)} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${days === p.v ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>{p.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center py-16"><Loader2 className="w-7 h-7 text-amber-400 animate-spin" /></div>
      ) : notConnected ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
          <Wallet className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">Lidh llogarinë MT5</p>
          <p className="text-gray-500 text-sm mt-1">Raportet ndërtohen nga trade-t reale të MT5. Konfiguro lidhjen te "Lidhja & Konfigurimi".</p>
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
              <div className="text-white font-bold text-xl">{trades.length}</div>
              <div className="text-gray-500 text-xs mt-0.5">Trade të mbyllura</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <BarChart2 className={`w-4 h-4 mb-2 ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`} />
              <div className={`font-bold text-xl ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{decided ? `${winRate}%` : '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">Sukses ({wins}F / {losses}H)</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <Wallet className={`w-4 h-4 mb-2 ${colr(totalNet)}`} />
              <div className={`font-bold text-xl ${colr(totalNet)}`}>{fmtMoney(totalNet)}</div>
              <div className="text-gray-500 text-xs mt-0.5">P&L neto {currency}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              {totalPct >= 0 ? <TrendingUp className="w-4 h-4 text-green-400 mb-2" /> : <TrendingDown className="w-4 h-4 text-red-400 mb-2" />}
              <div className={`font-bold text-xl ${colr(totalPct)}`}>{fmtPct(totalPct)}</div>
              <div className="text-gray-500 text-xs mt-0.5">P&L % e balancës</div>
            </div>
          </div>

          {trades.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
              <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-white font-medium">Asnjë trade i mbyllur në këtë periudhë</p>
              <p className="text-gray-500 text-sm mt-1">Sapo të mbyllen trade, performanca shfaqet këtu automatikisht.</p>
            </div>
          ) : (
            <>
              {/* Raporti ditor */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  <h3 className="text-white font-semibold text-sm">Raporti ditor</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left font-medium px-4 py-2">Data</th>
                        <th className="text-center font-medium px-4 py-2">Trade</th>
                        <th className="text-center font-medium px-4 py-2">F / H</th>
                        <th className="text-right font-medium px-4 py-2">P&L {currency}</th>
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
                        <td className="px-4 py-2.5 text-white">TOTAL</td>
                        <td className="px-4 py-2.5 text-center text-white">{trades.length}</td>
                        <td className="px-4 py-2.5 text-center"><span className="text-green-400">{wins}</span> / <span className="text-red-400">{losses}</span></td>
                        <td className={`px-4 py-2.5 text-right ${colr(totalNet)}`}>{fmtMoney(totalNet)}</td>
                        <td className={`px-4 py-2.5 text-right ${colr(totalPct)}`}>{fmtPct(totalPct)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Trade-t e detajuara */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" />Lëvizjet e tua (trade-t)</h3>
                  {best && worst && (
                    <span className="text-xs text-gray-500">Më i miri: <span className="text-green-400">{fmtMoney(best.net)}</span> · Më i keqi: <span className="text-red-400">{fmtMoney(worst.net)}</span></span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left font-medium px-4 py-2">Mbyllur</th>
                        <th className="text-left font-medium px-4 py-2">Simboli</th>
                        <th className="text-left font-medium px-4 py-2">Drejtimi</th>
                        <th className="text-right font-medium px-4 py-2">Lot</th>
                        <th className="text-right font-medium px-4 py-2">Hyrje</th>
                        <th className="text-right font-medium px-4 py-2">Dalje</th>
                        <th className="text-right font-medium px-4 py-2">P&L {currency}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {trades.map(t => (
                        <tr key={t.id} className="hover:bg-gray-800/30">
                          <td className="px-4 py-2.5 text-gray-400">{fmtDT(t.closeTime)}</td>
                          <td className="px-4 py-2.5 text-white font-medium">{t.symbol}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${t.direction === 'BUY' ? 'bg-green-500/20 text-green-400' : t.direction === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400'}`}>
                              {t.direction === 'BUY' ? 'BLEJ' : t.direction === 'SELL' ? 'SHIT' : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-300">{t.volume || '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-300">{t.entryPrice != null ? t.entryPrice.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-300">{t.exitPrice != null ? t.exitPrice.toLocaleString() : '—'}</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${colr(t.net)}`}>{fmtMoney(t.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-gray-600 text-xs text-center">
                P&L përfshin fitimin + komisionin + swap. Përqindja llogaritet mbi balancën aktuale ({balance.toFixed(2)} {currency}). Të dhënat janë reale nga MT5.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
