// Paneli i pozicioneve të hapura LIVE nga MT5 (përmes MetaApi) + ekzekutimet e fundit.
// Përdoret te faqja "Tregto Live". Mund të shfaqet i ndarë me `section`:
//  - "positions"  → vetëm pozicionet e hapura (me mbyllje)
//  - "executions" → vetëm ekzekutimet e fundit
//  - "both" (default) → të dyja bashkë
// SL/TP vendosen/lëvizen mbi GRAFIK (prek linjën e hyrjes) — paneli vetëm i SHFAQ vlerat + P&L live.
import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useAuth } from '../context/AuthContext';
import { loadOpenPositions, closePosition, loadExecutions, loadPendingOrders, cancelOrder, type OpenPosition, type PendingOrder, type TradeExecution } from '../services/metaapi';
import { useMetaStream } from '../hooks/useMetaStream';

export default function OpenPositionsPanel({ configured, section = 'both' }: { configured: boolean; section?: 'positions' | 'executions' | 'both' }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [posLoaded, setPosLoaded] = useState(false);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [posAt, setPosAt] = useState(0);              // koha (ms) e leximit të fundit të suksesshëm të pozicioneve
  const [posClock, setPosClock] = useState(Date.now()); // rrah çdo 2s për të rivlerësuar freskinë
  const [posErr, setPosErr] = useState(false);        // leximi i parë dështoi → trego gabim + Riprovo
  // Lidhja DIREKTE streaming (websocket) — burimi parësor real-time; REST mbetet vetëm rezervë.
  const stream = useMetaStream();
  const streamLive = stream.status === 'live';
  const streamHealthy = streamLive && stream.lastTickAt > 0 && (stream.updatedAt - stream.lastTickAt < 6000);
  const posFresh = posAt > 0 && (posClock - posAt) < 12000; // feed-i i pozicioneve është i freskët

  const showPositions = section === 'positions' || section === 'both';
  const showExecutions = section === 'executions' || section === 'both';

  const refreshPositions = useCallback(async () => {
    if (!configured) return;
    setPosLoading(true);
    const [pr, or] = await Promise.all([loadOpenPositions(), loadPendingOrders()]);
    // Përditëso VETËM kur leximi është i suksesshëm. Në gabim/timeout KALIMTAR (p.sh. 502), RUAJ
    // pozicionet e fundit — mos i fshi. Lista zbrazet vetëm kur MetaApi kthen me sukses 0 pozicione.
    if (!pr.error && Array.isArray(pr.positions)) { setPositions(pr.positions); setPosLoaded(true); setPosErr(false); setPosAt(Date.now()); }
    else setPosErr(true);
    if (!or.error && Array.isArray(or.orders)) setOrders(or.orders);
    setPosLoading(false);
  }, [configured]);

  const refreshExecutions = useCallback(async () => {
    if (user) setExecutions(await loadExecutions(user.id, 8));
  }, [user]);

  // Rrahje çdo 2s për të rivlerësuar freskinë e feed-it (edhe kur s'vjen përditësim).
  useEffect(() => {
    const id = setInterval(() => setPosClock(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  // STREAMING: pozicionet real-time nga websocket-i (pa polling) kur jep tick-e të freskëta.
  useEffect(() => {
    if (!streamHealthy || !showPositions) return;
    setPositions(stream.positions as unknown as OpenPosition[]);
    setPosLoaded(true); setPosErr(false); setPosAt(Date.now());
  }, [streamHealthy, showPositions, stream.updatedAt]);

  // POLL REST (rezervë): aktiv kur streaming-u s'po jep tick-e të freskëta.
  useEffect(() => {
    if (!configured || streamHealthy) return;
    if (showPositions) refreshPositions();
    if (showExecutions) refreshExecutions();
    // Pozicionet (P&L live nga MT5) çdo 2s; ekzekutimet (DB) më rrallë, çdo ~12s.
    let tick = 0;
    const id = setInterval(() => {
      tick++;
      if (showPositions) refreshPositions();
      if (showExecutions && tick % 6 === 0) refreshExecutions();
    }, 2000);
    return () => clearInterval(id);
  }, [configured, streamHealthy, showPositions, showExecutions, refreshPositions, refreshExecutions]);

  // Ekzekutimet (nga DB) nuk vijnë nga streaming — lexoji periodikisht edhe kur streaming-u është live.
  useEffect(() => {
    if (!configured || !streamLive || !showExecutions) return;
    refreshExecutions();
    const id = setInterval(refreshExecutions, 12000);
    return () => clearInterval(id);
  }, [configured, streamLive, showExecutions, refreshExecutions]);

  // P&L LIVE = fitimi i broker-it për pozicionin (i njëjti numër që tregon MT5; përditësohet çdo 2s
  // ose real-time me streaming). Mbyllja bëhet me çmimin real të tregut.
  const livePnl = (p: OpenPosition): number => Number(p.profit ?? 0);

  const handleClose = async (posId: string) => {
    setClosingId(posId); setMsg(null);
    const r = await closePosition(posId);
    if (r.error) setMsg({ type: 'error', text: r.message || t('Mbyllja dështoi.') });
    else { setMsg({ type: 'success', text: t('Pozicioni u mbyll.') }); await refreshPositions(); await refreshExecutions(); }
    setClosingId(null);
  };

  const handleCancel = async (orderId: string) => {
    setClosingId(orderId); setMsg(null);
    const r = await cancelOrder(orderId);
    if (r.error) setMsg({ type: 'error', text: r.message || t('Anulimi dështoi.') });
    else { setMsg({ type: 'success', text: t('Porosia u anulua.') }); await refreshPositions(); }
    setClosingId(null);
  };

  if (!configured) return null;

  // —— Vetëm ekzekutimet (seksion i veçantë) ——
  if (section === 'executions') {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="text-white font-semibold text-sm mb-3">{t('Ekzekutimet e fundit')}</div>
        {executions.length === 0 ? (
          <div className="text-[11px] text-gray-600 bg-gray-800/30 rounded-lg px-3 py-3 text-center">{t('Asnjë ekzekutim ende.')}</div>
        ) : (
          <div className="space-y-1.5">{executions.map(renderExecution(t))}</div>
        )}
      </div>
    );
  }

  // —— Pozicionet (+ ekzekutimet vetëm kur section='both') ——
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          {t('Pozicionet e hapura (live nga MT5)')}
          <span className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded-md text-xs font-semibold">{positions.length}</span>
          {(streamHealthy || posFresh) ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400" title={t('P&L live nga MT5 — i njëjti numër si te platforma; mbyllja bëhet me çmimin real')}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{streamHealthy ? t('DIREKT ●') : t('live · 2s')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-amber-400" title={t('Feed-i po rifreskohet — vlerat e fundit të njohura')}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />{t('po rifreskohet…')}
            </span>
          )}
        </h3>
        <button onClick={refreshPositions} disabled={posLoading}
          className="p-1.5 text-gray-500 hover:text-white bg-gray-800 rounded-lg transition-all disabled:opacity-50" title={t('Rifresko')}>
          <RefreshCw className={`w-3.5 h-3.5 ${posLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{msg.text}
        </div>
      )}

      {positions.length === 0 ? (
        (posErr && !posLoaded) ? (
          <div className="flex flex-col items-center gap-2 text-[11px] bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-3 text-center">
            <span className="flex items-center gap-1.5 text-red-400"><AlertCircle className="w-4 h-4" />{t('MetaApi i paarritshëm — pozicionet s\'u lexuan.')}</span>
            <button onClick={refreshPositions} disabled={posLoading}
              className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${posLoading ? 'animate-spin' : ''}`} />{t('Riprovo')}
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-gray-600 bg-gray-800/30 rounded-lg px-3 py-3 text-center">
            {!posLoaded ? t('Po lexohen pozicionet…') : t('Asnjë pozicion i hapur tani.')}
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          {positions.map((p) => {
            const isBuy = (p.type || '').includes('BUY');
            const profit = livePnl(p);
            const noProtection = !p.stopLoss || !p.takeProfit;
            return (
              <div key={p.id} className="bg-gray-800/40 rounded-lg">
                <div className="flex items-center justify-between text-xs px-3 py-2 gap-2">
                  <span className="flex items-center gap-2 min-w-0 flex-wrap">
                    {isBuy ? <TrendingUp className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span>
                    <span className="text-white">{p.symbol}</span>
                    <span className="text-gray-300">{p.volume} {t('lot')}</span>
                    {p.openPrice != null && <span className="text-gray-400">@ {p.openPrice}</span>}
                    {p.stopLoss != null && <span className="text-red-300/80">SL {p.stopLoss}</span>}
                    {p.takeProfit != null && <span className="text-green-300/80">TP {p.takeProfit}</span>}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className={`font-semibold tabular-nums ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                    </span>
                    <button onClick={() => handleClose(p.id)} disabled={closingId === p.id}
                      className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg font-medium transition-all disabled:opacity-50">
                      {closingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}{t('Mbyll')}
                    </button>
                  </span>
                </div>

                {/* Paralajmërim (jo buton): pozicion pa mbrojtje — vendos SL/TP te grafiku. */}
                {noProtection && (
                  <div className="px-3 pb-2 -mt-0.5 text-[10px] text-amber-400/90 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {!p.stopLoss && !p.takeProfit ? t('Pa SL dhe TP — vendosi te grafiku (prek linjën e hyrjes).') : !p.stopLoss ? t('Pa SL — vendose te grafiku.') : t('Pa TP — vendose te grafiku.')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Porositë NË PRITJE (limit/stop) — trade aktive që presin çmimin */}
      {orders.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-400" />{t('Porositë në pritje')}</div>
          <div className="space-y-1.5">
            {orders.map((o) => {
              const isBuy = (o.type || '').includes('BUY');
              return (
                <div key={o.id} className="flex items-center justify-between text-xs bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span>
                    <span className="text-white">{o.symbol}</span>
                    <span className="text-gray-500">{o.volume} {t('lot')}</span>
                    {o.openPrice != null && <span className="text-amber-400">@ {o.openPrice}</span>}
                  </span>
                  <button onClick={() => handleCancel(o.id)} disabled={closingId === o.id}
                    className="flex items-center gap-1 bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600 px-2 py-1 rounded-lg font-medium transition-all disabled:opacity-50">
                    {closingId === o.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}{t('Anulo')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showExecutions && executions.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs text-gray-400 mb-2">{t('Ekzekutimet e fundit')}</div>
          <div className="space-y-1.5">{executions.map(renderExecution(t))}</div>
        </div>
      )}
    </div>
  );
}

// Rresht i një ekzekutimi (i përbashkët për të dy seksionet).
function renderExecution(t: (k: string) => string) {
  return (e: TradeExecution) => (
    <div key={e.id} className="text-xs bg-gray-800/40 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`font-bold ${e.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{e.action === 'BUY' ? t('BLEJ') : t('SHIT')}</span>
          <span className="text-white">{e.symbol}</span>
          <span className="text-gray-500">{e.volume} {t('lot')} · {e.mode}</span>
          {e.reason?.startsWith('auto') && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">AUTO</span>}
        </span>
        <span className={`px-2 py-0.5 rounded-full ${e.status === 'executed' ? 'bg-green-500/15 text-green-400' : e.status === 'rejected' ? 'bg-amber-500/15 text-amber-400' : e.status === 'info' ? 'bg-blue-500/15 text-blue-400' : 'bg-red-500/15 text-red-400'}`}>
          {e.status}
        </span>
      </div>
      {/* Arsyeja shfaqet për rreshtat info/rejected (p.sh. broker-trailing, refuzime) */}
      {e.reason && e.status !== 'executed' && (
        <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{e.reason}</div>
      )}
    </div>
  );
}
