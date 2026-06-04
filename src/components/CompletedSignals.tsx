// Komponent i përbashkët për sinjalet e PËRFUNDUARA (TP/SL/skaduar) + shkalla e suksesit.
// variant 'compact' → Terminal MT5; variant 'full' → faqja Sinjale (tab "Të përfunduara").

import { History, Clock } from 'lucide-react';

export interface DoneSignal {
  id: string; type: string; symbol: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  outcome?: string | null; result_pct?: number | null; closed_at?: string | null; created_at: string;
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('sq-AL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Statistikat e suksesit nga sinjalet e vendosura (TP ose SL).
export function signalWinStats(done: DoneSignal[]) {
  const decided = done.filter(s => s.outcome === 'tp' || s.outcome === 'sl');
  const wins = decided.filter(s => s.outcome === 'tp').length;
  const rate = decided.length ? Math.round((wins / decided.length) * 100) : 0;
  const avg = decided.length ? decided.reduce((a, s) => a + Number(s.result_pct || 0), 0) / decided.length : 0;
  return { decided: decided.length, wins, rate, avg };
}

function outcomeLabel(outcome?: string | null) {
  return outcome === 'tp' ? '✓ TP arritur' : outcome === 'sl' ? '✗ SL arritur' : '⏱ Skadoi';
}
function outcomeCls(outcome?: string | null) {
  return outcome === 'tp' ? 'bg-green-500/20 text-green-400' : outcome === 'sl' ? 'bg-red-500/20 text-red-400' : 'bg-gray-600/30 text-gray-400';
}

export default function CompletedSignals({ signals, variant = 'compact' }: { signals: DoneSignal[]; variant?: 'compact' | 'full' }) {
  const stats = signalWinStats(signals);

  if (variant === 'full') {
    if (signals.length === 0) {
      return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
          <Clock className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">Asnjë sinjal i përfunduar ende</p>
          <p className="text-gray-600 text-xs mt-1">Vlerësohen automatikisht kur arrijnë TP ose SL.</p>
        </div>
      );
    }
    return (
      <div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"><div className="text-gray-500 text-[11px] mb-1">Shkalla e suksesit</div><div className={`font-bold text-lg ${stats.rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{stats.rate}%</div></div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"><div className="text-gray-500 text-[11px] mb-1">TP / Total</div><div className="font-bold text-lg text-white">{stats.wins}/{stats.decided}</div></div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"><div className="text-gray-500 text-[11px] mb-1">Mesatarja</div><div className={`font-bold text-lg ${stats.avg >= 0 ? 'text-green-400' : 'text-red-400'}`}>{stats.avg >= 0 ? '+' : ''}{stats.avg.toFixed(2)}%</div></div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {signals.map((s) => {
            const tp = s.outcome === 'tp', sl = s.outcome === 'sl';
            const pct = s.result_pct == null ? null : Number(s.result_pct);
            return (
              <div key={s.id} className={`bg-gray-900 border rounded-2xl p-5 ${tp ? 'border-green-500/30' : sl ? 'border-red-500/30' : 'border-gray-800'}`}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-lg">{s.symbol}</span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase border ${s.type === 'buy' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>{s.type === 'buy' ? 'BLEJ' : 'SHIT'}</span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${outcomeCls(s.outcome)}`}>{outcomeLabel(s.outcome)}</span>
                  </div>
                  {pct != null && <span className={`font-bold text-lg ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-gray-800/50 rounded-lg p-2 text-center"><div className="text-gray-500 text-xs mb-1">Hyrje</div><div className="text-white text-xs font-semibold">{s.entry_price?.toLocaleString()}</div></div>
                  <div className="bg-green-500/10 rounded-lg p-2 text-center"><div className="text-gray-500 text-xs mb-1">Objektiv</div><div className="text-green-400 text-xs font-semibold">{s.target_price?.toLocaleString()}</div></div>
                  <div className="bg-red-500/10 rounded-lg p-2 text-center"><div className="text-gray-500 text-xs mb-1">Stop</div><div className="text-red-400 text-xs font-semibold">{s.stop_loss?.toLocaleString()}</div></div>
                </div>
                <div className="text-xs text-gray-500">🕒 Gjeneruar: {fmt(s.created_at)} · Mbyllur: {fmt(s.closed_at)} · besueshmëri {s.confidence}%</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ----- compact (Terminal MT5) -----
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><History className="w-4 h-4 text-amber-400" />Sinjale të përfunduara</h3>
        {signals.length > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-800 text-gray-300">
            Sukses: <span className={stats.rate >= 50 ? 'text-green-400' : 'text-red-400'}>{stats.rate}%</span> ({stats.wins}/{stats.decided})
          </span>
        )}
      </div>
      {signals.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-3">Asnjë sinjal i përfunduar ende. Vlerësohen automatikisht kur arrijnë TP/SL.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {signals.map(s => {
            const pct = s.result_pct == null ? null : Number(s.result_pct);
            return (
              <div key={s.id} className="bg-gray-800/40 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                  <span className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{s.symbol}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type === 'buy' ? 'BLEJ' : 'SHIT'}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${outcomeCls(s.outcome)}`}>{outcomeLabel(s.outcome)}</span>
                  </span>
                  {pct != null && <span className={`text-xs font-bold ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>}
                </div>
                <div className="text-[10px] text-gray-500">🕒 Gjeneruar: {fmt(s.created_at)} · Mbyllur: {fmt(s.closed_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
