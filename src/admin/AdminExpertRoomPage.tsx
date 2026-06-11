// Super Admin → "Dhoma e Ekspertëve" (v2 — korporata): 6 ekspertë elitarë me doktrina të
// hulumtuara nga dija publike (Claude deep-research), analiza e çdo 10 trade-ve TP/SL,
// grafikë e krahasime, dhe SUPER INFORMATORI (sinteza e dijes) me çelës ON/OFF (skelet —
// asnjë motor s'e lexon ende; S'TREGTON). Vetëm këshilluese: roboti aktual nuk preket.
import { useEffect, useState, useCallback } from 'react';
import {
  Users, RefreshCw, Loader2, AlertTriangle, Brain, TrendingUp, Lightbulb, ScrollText,
  BookOpenCheck, BarChart3, Database, Power, ShieldCheck, GraduationCap, Sparkles,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n, dtLocale } from '../i18n/i18n';

interface Rec { title: string; detail: string; confidence?: 'low' | 'medium' | 'high' }
interface ExpertFinding { slug?: string; role: string; findings: string[] }
interface Pattern { name: string; desc: string }
interface Payload { experts?: ExpertFinding[]; consensus?: string; patterns?: Pattern[]; recommendations?: Rec[]; caution?: string; error?: string;
  stats?: { winRate?: number; wins?: number; losses?: number; tpAvgAdx?: number | null; slAvgAdx?: number | null; tpAvgEr?: number | null; slAvgEr?: number | null; tpAvgAtr?: number | null; slAvgAtr?: number | null } }
interface Analysis { id: string; batch_no: number; trades_count: number; win_rate: number | null; from_time: string | null; to_time: string | null; payload: Payload | null; created_at: string }
interface Doctrine { principles?: string[]; rules?: string[]; entry_models?: { name: string; desc: string }[]; risk?: string[]; applies_to_bot?: string[]; note?: string }
interface Profile { slug: string; name: string; methodology: string | null; doctrine: Doctrine | null; researched_at?: string | null }
interface Synthesis { core_rules?: string[]; trading_models?: { name: string; desc: string; conditions?: string[] }[]; do?: string[]; dont?: string[];
  robot_mapping?: { param: string; suggestion: string; basis?: string }[]; readiness?: { score?: number; missing?: string[] }; caution?: string }
interface Knowledge { id: string; payload: Synthesis | null; created_at: string }

type Tab = 'overview' | 'experts' | 'analyses' | 'charts' | 'informator';

function confChip(c?: string) {
  if (c === 'high') return 'bg-green-500/15 text-green-400 border-green-500/30';
  if (c === 'medium') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return 'bg-gray-600/20 text-gray-300 border-gray-600/40';
}

// Krahasim TP vs SL i një metrike (bar të dyfishtë) — për "Grafikët".
function CompareBars({ label, tp, sl, unit }: { label: string; tp: number | null | undefined; sl: number | null | undefined; unit?: string }) {
  const max = Math.max(Math.abs(tp ?? 0), Math.abs(sl ?? 0)) || 1;
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-gray-400">{label}</div>
      {[{ k: 'TP', v: tp, c: 'bg-green-500' }, { k: 'SL', v: sl, c: 'bg-red-500' }].map((b) => (
        <div key={b.k} className="flex items-center gap-2">
          <span className={`w-7 text-[10px] font-bold ${b.k === 'TP' ? 'text-green-400' : 'text-red-400'}`}>{b.k}</span>
          <div className="flex-1 h-4 bg-gray-950 rounded overflow-hidden">
            <div className={`h-full ${b.c} opacity-80`} style={{ width: `${Math.min(100, (Math.abs(b.v ?? 0) / max) * 100)}%` }} />
          </div>
          <span className="w-14 text-right text-[11px] text-gray-300">{b.v != null ? `${b.v}${unit ?? ''}` : '—'}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminExpertRoomPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [profs, setProfs] = useState<Profile[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [autotrade, setAutotrade] = useState(false);
  const [pending, setPending] = useState(0);
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 'run' | 'research' | 'synthesize' | 'toggle'
  const [err, setErr] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>, busyKey: string | null) => {
    if (busyKey) setBusy(busyKey); else setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke('expert-room', { body });
    if (error) setErr(error.message);
    else if ((data as { error?: string })?.error) setErr((data as { error?: string }).error!);
    else {
      const d = data as { analyses?: Analysis[]; profiles?: Profile[]; knowledge?: Knowledge | null; pending?: number; batchSize?: number; autotrade?: boolean };
      setAnalyses(d.analyses ?? []); setProfs(d.profiles ?? []); setKnowledge(d.knowledge ?? null);
      setPending(d.pending ?? 0); setBatchSize(d.batchSize ?? 10); setAutotrade(!!d.autotrade);
    }
    if (busyKey) setBusy(null); else setLoading(false);
  }, []);

  useEffect(() => { call({}, null); }, [call]);

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleString(dtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const researched = profs.filter(p => p.doctrine).length;
  const totalRecs = analyses.reduce((s, a) => s + ((a.payload?.recommendations?.length) || 0), 0);
  const syn = knowledge?.payload || null;
  const latestStats = analyses[0]?.payload?.stats;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: t('Përmbledhje'), icon: BarChart3 },
    { id: 'experts', label: t('Ekspertët'), icon: GraduationCap },
    { id: 'analyses', label: t('Analizat'), icon: Brain },
    { id: 'charts', label: t('Grafikët'), icon: TrendingUp },
    { id: 'informator', label: t('Super Informatori'), icon: Database },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* Koka e korporatës */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{t('Dhoma e Ekspertëve')}</h2>
            <p className="text-gray-400 text-sm">{t('Korporata këshilluese: doktrina elitare + trade reale → dije e konsoliduar.')}</p>
          </div>
        </div>
        <button onClick={() => call({}, null)} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigimi i sektorëve */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((tb) => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl whitespace-nowrap transition-colors ${tab === tb.id ? 'bg-indigo-500 text-white' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}>
              <Icon className="w-3.5 h-3.5" />{tb.label}
            </button>
          );
        })}
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{err}</div>}

      {/* ============ PËRMBLEDHJE ============ */}
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: t('Grupe të analizuara'), v: String(analyses.length) },
              { k: t('Ekspertë me doktrinë'), v: `${researched}/${profs.length}` },
              { k: t('Rekomandime gjithsej'), v: String(totalRecs) },
              { k: t('Gatishmëria'), v: syn?.readiness?.score != null ? `${syn.readiness.score}/100` : '—', c: 'text-violet-300' },
            ].map((c) => (
              <div key={c.k} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{c.k}</div>
                <div className={`text-lg font-bold mt-0.5 ${c.c ?? 'text-white'}`}>{c.v}</div>
              </div>
            ))}
          </div>

          {/* Progresi drejt batch-it + butoni */}
          <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/5 to-gray-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-gray-300">{t('Trade të reja TP/SL drejt analizës së radhës')}</span>
              <span className="text-indigo-300 font-semibold">{Math.min(pending, batchSize)}/{batchSize}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-500" style={{ width: `${Math.min(100, (pending / batchSize) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-end">
              <button onClick={() => call({ run: true }, 'run')} disabled={busy != null || pending < batchSize}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40">
                {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}{t('Nis analizën tani')}
              </button>
            </div>
          </div>

          {/* Win-rate për grup (trend) */}
          {analyses.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-white font-semibold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-400" />{t('Win-rate sipas grupeve')}</div>
              <div className="flex items-end gap-2 h-28">
                {[...analyses].reverse().slice(-12).map((a) => (
                  <div key={a.id} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-gray-950 rounded-t flex items-end" style={{ height: '88px' }}>
                      <div className={`w-full rounded-t ${(a.win_rate ?? 0) >= 50 ? 'bg-green-500/70' : 'bg-red-500/70'}`} style={{ height: `${Math.max(4, (a.win_rate ?? 0))}%` }} />
                    </div>
                    <span className="text-[9px] text-gray-500">#{a.batch_no}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ EKSPERTËT ============ */}
      {tab === 'experts' && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-gray-400 text-[12px] max-w-xl">{t('Hulumtimi i thellë (Claude) mbledh parimet, rregullat dhe modelet PUBLIKE të secilës metodologji dhe i ruan si doktrinë — që paneli të analizojë me to.')}</p>
            <button onClick={() => call({ research: true }, 'research')} disabled={busy != null}
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40">
              {busy === 'research' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpenCheck className="w-4 h-4" />}
              {busy === 'research' ? t('Duke hulumtuar…') : t('Hulumto doktrinat')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profs.map((p) => (
              <div key={p.slug} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-white font-semibold text-[13px] leading-snug">{p.name}</div>
                    <div className="text-gray-500 text-[11px] mt-0.5">{p.methodology}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${p.doctrine ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-gray-600/20 text-gray-400 border-gray-600/40'}`}>
                    {p.doctrine ? t('Doktrinë gati') : t('Pa doktrinë')}
                  </span>
                </div>
                {p.doctrine && (
                  <div className="space-y-1.5">
                    {(p.doctrine.principles || []).slice(0, 3).map((x, i) => (
                      <div key={i} className="text-gray-300 text-[12px] flex gap-1.5"><span className="text-violet-400">›</span>{x}</div>
                    ))}
                    {(p.doctrine.applies_to_bot || []).slice(0, 2).map((x, i) => (
                      <div key={i} className="text-[12px] flex gap-1.5 text-cyan-300"><Sparkles className="w-3 h-3 mt-0.5 shrink-0" />{x}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ============ ANALIZAT ============ */}
      {tab === 'analyses' && (
        analyses.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <Users className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-white font-medium">{t('Ende pa analiza')}</p>
            <p className="text-gray-500 text-sm mt-1">{t('Sapo të mblidhen 10 trade auto që prekin TP/SL, ekspertët e parë do ta analizojnë grupin automatikisht.')}</p>
          </div>
        ) : analyses.map((a) => {
          const p = a.payload || {};
          return (
            <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gray-800 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 font-black flex items-center justify-center text-sm">#{a.batch_no}</div>
                  <div>
                    <div className="text-white font-semibold text-sm">{t('Grupi')} #{a.batch_no} · {a.trades_count} {t('trade')}</div>
                    <div className="text-gray-500 text-[11px]">{fmt(a.from_time)} → {fmt(a.to_time)}</div>
                  </div>
                </div>
                <div className={`text-lg font-bold ${(a.win_rate ?? 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>{a.win_rate ?? 0}%</div>
              </div>
              {p.error ? <div className="text-amber-300 text-xs flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{p.error}</div> : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(p.experts ?? []).map((ex, i) => (
                      <div key={i} className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-1.5 text-violet-300"><Brain className="w-3.5 h-3.5" />{ex.role}</div>
                        <ul className="space-y-1">{(ex.findings ?? []).map((f, j) => <li key={j} className="text-gray-300 text-[12px] flex gap-1.5"><span className="text-violet-400">›</span>{f}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                  {(p.patterns ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(p.patterns ?? []).map((pt, i) => (
                        <div key={i} className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-2.5 py-1.5 text-[12px]"><b className="text-cyan-300">{pt.name}:</b> <span className="text-gray-300">{pt.desc}</span></div>
                      ))}
                    </div>
                  )}
                  {p.consensus && (
                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3">
                      <div className="text-[11px] uppercase tracking-wide text-indigo-300/80 mb-1 flex items-center gap-1.5"><ScrollText className="w-3.5 h-3.5" />{t('Konsensusi')}</div>
                      <p className="text-gray-200 text-[13px]">{p.consensus}</p>
                    </div>
                  )}
                  {(p.recommendations ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-wide text-amber-300/80 flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" />{t('Rekomandime për robotin')}</div>
                      {(p.recommendations ?? []).map((r, i) => (
                        <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-white text-[13px] font-medium">{r.title}</div>
                            {r.confidence && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${confChip(r.confidence)}`}>{r.confidence}</span>}
                          </div>
                          <div className="text-gray-400 text-[12px] mt-0.5">{r.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.caution && <div className="flex items-start gap-2 text-[12px] bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg p-2.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{p.caution}</div>}
                </>
              )}
            </div>
          );
        })
      )}

      {/* ============ GRAFIKËT ============ */}
      {tab === 'charts' && (
        latestStats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="text-white font-semibold text-sm">{t('Çfarë i ndan fituesit nga humbësit (grupi i fundit)')}</div>
              <CompareBars label={t('ADX mesatar (forca e trendit)')} tp={latestStats.tpAvgAdx} sl={latestStats.slAvgAdx} />
              <CompareBars label={t('Efficiency Ratio mesatar')} tp={latestStats.tpAvgEr} sl={latestStats.slAvgEr} />
              <CompareBars label={t('ATR% mesatar (volatiliteti)')} tp={latestStats.tpAvgAtr} sl={latestStats.slAvgAtr} unit="%" />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-white font-semibold text-sm mb-3">{t('Win-rate sipas grupeve')}</div>
              <div className="space-y-1.5">
                {analyses.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="w-8 text-[10px] text-gray-500">#{a.batch_no}</span>
                    <div className="flex-1 h-4 bg-gray-950 rounded overflow-hidden">
                      <div className={`${(a.win_rate ?? 0) >= 50 ? 'bg-green-500' : 'bg-red-500'} h-full opacity-80`} style={{ width: `${a.win_rate ?? 0}%` }} />
                    </div>
                    <span className="w-10 text-right text-[11px] text-gray-300">{a.win_rate ?? 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center text-gray-500 text-sm">{t('Grafikët shfaqen pas analizës së parë.')}</div>
      )}

      {/* ============ SUPER INFORMATORI ============ */}
      {tab === 'informator' && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-gray-400 text-[12px] max-w-xl">{t('Sinteza: doktrinat e ekspertëve + analizat e trade-ve reale → baza e dijes që një ditë mund të drejtojë robotin e dhomës.')}</p>
            <button onClick={() => call({ synthesize: true }, 'synthesize')} disabled={busy != null}
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-400 disabled:opacity-40">
              {busy === 'synthesize' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {busy === 'synthesize' ? t('Duke sintetizuar…') : t('Rindërto sintezën')}
            </button>
          </div>

          {/* Çelësi ON/OFF (skelet) */}
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-gray-900 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Power className={`w-5 h-5 ${autotrade ? 'text-green-400' : 'text-gray-500'}`} />
              <div>
                <div className="text-white font-semibold text-sm">{t('Auto-trade i Dhomës (e ardhmja)')}</div>
                <div className="text-gray-500 text-[11px]">{t('SKELET: çelësi ruhet por ASNJË motor s\'e lexon ende — s\'tregton. Aktivizimi real do kërkojë gatishmëri + miratimin tënd.')}</div>
              </div>
            </div>
            <button onClick={() => call({ set_autotrade: !autotrade }, 'toggle')} disabled={busy != null}
              className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${autotrade ? 'bg-green-500' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${autotrade ? 'translate-x-7' : ''}`} />
            </button>
          </div>

          {!syn ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center text-gray-500 text-sm">{t('Ende pa sintezë — kliko "Rindërto sintezën" pasi ekspertët të kenë doktrina dhe të ketë analiza.')}</div>
          ) : (
            <div className="space-y-3">
              {syn.readiness && (
                <div className="bg-gray-900 border border-violet-500/25 rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <span className="text-gray-300 font-semibold">{t('Gatishmëria për aktivizim')}</span>
                    <span className="text-violet-300 font-bold">{syn.readiness.score ?? 0}/100</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-500" style={{ width: `${syn.readiness.score ?? 0}%` }} />
                  </div>
                  {(syn.readiness.missing ?? []).map((m, i) => <div key={i} className="text-gray-400 text-[12px] flex gap-1.5"><span className="text-amber-400">•</span>{m}</div>)}
                </div>
              )}
              {(syn.core_rules ?? []).length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <div className="text-[11px] uppercase tracking-wide text-fuchsia-300/80 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />{t('Rregullat thelbësore')}</div>
                  <ul className="space-y-1">{(syn.core_rules ?? []).map((r, i) => <li key={i} className="text-gray-200 text-[13px] flex gap-2"><span className="text-fuchsia-400">→</span>{r}</li>)}</ul>
                </div>
              )}
              {(syn.trading_models ?? []).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(syn.trading_models ?? []).map((m, i) => (
                    <div key={i} className="bg-gray-950 border border-cyan-500/20 rounded-xl p-3">
                      <div className="text-cyan-300 font-semibold text-[13px]">{m.name}</div>
                      <div className="text-gray-400 text-[12px] mt-0.5">{m.desc}</div>
                      {(m.conditions ?? []).map((c, j) => <div key={j} className="text-gray-500 text-[11px] flex gap-1.5 mt-0.5"><span className="text-cyan-500">·</span>{c}</div>)}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(syn.do ?? []).length > 0 && (
                  <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3">
                    <div className="text-green-400 text-[11px] font-bold uppercase mb-1.5">{t('Bëj')}</div>
                    {(syn.do ?? []).map((x, i) => <div key={i} className="text-gray-300 text-[12px] flex gap-1.5"><span className="text-green-400">✓</span>{x}</div>)}
                  </div>
                )}
                {(syn.dont ?? []).length > 0 && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                    <div className="text-red-400 text-[11px] font-bold uppercase mb-1.5">{t('Mos bëj')}</div>
                    {(syn.dont ?? []).map((x, i) => <div key={i} className="text-gray-300 text-[12px] flex gap-1.5"><span className="text-red-400">✗</span>{x}</div>)}
                  </div>
                )}
              </div>
              {(syn.robot_mapping ?? []).length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <div className="text-[11px] uppercase tracking-wide text-amber-300/80 mb-2 flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" />{t('Harta për robotin (parametra → sugjerime)')}</div>
                  <div className="space-y-1.5">
                    {(syn.robot_mapping ?? []).map((m, i) => (
                      <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-[12px]">
                        <b className="text-amber-300">{m.param}:</b> <span className="text-gray-200">{m.suggestion}</span>
                        {m.basis && <span className="text-gray-500"> — {m.basis}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {syn.caution && <div className="flex items-start gap-2 text-[12px] bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg p-2.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{syn.caution}</div>}
            </div>
          )}
        </>
      )}

      <p className="text-gray-600 text-[11px] text-center">{t('Vetëm këshilluese — rekomandimet NUK aplikohen vetë te roboti. Ti vendos çfarë të ndryshosh dhe validoje në DEMO.')}</p>
    </div>
  );
}
