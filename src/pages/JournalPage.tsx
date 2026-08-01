import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, NotebookPen, Bot, Hand, Scale, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { loadPositionCloses, type PositionCloseRow } from '../services/metaapi';

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
  // Ditët që kanë shënim (pika te kalendari) — ngarkohen për muajin.
  const [noteDays, setNoteDays] = useState<Set<string>>(new Set());

  // Mbylljet e muajit të zgjedhur (± disa ditë buferi për zonat orare).
  const fetchMonth = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const daysBack = Math.ceil((Date.now() - new Date(month.getFullYear(), month.getMonth(), 1).getTime()) / 86400000) + 3;
    const all = await loadPositionCloses(user.id, Math.max(daysBack, 8));
    const start = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
    setRows(all.filter(r => { const tms = new Date(r.closed_at).getTime(); return tms >= start && tms < end; }));
    setLoading(false);
  }, [user, month]);
  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  // Ditët me shënime për muajin (shënohen me pikë në kalendar).
  useEffect(() => {
    if (!user) return;
    const from = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
    const to = dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    supabase.from('journal_notes').select('day').eq('user_id', user.id).gte('day', from).lte('day', to)
      .then(({ data }) => setNoteDays(new Set(((data ?? []) as { day: string }[]).map(r => r.day))));
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
    setNoteDays(s => { const n = new Set(s); if (note.trim()) n.add(selDay); else n.delete(selDay); return n; });
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

  const money = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
  const moneyCls = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
  const fmtT = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
  const monthNames = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
  const selDate = new Date(selDay + 'T12:00:00');
  const prevMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Tabela e tradeve (e njëjta strukturë për robot & manual).
  const TradeTable = ({ list, total }: { list: PositionCloseRow[]; total: ReturnType<typeof agg> }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-500 uppercase tracking-wide text-left">
            <th className="py-1.5 pr-3">{t('Ora')}</th>
            <th className="py-1.5 pr-3">{t('Simboli')}</th>
            <th className="py-1.5 pr-3">{t('Roboti')}</th>
            <th className="py-1.5 pr-3">{t('Drejtimi')}</th>
            <th className="py-1.5 pr-3">Lot</th>
            <th className="py-1.5 pr-3">{t('Hyrja')}</th>
            <th className="py-1.5 pr-3">{t('Dalja')}</th>
            <th className="py-1.5 pr-0 text-right">{t('Neto')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const n = Number(r.net) || 0;
            return (
              <tr key={r.position_id} className="border-t border-gray-800/60">
                <td className="py-1.5 pr-3 text-gray-400 tabular-nums whitespace-nowrap">{fmtT(r.closed_at)}</td>
                <td className="py-1.5 pr-3 text-white whitespace-nowrap">{r.symbol || '—'}</td>
                <td className="py-1.5 pr-3 text-gray-300 whitespace-nowrap">{r.robot || t('Manual')}</td>
                <td className={`py-1.5 pr-3 font-semibold ${(r.action || '').includes('BUY') ? 'text-green-400' : 'text-red-400'}`}>{(r.action || '').includes('BUY') ? t('BLEJ') : t('SHIT')}</td>
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.volume ?? '—'}</td>
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.entry_price ?? '—'}</td>
                <td className="py-1.5 pr-3 text-gray-300 tabular-nums">{r.exit_price ?? '—'}</td>
                <td className={`py-1.5 pr-0 text-right font-bold tabular-nums ${moneyCls(n)}`}>{money(n)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-700">
            <td colSpan={7} className="py-1.5 pr-3 text-gray-400">
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
      <div className="flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-amber-400" />
        <h1 className="text-lg font-bold text-white">Journal</h1>
        <span className="text-xs text-gray-500">{t('— ditari i tregtimit: evidencë ditore + shënime')}</span>
      </div>

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
                        {noteDays.has(k) && <span className="w-1 h-1 rounded-full bg-sky-400 inline-block" title={t('Ka shënim')} />}
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
              {robotRows.length ? <TradeTable list={robotRows} total={aggR} /> : <p className="text-gray-600 text-xs py-1">{t('Asnjë trade roboti këtë ditë.')}</p>}
            </div>
            {/* TRADET MANUALE */}
            <div>
              <div className="text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5"><Hand className="w-4 h-4 text-amber-400" />{t('Tradet manuale')}</div>
              {manualRows.length ? <TradeTable list={manualRows} total={aggM} /> : <p className="text-gray-600 text-xs py-1">{t('Asnjë trade manual këtë ditë.')}</p>}
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

        {/* SHËNIMET E DITËS — praktika bazë e journal-it: çfarë funksionoi / çfarë jo / plani. */}
        <div>
          <div className="text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5"><NotebookPen className="w-4 h-4 text-emerald-400" />{t('Shënimet e ditës')}</div>
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
      </div>
    </div>
  );
}
