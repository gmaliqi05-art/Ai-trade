// Paneli i pozicioneve të hapura LIVE nga MT5 (përmes MetaApi) + ekzekutimet e fundit.
// Përdoret te faqja "Tregto Live". Mund të shfaqet i ndarë me `section`:
//  - "positions"  → vetëm pozicionet e hapura (me mbyllje)
//  - "executions" → vetëm ekzekutimet e fundit
//  - "both" (default) → të dyja bashkë
import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, RefreshCw, X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useAuth } from '../context/AuthContext';
import { loadOpenPositions, closePosition, loadExecutions, loadPendingOrders, cancelOrder, loadSymbolPrice, type OpenPosition, type PendingOrder, type TradeExecution } from '../services/metaapi';
import { metaStream } from '../services/metaStream';
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
  // Çmimi LIVE i broker-it (bid/ask) për simbolet e pozicioneve — për P&L real-time.
  const [pxMap, setPxMap] = useState<Record<string, { bid: number; ask: number }>>({});
  const [pxAt, setPxAt] = useState(0);                 // koha (ms) e çmimit të fundit LIVE të suksesshëm
  const [pxClock, setPxClock] = useState(Date.now());  // rrah çdo 2s për të rivlerësuar freskinë
  const [posErr, setPosErr] = useState(false);         // leximi i parë dështoi → trego gabim + Riprovo
  const lastMidRef = useRef<Record<string, number>>({}); // mid i fundit për simbol → zbulon LËVIZJEN
  const PX_FRESH_MS = 8000; // "i freskët" = çmimi LËVIZ brenda kësaj kohe (frozen=mbyllur → jo-live)
  const pxFresh = pxAt > 0 && (pxClock - pxAt) < PX_FRESH_MS;
  // Lidhja DIREKTE streaming (websocket) — burimi parësor real-time; REST mbetet vetëm rezervë.
  const stream = useMetaStream();
  const streamLive = stream.status === 'live';
  // "I shëndetshëm" = i lidhur DHE jep tick-e të freskëta (< 6s); vetëm atëherë fiket REST-i.
  const streamHealthy = streamLive && stream.lastTickAt > 0 && (stream.updatedAt - stream.lastTickAt < 6000);

  const showPositions = section === 'positions' || section === 'both';
  const showExecutions = section === 'executions' || section === 'both';

  const refreshPositions = useCallback(async () => {
    if (!configured) return;
    setPosLoading(true);
    const [pr, or] = await Promise.all([loadOpenPositions(), loadPendingOrders()]);
    // Përditëso VETËM kur leximi është i suksesshëm. Në gabim/timeout KALIMTAR të MetaApi
    // (p.sh. 502), RUAJ pozicionet e fundit — mos i fshi, që të mos pulsojnë/zhduken nga ekrani.
    // Lista zbrazet vetëm kur MetaApi kthen me sukses 0 pozicione (d.m.th. u mbyllën vërtet).
    if (!pr.error && Array.isArray(pr.positions)) { setPositions(pr.positions); setPosLoaded(true); setPosErr(false); }
    else setPosErr(true);
    if (!or.error && Array.isArray(or.orders)) setOrders(or.orders);
    setPosLoading(false);
  }, [configured]);

  const refreshExecutions = useCallback(async () => {
    if (user) setExecutions(await loadExecutions(user.id, 8));
  }, [user]);

  // STREAMING: pozicionet + çmimet real-time nga websocket-i (pa polling) kur jep tick-e të freskëta.
  useEffect(() => {
    if (!streamHealthy || !showPositions) return;
    setPositions(stream.positions as unknown as OpenPosition[]);
    setPosLoaded(true); setPosErr(false);
    const pm: Record<string, { bid: number; ask: number }> = {};
    for (const [s, p] of Object.entries(stream.prices)) pm[s] = { bid: p.bid, ask: p.ask };
    if (Object.keys(pm).length) setPxMap(prev => ({ ...prev, ...pm }));
    if (stream.lastTickAt > 0) setPxAt(stream.lastTickAt);
    setPxClock(Date.now());
  }, [streamHealthy, showPositions, stream.updatedAt]);

  // Abono te streaming-u çdo simbol që ka pozicion → marrim bid/ask real-time për P&L-në e tij.
  const posSymKey0 = positions.map(p => p.symbol).filter(Boolean).sort().join(',');
  useEffect(() => {
    if (!streamLive) return;
    for (const s of posSymKey0.split(',')) if (s) void metaStream.subscribeSymbol(s);
  }, [streamLive, posSymKey0]);

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

  // Çmimi LIVE i broker-it (bid/ask) për simbolet e pozicioneve — çdo 2s. Bën P&L-në real-time
  // (pozicionet nga MT5 lexohen çdo 4s; ky çmim e përditëson P&L mes leximeve që ekrani të mos vonohet).
  const posSymbolsKey = Array.from(new Set(positions.map((p) => p.symbol).filter(Boolean))).sort().join(',');
  useEffect(() => {
    if (!configured || streamHealthy || !showPositions || !posSymbolsKey) return;
    let alive = true;
    const syms = posSymbolsKey.split(',');
    const tick = async () => {
      const res = await Promise.all(syms.map(async (s) => {
        try {
          const r = await loadSymbolPrice(s);
          const px = (r as { price?: { bid?: number; ask?: number } })?.price;
          const bid = Number(px?.bid), ask = Number(px?.ask);
          return [s, bid > 0 && ask > 0 ? { bid, ask } : null] as const;
        } catch { return [s, null] as const; }
      }));
      if (!alive) return;
      // "I freskët" VETËM kur ndonjë simbol LËVIZ (mid ndryshon). Çmim i ngrirë = treg i mbyllur → jo-live.
      let anyMoved = false;
      for (const [s, v] of res) {
        if (!v) continue;
        const mid = (v.bid + v.ask) / 2;
        if (lastMidRef.current[s] == null || Math.abs(mid - lastMidRef.current[s]) > 1e-9) anyMoved = true;
        lastMidRef.current[s] = mid;
      }
      setPxMap((prev) => { const n = { ...prev }; for (const [s, v] of res) if (v) n[s] = v; return n; });
      if (anyMoved) setPxAt(Date.now());
      setPxClock(Date.now()); // rivlerëso freskinë edhe kur leximi dështon
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [configured, streamHealthy, showPositions, posSymbolsKey]);

  // P&L real-time: kalibron "euro për njësi çmimi" nga fitimi i SAKTË i broker-it (që përfshin
  // monedhën/spread/komisionin), pastaj e aplikon te çmimi LIVE (bid për BLEJ, ask për SHIT).
  // Kështu numri përkon me mbylljen reale. Pa çmim live ose pozicion shumë i ri → fitimi i broker-it.
  // Kthen P&L-në VETËM kur çmimi live është i freskët; përndryshe null → UI tregon "jo-live"
  // (s'shfaqet fitim i rremë nga çmim i ngrirë; numri përkon me mbylljen reale).
  const livePnl = (p: OpenPosition): number | null => {
    const px = pxMap[p.symbol];
    if (!pxFresh) return null;                  // çmimi jo-live → mos shfaq numër (mos mashtro)
    const brokerProfit0 = Number(p.profit ?? 0);
    if (!px) return brokerProfit0;              // s'ka bid/ask por çmimi është live → fitimi real-time i broker-it
    const open = Number(p.openPrice), cur = Number(p.currentPrice);
    const brokerProfit = Number(p.profit ?? 0);
    const isBuy = (p.type || '').includes('BUY');
    if (Number.isFinite(open) && Number.isFinite(cur)) {
      const dist = (cur - open) * (isBuy ? 1 : -1);
      if (Math.abs(dist) >= 0.05) {
        const eurPerUnit = brokerProfit / dist;
        const closePx = isBuy ? px.bid : px.ask;
        return ((closePx - open) * (isBuy ? 1 : -1)) * eurPerUnit;
      }
    }
    return brokerProfit;
  };

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
          {pxFresh ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400" title={t('Çmimi live direkt nga MT5; mbyllja bëhet me çmimin real të tregut')}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{streamHealthy ? t('DIREKT ●') : t('live · 2s')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-amber-400" title={t('Çmimi NUK është live — mos mbyll në vlerën e shfaqur derisa të kthehet "live"')}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />{t('jo-live — mos mbyll')}
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
            return (
              <div key={p.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  {isBuy ? <TrendingUp className="w-3.5 h-3.5 text-green-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? t('BLEJ') : t('SHIT')}</span>
                  <span className="text-white">{p.symbol}</span>
                  <span className="text-gray-300">{p.volume} {t('lot')}</span>
                  {p.openPrice != null && <span className="text-gray-400">@ {p.openPrice}</span>}
                </span>
                <span className="flex items-center gap-3">
                  {profit == null ? (
                    <span className="flex items-center gap-1 text-gray-500 font-semibold" title={t('Çmimi NUK është live — mos u beso kësaj vlere')}>
                      <Clock className="w-3 h-3" />{t('jo-live')}
                    </span>
                  ) : (
                    <span className={`font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                    </span>
                  )}
                  <button onClick={() => handleClose(p.id)} disabled={closingId === p.id}
                    className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg font-medium transition-all disabled:opacity-50">
                    {closingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}{t('Mbyll')}
                  </button>
                </span>
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
