// Super Admin → "ProTrade Lab": Faza 3 (analiza e pikave kyçe → win-rate sipas kushteve)
// + Faza 4 (Claude analizon statistikat dhe sugjeron rregullime). Vetëm super-admin.
import { useEffect, useState, useCallback } from 'react';
import { FlaskConical, Brain, RefreshCw, Loader2, TrendingUp, AlertTriangle, Lightbulb, Database, Bot } from 'lucide-react';
import { supabase } from '../lib/supabase';
import IntelligenceMatrix from './IntelligenceMatrix';

interface Bkt { label: string; n: number; win: number; rate: number; avgR: number }
interface Group { group: string; rows: Bkt[] }
interface Analytics { total: number; wins: number; losses: number; winRate: number; avgR: number; groups: Group[] }
interface Advice { insights?: string[]; suggestions?: { title: string; detail: string }[]; caution?: string; error?: string }

function rateColor(rate: number) {
  if (rate >= 60) return 'text-green-400';
  if (rate >= 45) return 'text-amber-400';
  return 'text-red-400';
}
function barColor(rate: number) {
  if (rate >= 60) return 'bg-green-500';
  if (rate >= 45) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function AdminProTradeLabPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [loading, setLoading] = useState(true);
  const [advising, setAdvising] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tokens, setTokens] = useState<string[]>([]);

  // "Kodet reale" për matrix-in: ndërtohen nga features e sinjaleve të fundit + statistikat.
  const buildTokens = useCallback(async () => {
    const base = ['EMA200', 'RSI', 'MACD', 'ADX', 'ATR', 'Supertrend', 'EfficiencyRatio', 'Bollinger', 'confluence', 'D1', 'EMA9>EMA21'];
    const out = new Set<string>(base);
    try {
      const { data } = await supabase.from('signals')
        .select('symbol, type, confidence, status, features')
        .not('features', 'is', null).order('created_at', { ascending: false }).limit(60);
      for (const s of (data ?? []) as { symbol: string; type: string; confidence: number; status: string; features: Record<string, unknown> }[]) {
        const f = s.features || {};
        out.add(s.symbol); out.add(String(s.type).toUpperCase());
        if (f.adx != null) out.add(`ADX${f.adx}`);
        if (f.rsi != null) out.add(`RSI${f.rsi}`);
        if (f.conf != null) out.add(`conf${f.conf}`);
        if (f.er != null) out.add(`ER${f.er}`);
        if (f.atr_pct != null) out.add(`ATR${f.atr_pct}%`);
        if (f.dow) out.add(String(f.dow));
        if (s.status) out.add(s.status);
      }
    } catch { /* injoro */ }
    setTokens([...out]);
  }, []);

  useEffect(() => { buildTokens(); }, [buildTokens]);

  const load = useCallback(async (advise = false) => {
    if (advise) setAdvising(true); else setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke('strategy-advisor', { body: { advise } });
    if (error) setErr(error.message);
    else {
      if (data?.analytics) setAnalytics(data.analytics as Analytics);
      if (advise) setAdvice((data?.advice as Advice) ?? { error: 'Pa përgjigje' });
    }
    if (advise) setAdvising(false); else setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  const enough = (analytics?.total ?? 0) >= 20;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <FlaskConical className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">ProTrade Lab</h2>
            <p className="text-gray-400 text-sm">Mësimi nga rezultatet — win-rate sipas kushteve + sugjerime nga Claude.</p>
          </div>
        </div>
        <button onClick={() => load(false)} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Inteligjenca live — "matrix" me kodet reale + robot që endet gjatë analizës */}
      <div className="rounded-2xl border border-green-500/20 bg-[#02060a] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-green-500/15">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-green-400">
            <Bot className="w-3.5 h-3.5" /> Inteligjenca live
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${advising ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
            <span className={advising ? 'text-amber-400' : 'text-green-500'}>{advising ? 'DUKE ANALIZUAR' : 'AKTIV'}</span>
          </div>
        </div>
        <div className="h-44 sm:h-52">
          <IntelligenceMatrix tokens={tokens} active={advising} />
        </div>
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-900 rounded-2xl animate-pulse" />)}</div>
      ) : !analytics || analytics.total === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <Database className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">Po mblidhen të dhëna…</p>
          <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
            "Pikat kyçe" ruhen për çdo sinjal të ri (Faza 2). Analiza bëhet e besueshme pas ~100 sinjalesh të mbyllura.
            Kthehu pas disa ditësh tregtimi.
          </p>
        </div>
      ) : (
        <>
          {/* Përmbledhja */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: 'Sinjale të mbyllura', v: String(analytics.total) },
              { k: 'Win-rate', v: `${analytics.winRate}%`, c: rateColor(analytics.winRate) },
              { k: 'Fitime / Humbje', v: `${analytics.wins} / ${analytics.losses}` },
              { k: 'Mesatare rezultati', v: `${analytics.avgR > 0 ? '+' : ''}${analytics.avgR}%`, c: analytics.avgR >= 0 ? 'text-green-400' : 'text-red-400' },
            ].map((c) => (
              <div key={c.k} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{c.k}</div>
                <div className={`text-lg font-bold mt-0.5 ${c.c ?? 'text-white'}`}>{c.v}</div>
              </div>
            ))}
          </div>

          {!enough && (
            <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Mostër e vogël ({analytics.total}). Përfundimet bëhen të besueshme pas ~100 sinjalesh — mos ndrysho strategjinë ende.
            </div>
          )}

          {/* Grupet e kushteve */}
          {analytics.groups.filter(g => g.rows.length > 0).map((g) => (
            <div key={g.group} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-400" />{g.group}</h3>
              <div className="space-y-2">
                {g.rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <div className="w-36 text-xs text-gray-300 truncate">{r.label}</div>
                    <div className="flex-1 h-5 bg-gray-950 rounded-md overflow-hidden relative">
                      <div className={`h-full ${barColor(r.rate)} opacity-80`} style={{ width: `${r.rate}%` }} />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-white/90">{r.rate}%</span>
                    </div>
                    <div className="w-24 text-right text-[11px] text-gray-500">
                      <span className={rateColor(r.rate)}>{r.win}/{r.n}</span> · {r.avgR > 0 ? '+' : ''}{r.avgR}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Claude strategjist */}
          <div className="bg-gradient-to-br from-purple-500/10 to-gray-900 border border-purple-500/20 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" />Claude Strategjist (Faza 4)</h3>
              <button onClick={() => load(true)} disabled={advising || !enough}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {advising ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
                {advising ? 'Duke analizuar…' : 'Analizo me Claude'}
              </button>
            </div>
            {!enough && <p className="text-gray-500 text-xs">Aktivizohet pas ≥20 sinjalesh të mbyllura.</p>}

            {advice && advice.error && <p className="text-red-400 text-xs">{advice.error}</p>}
            {advice && !advice.error && (
              <div className="space-y-3">
                {advice.insights && advice.insights.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-purple-300 mb-1">Vëzhgime</div>
                    <ul className="space-y-1">{advice.insights.map((x, i) => <li key={i} className="text-gray-300 text-[13px] flex gap-2"><span className="text-purple-400">•</span>{x}</li>)}</ul>
                  </div>
                )}
                {advice.suggestions && advice.suggestions.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-purple-300 mb-1">Sugjerime</div>
                    <div className="space-y-2">{advice.suggestions.map((s, i) => (
                      <div key={i} className="bg-gray-950/50 border border-gray-800 rounded-lg p-2.5">
                        <div className="text-white text-[13px] font-medium">{s.title}</div>
                        <div className="text-gray-400 text-[12px] mt-0.5">{s.detail}</div>
                      </div>
                    ))}</div>
                  </div>
                )}
                {advice.caution && (
                  <div className="flex items-start gap-2 text-[12px] bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg p-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {advice.caution}
                  </div>
                )}
                <p className="text-gray-600 text-[11px]">⚠️ Sugjerimet janë këshilla — testoji në DEMO para se t'i aplikosh te paratë reale.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
