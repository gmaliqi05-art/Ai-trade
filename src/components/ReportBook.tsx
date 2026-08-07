// Libër raportesh i ripërdorshëm: filtër date (ditë e caktuar ose interval nga–deri),
// ndarje DITORE (çdo ditë veç), përmbledhje për çdo ditë + përmbledhje e PËRGJITHSHME.
// Përdoret te "Telegram Sin — raportet" dhe te "Hyrjet manuale".
import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/i18n';

export interface ReportRow {
  id: string;
  date: Date;                       // koha e MBYLLJES — përdoret për grupimin ditor + renditjen
  time?: Date;                      // koha që SHFAQET te kolona "Ora" (mbërritja e sinjalit). Nëse mungon, përdoret 'date'.
  label?: string;                   // kanali ose simboli (kolona "Burimi")
  direction?: 'buy' | 'sell' | null;
  entry?: number | null;            // çmimi i hyrjes (null => MKT)
  market?: boolean;                 // hyrja ishte "market"
  sl?: number | null;
  tps?: number[];
  pips?: number | null;             // me shenjë (ngjyra nga shenja, shfaqet vlera absolute)
  net?: number | null;             // fitimi në $ (profit + komision + swap)
  status: string;                   // 'closed' | 'canceled' | ...
  tpHit?: number;                   // TP i prekur (>0)
}

function dayKey(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Summ { n: number; win: number; loss: number; canceled: number; net: number; }
function summarize(list: ReportRow[]): Summ {
  let win = 0, loss = 0, canceled = 0, net = 0;
  for (const r of list) {
    if (r.status === 'canceled') { canceled++; continue; }
    if (r.net != null) { net += r.net; if (r.net >= 0) win++; else loss++; }
  }
  return { n: list.length, win, loss, canceled, net };
}

export default function ReportBook({ rows, lossLabel, cap = 300, defaultToday = false }: {
  rows: ReportRow[];
  lossLabel?: string;               // etiketa e humbjes te "Rezultati" (p.sh. "SL" për Telegram)
  cap?: number;
  defaultToday?: boolean;           // nis me filtrin SOT (Trade Live) — historiku i plotë = Journal
}) {
  const { t } = useI18n();
  const initKey = defaultToday ? dayKey(new Date()) : '';
  const [from, setFrom] = useState(initKey);
  const [to, setTo] = useState(initKey);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => {
        const k = dayKey(r.date);
        if (from && k < from) return false;
        if (to && k > to) return false;
        return true;
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, cap);
  }, [rows, from, to, cap]);

  const days = useMemo(() => {
    const m = new Map<string, ReportRow[]>();
    for (const r of filtered) {
      const k = dayKey(r.date);
      const arr = m.get(k); if (arr) arr.push(r); else m.set(k, [r]);
    }
    return [...m.entries()];
  }, [filtered]);

  const overall = summarize(filtered);
  const todayKey = dayKey(new Date());

  return (
    <div className="space-y-3">
      {/* FILTRI I DATËS: ditë e caktuar ose interval nga–deri + shkurtore */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <label className="flex items-center gap-1 text-gray-400">{t('Nga')}
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
            className="bg-black/30 border border-gray-700 rounded-lg px-2 py-1 text-gray-200 focus:outline-none focus:border-sky-500" />
        </label>
        <label className="flex items-center gap-1 text-gray-400">{t('Deri')}
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
            className="bg-black/30 border border-gray-700 rounded-lg px-2 py-1 text-gray-200 focus:outline-none focus:border-sky-500" />
        </label>
        <button onClick={() => { setFrom(todayKey); setTo(todayKey); }}
          className="px-2 py-1 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700">{t('Sot')}</button>
        <button onClick={() => { setFrom(''); setTo(''); }}
          className="px-2 py-1 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700">{t('Të gjitha')}</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-[11px] text-gray-600 bg-gray-800/30 rounded-lg px-3 py-3 text-center">{t('Asnjë raport për këtë periudhë.')}</div>
      ) : (
        <>
          {days.map(([key, list]) => {
            const s = summarize(list);
            const dd = new Date(key + 'T00:00:00');
            return (
              <div key={key} className="bg-gray-800/20 border border-gray-800 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-white">
                    {dd.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <SummaryPill s={s} t={t} />
                </div>
                <ReportTable list={list} lossLabel={lossLabel} t={t} />
              </div>
            );
          })}

          {/* PËRMBLEDHJA E PËRGJITHSHME (gjithë periudha e filtruar) */}
          <div className="bg-sky-500/[0.06] border border-sky-500/25 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12px] font-bold text-sky-200">{t('Raporti i përgjithshëm')}</span>
            <SummaryPill s={overall} t={t} big />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryPill({ s, t, big }: { s: Summ; t: (k: string, p?: Record<string, unknown>) => string; big?: boolean }) {
  const cls = big ? 'text-[12px]' : 'text-[11px]';
  return (
    <span className={`flex items-center gap-2 flex-wrap ${cls} tabular-nums`}>
      <span className="text-gray-300">{t('Hyrje')}: <b className="text-white">{s.n}</b></span>
      <span className="text-green-400">{t('Profit')}: <b>{s.win}</b></span>
      <span className="text-red-400">{t('Humbje')}: <b>{s.loss}</b></span>
      {s.canceled > 0 && <span className="text-amber-400">{t('Anuluar')}: <b>{s.canceled}</b></span>}
      <span className={`font-bold ${s.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        {t('Bilanci')}: {s.net >= 0 ? '+' : ''}{s.net.toFixed(2)}$
      </span>
    </span>
  );
}

function ReportTable({ list, lossLabel, t }: { list: ReportRow[]; lossLabel?: string; t: (k: string, p?: Record<string, unknown>) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 pr-3 font-medium">{t('Ora')}</th>
            <th className="text-left py-2 pr-3 font-medium">{t('Burimi')}</th>
            <th className="text-left py-2 pr-3 font-medium">{t('Drejtimi')}</th>
            <th className="text-right py-2 pr-3 font-medium">{t('Hyrja')}</th>
            <th className="text-right py-2 pr-3 font-medium">SL</th>
            <th className="text-left py-2 pr-3 font-medium">TP</th>
            <th className="text-right py-2 pr-3 font-medium">Pips</th>
            <th className="text-right py-2 pr-3 font-medium">{t('Fitimi')}</th>
            <th className="text-left py-2 font-medium">{t('Rezultati')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const tps = s.tps ?? [];
            return (
              <tr key={s.id} className="border-b border-gray-800/60">
                <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{(s.time ?? s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-2 pr-3 text-sky-300 whitespace-nowrap">{s.label || '—'}</td>
                <td className={`py-2 pr-3 font-semibold ${s.direction === 'buy' ? 'text-green-400' : s.direction === 'sell' ? 'text-red-400' : 'text-gray-400'}`}>{s.direction ? s.direction.toUpperCase() : '—'}</td>
                <td className="py-2 pr-3 text-right text-gray-300 tabular-nums">{s.market ? 'MKT' : (s.entry ?? '—')}</td>
                <td className="py-2 pr-3 text-right text-gray-300 tabular-nums">{s.sl ?? '—'}</td>
                {/* TP-të e PREKURA bëhen të verdha (tpHit = deri te cili TP arriti trade-i). */}
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {tps.length ? tps.map((tp, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-gray-600"> / </span>}
                      <span className={(s.tpHit ?? 0) > i ? 'text-amber-300 font-bold' : 'text-gray-300'}>{tp}</span>
                    </span>
                  )) : '—'}
                </td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${s.pips == null ? 'text-gray-600' : s.pips >= 0 ? 'text-green-400' : 'text-red-400'}`}>{s.pips == null ? '—' : Math.abs(s.pips)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${s.net == null ? 'text-gray-600' : s.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{s.net == null ? '—' : `${s.net >= 0 ? '+' : ''}${s.net.toFixed(2)}$`}</td>
                <td className="py-2">
                  {s.status === 'canceled'
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">✕ {t('Anuluar')}</span>
                    : (s.tpHit ?? 0) > 0
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">→ TP{s.tpHit}</span>
                      : s.net != null && s.net >= 0
                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">✓ {t('Fitim')}</span>
                        : s.net != null
                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300">{lossLabel || t('Humbje')}</span>
                          : <span className="text-gray-600 text-[10px]">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
