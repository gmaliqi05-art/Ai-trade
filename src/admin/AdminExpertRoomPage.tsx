// Super Admin → "Dhoma e Ekspertëve": panel me 4 ekspertë AI (Claude) që analizojnë ÇDO 10
// trade auto që prekën TP/SL, nga kushtet në hyrje → rekomandime për të përmirësuar robotin.
// Vetëm KËSHILLUESE: nuk prek robotin. Analiza niset automatikisht (cron); këtu vetëm shihet.
import { useEffect, useState, useCallback } from 'react';
import { Users, RefreshCw, Loader2, AlertTriangle, ShieldAlert, Clock, Brain, TrendingUp, Lightbulb, ScrollText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n, dtLocale } from '../i18n/i18n';

interface Rec { title: string; detail: string; confidence?: 'low' | 'medium' | 'high' }
interface Expert { role: string; findings: string[] }
interface Payload { experts?: Expert[]; consensus?: string; recommendations?: Rec[]; caution?: string; error?: string; stats?: { winRate?: number; wins?: number; losses?: number } }
interface Analysis { id: string; batch_no: number; trades_count: number; win_rate: number | null; from_time: string | null; to_time: string | null; payload: Payload | null; created_at: string }

const ROLE_ICON: Record<string, React.ElementType> = { 'Rreziku': ShieldAlert, 'Koha & Sesioni': Clock, 'Teknik': Brain, 'Struktura e tregut': TrendingUp };
const ROLE_COLOR: Record<string, string> = { 'Rreziku': 'text-red-400', 'Koha & Sesioni': 'text-amber-400', 'Teknik': 'text-cyan-400', 'Struktura e tregut': 'text-violet-400' };

function confChip(c?: string) {
  if (c === 'high') return 'bg-green-500/15 text-green-400 border-green-500/30';
  if (c === 'medium') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return 'bg-gray-600/20 text-gray-300 border-gray-600/40';
}

export default function AdminExpertRoomPage() {
  const { t } = useI18n();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [pending, setPending] = useState(0);
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (run = false) => {
    if (run) setRunning(true); else setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke('expert-room', { body: run ? { run: true } : {} });
    if (error) setErr(error.message);
    else if ((data as { error?: string })?.error) setErr((data as { error?: string }).error!);
    else {
      setAnalyses(((data as { analyses?: Analysis[] }).analyses) ?? []);
      setPending((data as { pending?: number }).pending ?? 0);
      setBatchSize((data as { batchSize?: number }).batchSize ?? 10);
    }
    if (run) setRunning(false); else setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleString(dtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{t('Dhoma e Ekspertëve')}</h2>
            <p className="text-gray-400 text-sm">{t('4 ekspertë AI analizojnë çdo 10 trade TP/SL → rekomandime për robotin.')}</p>
          </div>
        </div>
        <button onClick={() => load(false)} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Progresi drejt batch-it të radhës */}
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/5 to-gray-900 p-4 space-y-2.5">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-gray-300">{t('Trade të reja TP/SL drejt analizës së radhës')}</span>
          <span className="text-indigo-300 font-semibold">{Math.min(pending, batchSize)}/{batchSize}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-500" style={{ width: `${Math.min(100, (pending / batchSize) * 100)}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-gray-500 text-[11px]">{t('Analiza niset automatikisht çdo 10 trade. Mund ta nisësh edhe manualisht kur ka mjaftueshëm.')}</p>
          <button onClick={() => load(true)} disabled={running || pending < batchSize}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {running ? t('Duke analizuar…') : t('Nis analizën tani')}
          </button>
        </div>
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-gray-900 rounded-2xl animate-pulse" />)}</div>
      ) : analyses.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <Users className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">{t('Ende pa analiza')}</p>
          <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">{t('Sapo të mblidhen 10 trade auto që prekin TP/SL, ekspertët e parë do ta analizojnë grupin automatikisht.')}</p>
        </div>
      ) : (
        analyses.map((a) => {
          const p = a.payload || {};
          return (
            <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              {/* Koka e batch-it */}
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gray-800 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 font-black flex items-center justify-center text-sm">#{a.batch_no}</div>
                  <div>
                    <div className="text-white font-semibold text-sm">{t('Grupi')} #{a.batch_no} · {a.trades_count} {t('trade')}</div>
                    <div className="text-gray-500 text-[11px]">{fmt(a.from_time)} → {fmt(a.to_time)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${(a.win_rate ?? 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>{a.win_rate ?? 0}%</div>
                  <div className="text-[10px] text-gray-500">{t('win-rate')} · {p.stats?.wins ?? '—'}/{a.trades_count}</div>
                </div>
              </div>

              {p.error ? (
                <div className="text-amber-300 text-xs flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{p.error}</div>
              ) : (
                <>
                  {/* 4 ekspertët */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(p.experts ?? []).map((ex, i) => {
                      const Icon = ROLE_ICON[ex.role] || Brain;
                      const col = ROLE_COLOR[ex.role] || 'text-gray-300';
                      return (
                        <div key={i} className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                          <div className={`flex items-center gap-1.5 text-[12px] font-semibold mb-1.5 ${col}`}><Icon className="w-3.5 h-3.5" />{ex.role}</div>
                          <ul className="space-y-1">
                            {(ex.findings ?? []).map((f, j) => <li key={j} className="text-gray-300 text-[12px] flex gap-1.5"><span className={col}>›</span>{f}</li>)}
                          </ul>
                        </div>
                      );
                    })}
                  </div>

                  {/* Konsensusi */}
                  {p.consensus && (
                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3">
                      <div className="text-[11px] uppercase tracking-wide text-indigo-300/80 mb-1 flex items-center gap-1.5"><ScrollText className="w-3.5 h-3.5" />{t('Konsensusi')}</div>
                      <p className="text-gray-200 text-[13px]">{p.consensus}</p>
                    </div>
                  )}

                  {/* Rekomandimet */}
                  {p.recommendations && p.recommendations.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-amber-300/80 mb-1.5 flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" />{t('Rekomandime për robotin')}</div>
                      <div className="space-y-2">
                        {p.recommendations.map((r, i) => (
                          <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-white text-[13px] font-medium">{r.title}</div>
                              {r.confidence && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${confChip(r.confidence)}`}>{r.confidence}</span>}
                            </div>
                            <div className="text-gray-400 text-[12px] mt-0.5">{r.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {p.caution && (
                    <div className="flex items-start gap-2 text-[12px] bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg p-2.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{p.caution}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}

      <p className="text-gray-600 text-[11px] text-center">{t('Vetëm këshilluese — rekomandimet NUK aplikohen vetë te roboti. Ti vendos çfarë të ndryshosh dhe validoje në DEMO.')}</p>
    </div>
  );
}
