import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Loader2, NotebookPen, Bot, Hand, Scale, Check, LineChart, Wallet, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { loadPositionCloses, checkMetaApiConnection, loadTradeHistory, type PositionCloseRow } from '../services/metaapi';

// JOURNAL — ditari i treiderit (modeli standard i evidencës së një treideri):
//  • Kalendar mujor: çdo ditë tregon P&L neto + numrin e tradeve (jeshile fitim / e kuqe humbje).
//  • Klik mbi ditën → detajet: tabela të NDARA robot / manual, bilancet e secilës, totali,
//    krahasimi robot vs manual (hyrje, fituese, win-rate, bruto +/-, neto, mesatarja) dhe
//    SHËNIMET e ditës (çfarë funksionoi, çfarë jo — praktika bazë e çdo journal-i tregtimi).
// Burimi: position_closes (mbylljet reale nga MT5, me robot/source) — i njëjti si raportet.

interface DayAgg { net: number; count: number; wins: number; }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isRobotTrade = (r: PositionCloseRow) => !!r.robot || (r.source != null && r.source !== 'manual');

export default function JournalPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const today = new Date();
  const [month, setMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  const [rows, setRows] = useState<PositionCloseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selDay, setSelDay] = useState<string>(dayKey(today));
  const [note, setNote] = useState('');
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Shënimet e muajit (ditë → tekst) — pika te kalendari + TABELA e shënimeve poshtë.
  const [monthNotes, setMonthNotes] = useState<Map<string, string>>(new Map());

  // LLOGARIA & DEPOZITAT: bilanci aktual nga MT5 + veprimet e bilancit (depozita/tërheqje) nga
  // historiku i deal-eve (DEAL_TYPE_BALANCE, deri 120 ditë — mosha e llogarisë). Rezultati nga
  // tregtimi = bilanci aktual − (depozita − tërheqje) → pozitiv/negativ ndaj investimit.
  const [acctBalance, setAcctBalance] = useState<number | null>(null);
  const [deposits, setDeposits] = useState<{ count: number; total: number; wdCount: number; wdTotal: number } | null>(null);
  const fetchAccount = useCallback(async () => {
    try {
      const [chk, hist] = await Promise.all([checkMetaApiConnection(), loadTradeHistory(120)]);
      const bal = Number((chk as { account?: { balance?: number } }).account?.balance);
      if (Number.isFinite(bal)) setAcctBalance(bal);
      const deals = (hist as { deals?: Array<{ type?: string; profit?: number }> }).deals;
      if (Array.isArray(deals)) {
        let count = 0, total = 0, wdCount = 0, wdTotal = 0;
        for (const d of deals) {
          if (String(d.type) !== 'DEAL_TYPE_BALANCE') continue;
          const amt = Number(d.profit) || 0;
          if (amt > 0) { count++; total += amt; } else if (amt < 0) { wdCount++; wdTotal += -amt; }
        }
        setDeposits({ count, total, wdCount, wdTotal });
      }
    } catch { /* pa MT5 të lidhur — paneli thjesht s'mbushet */ }
  }, []);
  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  // Mbylljet: dritare e GJERË (120 ditë — sa lejon historiku) → kalendari filtron muajin,
  // grafiku filtron sipas datave/modelit të zgjedhur nga përdoruesi.
  const [allRows, setAllRows] = useState<PositionCloseRow[]>([]);
  const fetchMonth = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const daysBack = Math.ceil((Date.now() - new Date(month.getFullYear(), month.getMonth(), 1).getTime()) / 86400000) + 3;
    const all = await loadPositionCloses(user.id, Math.max(daysBack, 120));
    setAllRows(all);
    const start = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
    setRows(all.filter(r => { const tms = new Date(r.closed_at).getTime(); return tms >= start && tms < end; }));
    setLoading(false);
  }, [user, month]);
  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  // Shënimet e muajit (ditë + tekst) — për pikat te kalendari dhe tabelën e shënimeve.
  useEffect(() => {
    if (!user) return;
    const from = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
    const to = dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    supabase.from('journal_notes').select('day, note').eq('user_id', user.id).gte('day', from).lte('day', to)
      .then(({ data }) => setMonthNotes(new Map(((data ?? []) as { day: string; note: string }[])
        .filter(r => (r.note || '').trim()).map(r => [r.day, r.note]))));
  }, [user, month]);

  // Shënimi i ditës së zgjedhur.
  useEffect(() => {
    if (!user) return;
    setNoteLoaded(false); setNote(''); setNoteSaved(false);
    supabase.from('journal_notes').select('note').eq('user_id', user.id).eq('day', selDay).maybeSingle()
      .then(({ data }) => { setNote((data as { note?: string } | null)?.note ?? ''); setNoteLoaded(true); });
  }, [user, selDay]);

  const saveNote = async () => {
    if (!user) return;
    setNoteBusy(true);
    await supabase.from('journal_notes').upsert({ user_id: user.id, day: selDay, note, updated_at: new Date().toISOString() });
    setNoteBusy(false); setNoteSaved(true);
    setMonthNotes(m => { const n = new Map(m); if (note.trim()) n.set(selDay, note); else n.delete(selDay); return n; });
    setTimeout(() => setNoteSaved(false), 2500);
  };

  // Agregimi për ditë (kalendar).
  const byDay = useMemo(() => {
    const m = new Map<string, DayAgg>();
    for (const r of rows) {
      const k = dayKey(new Date(r.closed_at));
      const a = m.get(k) ?? { net: 0, count: 0, wins: 0 };
      const net = Number(r.net) || 0;
      a.net += net; a.count += 1; if (net > 0) a.wins += 1;
      m.set(k, a);
    }
    return m;
  }, [rows]);

  const monthTotal = useMemo(() => {
    let net = 0, count = 0, wins = 0;
    for (const a of byDay.values()) { net += a.net; count += a.count; wins += a.wins; }
    return { net, count, wins };
  }, [byDay]);

  // GRAFIKU I BILANCIT me FILTRA: datat Nga–Deri + modeli (GoldSniperFX / MMT Super Roboti / Manual).
  // Vlera në boshtin VERTIKAL, data në atë HORIZONTAL. Ditët pa trade mbajnë vlerën e mëparshme.
  const [chartFrom, setChartFrom] = useState<string>(dayKey(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [chartTo, setChartTo] = useState<string>(dayKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [chartModel, setChartModel] = useState<'all' | 'gsf' | 'robot' | 'manual'>('all');
  // Kur ndërrohet muaji në kalendar, grafiku e ndjek (mund t'i ndryshosh datat me dorë pastaj).
  useEffect(() => {
    setChartFrom(dayKey(new Date(month.getFullYear(), month.getMonth(), 1)));
    setChartTo(dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0)));
  }, [month]);
  // Modeli i trade-it: GoldSniperFX (sinjalet nga platforma jote) · MMT Super Roboti (robotët e
  // vetë platformës: Sinjalet/MMT/FastT) · Manual (pa robot).
  const modelOf = (r: PositionCloseRow): 'gsf' | 'robot' | 'manual' =>
    r.robot === 'GoldSniperFX' ? 'gsf' : r.robot ? 'robot' : 'manual';
  const equitySeries = useMemo(() => {
    const filtered = chartModel === 'all' ? allRows : allRows.filter(r => modelOf(r) === chartModel);
    const per = new Map<string, { net: number; count: number }>();
    for (const r of filtered) {
      const k = dayKey(new Date(r.closed_at));
      const a = per.get(k) ?? { net: 0, count: 0 };
      a.net += Number(r.net) || 0; a.count += 1;
      per.set(k, a);
    }
    const from = new Date(chartFrom + 'T12:00:00');
    const toRaw = new Date(chartTo + 'T12:00:00');
    if (!(from.getTime() <= toRaw.getTime())) return [];
    const end = Math.min(toRaw.getTime(), today.getTime());
    const pts: { key: string; d: Date; cum: number; dayNet: number; traded: boolean }[] = [];
    let cum = 0;
    for (let tms = from.getTime(); tms <= end; tms += 86400000) {
      const date = new Date(tms);
      const wd = date.getDay();
      if (wd === 0 || wd === 6) continue; // fundjava — tregu mbyllur
      const k = dayKey(date);
      const a = per.get(k);
      if (a) cum += a.net;
      pts.push({ key: k, d: date, cum: Math.round(cum * 100) / 100, dayNet: a ? Math.round(a.net * 100) / 100 : 0, traded: !!a });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, chartModel, chartFrom, chartTo]);

  // Rrjeta e kalendarit Hën–Pre (tregu i arit mbyllur fundjavën — si modeli i kërkuar).
  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const out: (Date | null)[][] = [];
    let week: (Date | null)[] = [];
    // Pozicioni i ditës së parë (Hën=0 … Pre=4; fundjava kapërcehet).
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      const wd = date.getDay(); // 0=Diel … 6=Shtunë
      if (wd === 0 || wd === 6) continue;
      const idx = wd - 1;
      if (week.length === 0 && out.length === 0 && idx > 0) for (let i = 0; i < idx; i++) week.push(null);
      week.push(date);
      if (idx === 4) { out.push(week); week = []; }
    }
    if (week.length) { while (week.length < 5) week.push(null); out.push(week); }
    return out;
  }, [month]);

  // Detajet e ditës së zgjedhur.
  const dayRows = useMemo(() => rows.filter(r => dayKey(new Date(r.closed_at)) === selDay)
    .sort((a, b) => (a.closed_at || '').localeCompare(b.closed_at || '')), [rows, selDay]);
  const robotRows = dayRows.filter(isRobotTrade);
  const manualRows = dayRows.filter(r => !isRobotTrade(r));

  const agg = (list: PositionCloseRow[]) => {
    let net = 0, wins = 0, losses = 0, grossP = 0, grossL = 0;
    for (const r of list) {
      const n = Number(r.net) || 0; net += n;
      if (n > 0) { wins++; grossP += n; } else if (n < 0) { losses++; grossL += -n; }
    }
    return { count: list.length, net, wins, losses, grossP, grossL,
      winRate: list.length ? Math.round((wins / list.length) * 100) : 0,
      avg: list.length ? net / list.length : 0 };
  };
  const aggR = agg(robotRows), aggM = agg(manualRows), aggAll = agg(dayRows);

  // SL/TP-të e trade-ve të ditës — position_closes s'i mban, prandaj bashkohen nga burimet:
  //  • GoldSniperFX: telegram_trades (pozicioni → sinjali) + telegram_signals (TP1–TP4, tp_hit, SL);
  //  • robotët e tjerë & manualet: trade_executions (SL/TP i vetëm i porosisë).
  interface PosMeta { sl: number | null; tps: number[]; tpHit: number }
  const [posMeta, setPosMeta] = useState<Map<string, PosMeta>>(new Map());
  useEffect(() => {
    if (!user || dayRows.length === 0) { setPosMeta(new Map()); return; }
    const ids = dayRows.map(r => r.position_id);
    let alive = true;
    (async () => {
      const m = new Map<string, PosMeta>();
      try {
        const { data: legs } = await supabase.from('telegram_trades')
          .select('metaapi_position_id, signal_id, stop_loss, take_profit')
          .eq('user_id', user.id).in('metaapi_position_id', ids);
        const legRows = (legs ?? []) as { metaapi_position_id: string | null; signal_id: string | null; stop_loss: number | null; take_profit: number | null }[];
        const sigIds = [...new Set(legRows.map(l => l.signal_id).filter(Boolean))] as string[];
        const sigMap = new Map<string, { tps: number[]; tpHit: number; sl: number | null }>();
        if (sigIds.length) {
          const { data: sigs } = await supabase.from('telegram_signals').select('id, tps, tp_hit, stop_loss').in('id', sigIds);
          for (const s of (sigs ?? []) as { id: string; tps: number[] | null; tp_hit: number | null; stop_loss: number | null }[]) {
            sigMap.set(s.id, { tps: Array.isArray(s.tps) ? s.tps : [], tpHit: s.tp_hit ?? 0, sl: s.stop_loss });
          }
        }
        for (const l of legRows) {
          if (!l.metaapi_position_id) continue;
          const sig = l.signal_id ? sigMap.get(l.signal_id) : undefined;
          m.set(String(l.metaapi_position_id), {
            sl: l.stop_loss ?? sig?.sl ?? null,
            tps: sig?.tps.length ? sig.tps : (l.take_profit != null ? [l.take_profit] : []),
            tpHit: sig?.tpHit ?? 0,
          });
        }
      } catch { /* best-effort */ }
      try {
        const { data: execs } = await supabase.from('trade_executions')
          .select('metaapi_order_id, stop_loss, take_profit')
          .eq('user_id', user.id).in('metaapi_order_id', ids);
        for (const e of (execs ?? []) as { metaapi_order_id: string | null; stop_loss: number | null; take_profit: number | null }[]) {
          const id = String(e.metaapi_order_id ?? '');
          if (!id || m.has(id)) continue;
          m.set(id, { sl: e.stop_loss ?? null, tps: e.take_profit != null ? [e.take_profit] : [], tpHit: 0 });
        }
      } catch { /* best-effort */ }
      if (alive) setPosMeta(m);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selDay, rows]);

  const money = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
  const moneyCls = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
  const fmtT = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
  // Koha e HAPJES: nëse trade-i u hap një ditë tjetër (kaloi natën), trego edhe datën dd.MM.
  const fmtOpen = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return dayKey(d) === selDay ? hm : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
  };
  const monthNames = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
  const selDate = new Date(selDay + 'T12:00:00');
  const prevMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Tabela e tradeve: koha e HAPJES + MBYLLJES, SL dhe TP-të (roboti: TP1–TP4 me theksim të
  // të prekurave; manuali: një TP i vetëm — s'i duhen 4 kolona).
  const TradeTable = ({ list, total, tpCols = 1, showRobot = false }: {
    list: PositionCloseRow[]; total: ReturnType<typeof agg>; tpCols?: number; showRobot?: boolean;
  }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-500 uppercase tracking-wide text-left">
            <th className="py-1.5 pr-3">{t('Hapur')}</th>
            <th className="py-1.5 pr-3">{t('Mbyllur')}</th>
            <th className="py-1.5 pr-3">{t('Simboli')}</th>
            {showRobot && <th className="py-1.5 pr-3">{t('Roboti')}</th>}
            <th className="py-1.5 pr-3">{t('Drejtimi')}</th>
            <th className="py-1.5 pr-3">Lot</th>
            <th className="py-1.5 pr-3">{t('Hyrja')}</th>
            <th className="py-1.5 pr-3">SL</th>
            {Array.from({ length: tpCols }, (_, i) => (
              <th key={i} className="py-1.5 pr-3">{tpCols > 1 ? `TP${i + 1}` : 'TP'}</th>
            ))}
            <th className="py-1.5 pr-3">{t('Dalja')}</th>
            <th className="py-1.5 pr-0 text-right">{t('Neto')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const n = Number(r.net) || 0;
            const meta = posMeta.get(String(r.position_id));
            return (
              <tr key={r.position_id} className="border-t border-gray-800/60">
                <td className="py-1.5 pr-3 text-gray-400 tabular-nums whitespace-nowrap">{fmtOpen(r.opened_at)}</td>
                <td className="py-1.5 pr-3 text-gray-400 tabular-nums whitespace-nowrap">{fmtT(r.closed_at)}</td>
                <td className="py-1.5 pr-3 text-white whitespace-nowrap">{r.symbol || '—'}</td>
                {showRobot && <td className="py-1.5 pr-3 text-gray-300 whitespace-nowrap">{r.robot || t('Manual')}</td>}
                <td className={`py-1.5 pr-3 font-semibold ${(r.action || '').includes('BUY') ? 'text-green-400' : 'text-red-400'}`}>{(r.action || '').includes('BUY') ? t('BLEJ') : t('SHIT')}</td>
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.volume ?? '—'}</td>
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.entry_price ?? '—'}</td>
                <td className="py-1.5 pr-3 text-red-300/80 tabular-nums">{meta?.sl ?? '—'}</td>
                {Array.from({ length: tpCols }, (_, i) => {
                  const tp = meta?.tps[i];
                  const hit = (meta?.tpHit ?? 0) > i; // TP i PREKUR → i verdhë me bold
                  return (
                    <td key={i} className={`py-1.5 pr-3 tabular-nums ${tp == null ? 'text-gray-600' : hit ? 'text-amber-300 font-bold' : 'text-gray-300'}`}>
                      {tp ?? '—'}
                    </td>
                  );
                })}
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.exit_price ?? '—'}</td>
                <td className={`py-1.5 pr-0 text-right font-bold tabular-nums ${moneyCls(n)}`}>{money(n)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-700">
            <td colSpan={8 + tpCols + (showRobot ? 1 : 0)} className="py-1.5 pr-3 text-gray-400">
              {t('Hyrje')}: <span className="text-white font-semibold">{total.count}</span>
              {' · '}<span className="text-green-400">{t('Fituese')}: {total.wins}</span>
              {' · '}<span className="text-red-400">{t('Humbëse')}: {total.losses}</span>
              {' · '}Win rate: <span className="text-amber-400 font-semibold">{total.winRate}%</span>
            </td>
            <td className={`py-1.5 pr-0 text-right font-black tabular-nums ${moneyCls(total.net)}`}>{money(total.net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="p-3 sm:p-5 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarDays className="w-5 h-5 text-amber-400" />
        <h1 className="text-lg font-bold text-white">Journal</h1>
        <span className="text-xs text-gray-500">{t('— ditari i tregtimit: evidencë ditore + shënime')}</span>
        <button onClick={() => { fetchMonth(); fetchAccount(); }} title={t('Rifresko të dhënat reale')}
          className="ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />{t('Rifresko')}
        </button>
      </div>

      {/* DEPOZITAT & BILANCI — një rresht mbi kalendarin: sa herë ka depozituar përdoruesi, totali,
          bilanci aktual dhe rezultati nga tregtimi (pozitiv/negativ ndaj depozitave). */}
      {(acctBalance != null || deposits) && (() => {
        const netDep = deposits ? deposits.total - deposits.wdTotal : null;
        const result = acctBalance != null && netDep != null ? acctBalance - netDep : null;
        return (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
            <div className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-amber-400" />{t('Llogaria — depozitat & rezultati')}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-gray-800/40 rounded-xl p-2.5">
                <div className="text-[10px] text-gray-500 uppercase">{t('Depozitat')}</div>
                <div className="text-sm font-black text-white tabular-nums">
                  {deposits ? <>{deposits.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}$ <span className="text-[10px] text-gray-500 font-semibold">({deposits.count} {t('herë')})</span></> : '—'}
                </div>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-2.5">
                <div className="text-[10px] text-gray-500 uppercase">{t('Tërheqjet')}</div>
                <div className="text-sm font-black text-white tabular-nums">
                  {deposits ? (deposits.wdCount ? <>−{deposits.wdTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}$ <span className="text-[10px] text-gray-500 font-semibold">({deposits.wdCount} {t('herë')})</span></> : '0$') : '—'}
                </div>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-2.5">
                <div className="text-[10px] text-gray-500 uppercase">{t('Bilanci aktual')}</div>
                <div className="text-sm font-black text-white tabular-nums">{acctBalance != null ? `${acctBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}$` : '—'}</div>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-2.5">
                <div className="text-[10px] text-gray-500 uppercase">{t('Rezultati nga tregtimi')}</div>
                {result != null ? (
                  <div className={`text-sm font-black tabular-nums flex items-center gap-1.5 ${moneyCls(result)}`}>
                    {money(result)}
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${result >= 0 ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                      {result >= 0 ? t('POZITIV') : t('NEGATIV')}
                    </span>
                  </div>
                ) : <div className="text-sm font-black text-gray-500">—</div>}
              </div>
            </div>
            <p className="text-[10px] text-gray-600 mt-1.5">{t('Rezultati = bilanci aktual − (depozitat − tërheqjet). Veprimet e bilancit lexohen nga historiku real i MT5.')}</p>
          </div>
        );
      })()}

      {/* KOKA E MUAJIT: navigimi + totali i muajit. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
          <div className="text-white font-bold text-sm">{t(monthNames[month.getMonth()])} {month.getFullYear()}</div>
          <button onClick={nextMonth} className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-gray-800/40 rounded-xl p-2.5">
            <div className="text-[10px] text-gray-500 uppercase">{t('P&L i muajit')}</div>
            <div className={`text-base font-black tabular-nums ${moneyCls(monthTotal.net)}`}>{money(monthTotal.net)}</div>
          </div>
          <div className="bg-gray-800/40 rounded-xl p-2.5">
            <div className="text-[10px] text-gray-500 uppercase">{t('Hyrje')}</div>
            <div className="text-base font-black text-white tabular-nums">{monthTotal.count}</div>
          </div>
          <div className="bg-gray-800/40 rounded-xl p-2.5">
            <div className="text-[10px] text-gray-500 uppercase">Win rate</div>
            <div className="text-base font-black text-amber-400 tabular-nums">{monthTotal.count ? Math.round((monthTotal.wins / monthTotal.count) * 100) : 0}%</div>
          </div>
        </div>

        {/* KALENDARI Hën–Pre. */}
        {loading ? (
          <div className="h-48 bg-gray-800/40 rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-5 gap-1.5 text-center text-[10px] text-gray-500 font-semibold uppercase tracking-wide">
              {[t('Hën'), t('Mar'), t('Mër'), t('Enj'), t('Pre')].map(d => <div key={d}>{d}</div>)}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-5 gap-1.5">
                {week.map((d, di) => {
                  if (!d) return <div key={di} />;
                  const k = dayKey(d);
                  const a = byDay.get(k);
                  const isSel = k === selDay;
                  const isToday = k === dayKey(today);
                  return (
                    <button key={di} onClick={() => setSelDay(k)}
                      className={`rounded-xl p-1.5 sm:p-2 min-h-[3.5rem] flex flex-col items-center justify-between border transition-colors
                        ${isSel ? 'border-amber-500 bg-amber-500/10' : isToday ? 'border-gray-500 bg-gray-800/60' : 'border-transparent bg-gray-800/40 hover:bg-gray-800'}`}>
                      <span className="text-[11px] text-gray-300 font-semibold flex items-center gap-1">
                        {d.getDate()}
                        {monthNotes.has(k) && <span className="w-1 h-1 rounded-full bg-sky-400 inline-block" title={t('Ka shënim')} />}
                      </span>
                      {a ? (
                        <>
                          <span className={`text-[11px] sm:text-xs font-bold tabular-nums ${moneyCls(a.net)}`}>{money(a.net)}</span>
                          <span className="text-[9px] text-gray-500">{a.count} {t('trade')}</span>
                        </>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GRAFIKU I BILANCIT — uljet/ngritjet e P&L-së kumulative ditë-pas-dite, me FILTRA:
          datat Nga–Deri + modeli i trade-ve. Boshtet: VLERA vertikalisht ($), DATA horizontalisht. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <LineChart className="w-4 h-4 text-emerald-400" />{t('Grafiku i bilancit — P&L kumulativ')}
          </div>
          {/* FILTRAT: datat + modeli (GoldSniperFX / MMT Super Roboti / Manual). */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)} title={t('Nga data')}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500" />
            <span className="text-gray-600 text-[11px]">—</span>
            <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)} title={t('Deri më')}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500" />
            <select value={chartModel} onChange={e => setChartModel(e.target.value as typeof chartModel)} title={t('Modeli i trade-ve')}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500">
              <option value="all">{t('Të gjitha')}</option>
              <option value="gsf">GoldSniperFX</option>
              <option value="robot">{t('MMT Super Roboti')}</option>
              <option value="manual">{t('Manual')}</option>
            </select>
          </div>
        </div>

        {equitySeries.length > 1 ? (() => {
          const W = 640, H = 210, L = 56, R = 14, T = 14, B = 30;
          const vals = equitySeries.map(p => p.cum);
          const yMin = Math.min(0, ...vals), yMax = Math.max(0, ...vals);
          const pad = Math.max((yMax - yMin) * 0.1, 1);
          const lo = yMin - pad, hi = yMax + pad;
          const x = (i: number) => L + (i / (equitySeries.length - 1)) * (W - L - R);
          const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
          const path = equitySeries.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(' ');
          const area = `${path} L${x(equitySeries.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
          const lastV = vals[vals.length - 1];
          const col = lastV >= 0 ? '#34d399' : '#f87171';
          const yTicks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
          const xTickIdx = Array.from(new Set([0, Math.round((equitySeries.length - 1) / 4), Math.round((equitySeries.length - 1) / 2), Math.round(3 * (equitySeries.length - 1) / 4), equitySeries.length - 1]));
          const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
          // Pika e ZGJEDHUR (dita e klikuar në kalendar/grafik; ndryshe e fundit) — vlera e bilancit
          // në atë datë + fitim/humbje e asaj dite, të shfaqura lart pranë filtrave.
          const selPt = equitySeries.find(p => p.key === selDay) ?? equitySeries[equitySeries.length - 1];
          return (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2 bg-gray-800/40 rounded-xl px-3 py-2">
                <div className="text-[11px] text-gray-400">
                  {t('Bilanci më')} <span className="text-white font-semibold">{ddmm(selPt.d)}.{selPt.d.getFullYear()}</span>:
                  {' '}<span className={`font-black tabular-nums ${moneyCls(selPt.cum)}`}>{money(selPt.cum)}</span>
                  {selPt.traded && (
                    <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${selPt.dayNet >= 0 ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                      {selPt.dayNet >= 0 ? t('FITIM') : t('HUMBJE')} {money(selPt.dayNet)}
                    </span>
                  )}
                </div>
                <div className={`text-sm font-black tabular-nums ${moneyCls(lastV)}`}>{t('Totali')}: {money(lastV)}</div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('Grafiku i bilancit')}>
                {yTicks.map((v, i) => (
                  <g key={i}>
                    <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#1f2937" strokeWidth="1" />
                    <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#6b7280">{v >= 0 ? '+' : ''}{Math.round(v)}$</text>
                  </g>
                ))}
                {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#4b5563" strokeWidth="1" strokeDasharray="4 3" />}
                <path d={area} fill={col} opacity="0.10" />
                <path d={path} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {equitySeries.map((p, i) => p.traded ? (
                  <circle key={p.key} cx={x(i)} cy={y(p.cum)} r={p.key === selDay ? 4.5 : 3} fill={col} stroke={p.key === selDay ? '#fbbf24' : '#111827'} strokeWidth={p.key === selDay ? 2 : 1}
                    className="cursor-pointer" onClick={() => setSelDay(p.key)}>
                    <title>{`${ddmm(p.d)}: ${money(p.cum)} (${t('dita')}: ${money(p.dayNet)})`}</title>
                  </circle>
                ) : null)}
                {xTickIdx.map(i => equitySeries[i] ? (
                  <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{ddmm(equitySeries[i].d)}</text>
                ) : null)}
              </svg>
              <p className="text-[10px] text-gray-600 mt-1">{t('Kliko një pikë për të hapur detajet e asaj dite. Ditët pa trade mbajnë vlerën e mëparshme (vijë e sheshtë). Historiku mbulon deri ~120 ditë.')}</p>
            </>
          );
        })() : (
          <p className="text-gray-600 text-sm text-center py-4">{t('S\'ka të dhëna për periudhën/modelin e zgjedhur.')}</p>
        )}
      </div>

      {/* DETAJET E DITËS SË ZGJEDHUR. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-white font-bold text-sm">
            {selDate.getDate()} {t(monthNames[selDate.getMonth()])} {selDate.getFullYear()}
          </div>
          <div className={`text-sm font-black tabular-nums ${moneyCls(aggAll.net)}`}>{t('Totali i ditës')}: {money(aggAll.net)}</div>
        </div>

        {dayRows.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-3">{t('Asnjë trade i mbyllur këtë ditë.')}</p>
        ) : (
          <>
            {/* TRADET E ROBOTËVE */}
            <div>
              <div className="text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5"><Bot className="w-4 h-4 text-sky-400" />{t('Tradet e robotëve')}</div>
              {robotRows.length ? <TradeTable list={robotRows} total={aggR} tpCols={4} showRobot /> : <p className="text-gray-600 text-xs py-1">{t('Asnjë trade roboti këtë ditë.')}</p>}
            </div>
            {/* TRADET MANUALE */}
            <div>
              <div className="text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5"><Hand className="w-4 h-4 text-amber-400" />{t('Tradet manuale')}</div>
              {manualRows.length ? <TradeTable list={manualRows} total={aggM} tpCols={1} /> : <p className="text-gray-600 text-xs py-1">{t('Asnjë trade manual këtë ditë.')}</p>}
            </div>

            {/* KRAHASIMI ROBOT vs MANUAL */}
            <div>
              <div className="text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5"><Scale className="w-4 h-4 text-purple-400" />{t('Krahasimi: Robot vs Manual')}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase tracking-wide text-left">
                      <th className="py-1.5 pr-3">{t('Treguesi')}</th>
                      <th className="py-1.5 pr-3 text-right">🤖 {t('Robot')}</th>
                      <th className="py-1.5 pr-3 text-right">✋ {t('Manual')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { l: t('Hyrje'), r: String(aggR.count), m: String(aggM.count) },
                      { l: t('Fituese'), r: String(aggR.wins), m: String(aggM.wins), cls: 'text-green-400' },
                      { l: t('Humbëse'), r: String(aggR.losses), m: String(aggM.losses), cls: 'text-red-400' },
                      { l: 'Win rate', r: `${aggR.winRate}%`, m: `${aggM.winRate}%`, cls: 'text-amber-400' },
                      { l: t('Fitimi bruto'), r: `+${aggR.grossP.toFixed(2)}$`, m: `+${aggM.grossP.toFixed(2)}$`, cls: 'text-green-400' },
                      { l: t('Humbja bruto'), r: `-${aggR.grossL.toFixed(2)}$`, m: `-${aggM.grossL.toFixed(2)}$`, cls: 'text-red-400' },
                      { l: t('Mesatarja / trade'), r: money(aggR.avg), m: money(aggM.avg) },
                    ].map(row => (
                      <tr key={row.l} className="border-t border-gray-800/60">
                        <td className="py-1.5 pr-3 text-gray-400">{row.l}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${row.cls || 'text-white'}`}>{row.r}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${row.cls || 'text-white'}`}>{row.m}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-700">
                      <td className="py-1.5 pr-3 text-gray-300 font-semibold">{t('Bilanci neto')}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums font-black ${moneyCls(aggR.net)}`}>{money(aggR.net)}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums font-black ${moneyCls(aggM.net)}`}>{money(aggM.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* TABELA E SHËNIMEVE TË MUAJIT — sipër editorit (kërkesa e pronarit); klik → hap ditën. */}
      {monthNotes.size > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
          <div className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
            <NotebookPen className="w-4 h-4 text-sky-400" />{t('Shënimet e muajit')}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300">{monthNotes.size}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-wide text-left">
                  <th className="py-1.5 pr-3 whitespace-nowrap">{t('Data')}</th>
                  <th className="py-1.5 pr-3 text-right whitespace-nowrap">{t('P&L i ditës')}</th>
                  <th className="py-1.5 pr-0">{t('Shënimi')}</th>
                </tr>
              </thead>
              <tbody>
                {[...monthNotes.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, txt]) => {
                  const d = new Date(day + 'T12:00:00');
                  const a = byDay.get(day);
                  return (
                    <tr key={day} onClick={() => setSelDay(day)}
                      className={`border-t border-gray-800/60 cursor-pointer hover:bg-gray-800/40 ${day === selDay ? 'bg-amber-500/5' : ''}`}>
                      <td className="py-2 pr-3 text-white font-semibold whitespace-nowrap tabular-nums">
                        {String(d.getDate()).padStart(2, '0')}.{String(d.getMonth() + 1).padStart(2, '0')}.{d.getFullYear()}
                      </td>
                      <td className={`py-2 pr-3 text-right font-bold tabular-nums whitespace-nowrap ${a ? moneyCls(a.net) : 'text-gray-600'}`}>
                        {a ? money(a.net) : '—'}
                      </td>
                      <td className="py-2 pr-0 text-gray-300 whitespace-pre-wrap break-words">{txt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">{t('Kliko një rresht për të hapur ditën përkatëse në kalendar.')}</p>
        </div>
      )}

      {/* SHËNIMET E DITËS — NË FUND, model hamburger (i palosshëm); shkruaj/ruaj shënimin e ditës
          së zgjedhur. Praktika bazë e journal-it: çfarë funksionoi / çfarë jo / plani. */}
      <details className="bg-gray-900 border border-gray-800 rounded-2xl group">
        <summary className="cursor-pointer list-none p-3 sm:p-4 flex items-center gap-1.5 select-none">
          <NotebookPen className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-white">{t('Shënimet e ditës')} — {String(selDate.getDate()).padStart(2, '0')}.{String(selDate.getMonth() + 1).padStart(2, '0')}.{selDate.getFullYear()}</span>
          {monthNotes.has(selDay) && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block" title={t('Ka shënim')} />}
          <ChevronDown className="w-4 h-4 text-gray-400 ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 sm:px-4 pb-4">
          <textarea value={note} onChange={e => { setNote(e.target.value); setNoteSaved(false); }} disabled={!noteLoaded}
            placeholder={t('P.sh.: Çfarë funksionoi sot? Çfarë gabimi bëra? A e ndoqa planin? Emocionet? Mësimi për nesër…')}
            rows={4}
            className="w-full bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 resize-y" />
          <div className="flex items-center gap-2 mt-1.5">
            <button onClick={saveNote} disabled={noteBusy || !noteLoaded}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50">
              {noteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : noteSaved ? <Check className="w-3.5 h-3.5" /> : <NotebookPen className="w-3.5 h-3.5" />}
              {noteSaved ? t('U ruajt') : t('Ruaj shënimin')}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
