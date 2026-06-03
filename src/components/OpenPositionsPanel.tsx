// Paneli i pozicioneve të hapura LIVE nga MT5 (përmes MetaApi) + ekzekutimet e fundit.
// Përdoret te faqja "Tregto Live". Lexon pozicionet reale çdo 20s dhe lejon mbyllje.

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, X, TrendingUp, TrendingDown, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { loadOpenPositions, closePosition, loadExecutions, type OpenPosition, type TradeExecution } from '../services/metaapi';

export default function OpenPositionsPanel({ configured }: { configured: boolean }) {
  const { user } = useAuth();
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshPositions = useCallback(async () => {
    if (!configured) return;
    setPosLoading(true);
    const r = await loadOpenPositions();
    if (!r.error && Array.isArray(r.positions)) setPositions(r.positions);
    else setPositions([]);
    setPosLoading(false);
  }, [configured]);

  const refreshExecutions = useCallback(async () => {
    if (user) setExecutions(await loadExecutions(user.id, 8));
  }, [user]);

  useEffect(() => {
    if (!configured) return;
    refreshPositions();
    refreshExecutions();
    const id = setInterval(() => { refreshPositions(); refreshExecutions(); }, 20000);
    return () => clearInterval(id);
  }, [configured, refreshPositions, refreshExecutions]);

  const handleClose = async (posId: string) => {
    setClosingId(posId); setMsg(null);
    const r = await closePosition(posId);
    if (r.error) setMsg({ type: 'error', text: r.message || 'Mbyllja dështoi.' });
    else { setMsg({ type: 'success', text: 'Pozicioni u mbyll.' }); await refreshPositions(); await refreshExecutions(); }
    setClosingId(null);
  };

  if (!configured) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          Pozicionet e hapura (live nga MT5)
          <span className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded-md text-xs font-semibold">{positions.length}</span>
        </h3>
        <button onClick={refreshPositions} disabled={posLoading}
          className="p-1.5 text-gray-500 hover:text-white bg-gray-800 rounded-lg transition-all disabled:opacity-50" title="Rifresko">
          <RefreshCw className={`w-3.5 h-3.5 ${posLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{msg.text}
        </div>
      )}

      {positions.length === 0 ? (
        <div className="text-[11px] text-gray-600 bg-gray-800/30 rounded-lg px-3 py-3 text-center">
          {posLoading ? 'Po lexohen pozicionet…' : 'Asnjë pozicion i hapur tani.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {positions.map((p) => {
            const isBuy = (p.type || '').includes('BUY');
            const profit = Number(p.profit ?? 0);
            return (
              <div key={p.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  {isBuy ? <TrendingUp className="w-3.5 h-3.5 text-green-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? 'BLEJ' : 'SHIT'}</span>
                  <span className="text-white">{p.symbol}</span>
                  <span className="text-gray-500">{p.volume} lot</span>
                  {p.openPrice != null && <span className="text-gray-600">@ {p.openPrice}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className={`font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                  </span>
                  <button onClick={() => handleClose(p.id)} disabled={closingId === p.id}
                    className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg font-medium transition-all disabled:opacity-50">
                    {closingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}Mbyll
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {executions.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs text-gray-400 mb-2">Ekzekutimet e fundit</div>
          <div className="space-y-1.5">
            {executions.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className={`font-bold ${e.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{e.action === 'BUY' ? 'BLEJ' : 'SHIT'}</span>
                  <span className="text-white">{e.symbol}</span>
                  <span className="text-gray-500">{e.volume} lot · {e.mode}</span>
                  {e.reason?.startsWith('auto') && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">AUTO</span>}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${e.status === 'executed' ? 'bg-green-500/15 text-green-400' : e.status === 'rejected' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                  {e.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
