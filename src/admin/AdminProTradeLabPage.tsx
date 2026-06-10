// Super Admin → "ProTrade Lab": Faza 3 (analiza e pikave kyçe → win-rate sipas kushteve)
// + Faza 4 (Claude analizon statistikat dhe sugjeron rregullime). Vetëm super-admin.
import { useEffect, useState, useCallback } from 'react';
import { FlaskConical, Brain, RefreshCw, Loader2, TrendingUp, AlertTriangle, Lightbulb, Database, Bot } from 'lucide-react';
import { supabase } from '../lib/supabase';
import IntelligenceMatrix from './IntelligenceMatrix';
import MmtiRobot from './MmtiRobot';
import { useI18n } from '../i18n/i18n';

interface Bkt { label: string; n: number; win: number; rate: number; avgR: number }
interface Group { group: string; rows: Bkt[] }
interface Analytics { total: number; wins: number; losses: number; winRate: number; avgR: number; groups: Group[] }
interface Advice { insights?: string[]; suggestions?: { title: string; detail: string }[]; caution?: string; error?: string }

interface TIStat { n: number; wins: number; losses: number; winRate: number; net: number; avgWin: number; avgLoss: number; expectancy: number; profitFactor: number }
interface TIGroup extends TIStat { label: string }
interface TradeIntel { account: string; days: number; total: number; overall: TIStat; bySession: TIGroup[]; byStrategy: TIGroup[]; bySymbol: TIGroup[]; error?: string }

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
  const { t } = useI18n();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [loading, setLoading] = useState(true);
  const [advising, setAdvising] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tokens, setTokens] = useState<string[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [tradeIntel, setTradeIntel] = useState<TradeIntel | null>(null);
  const [tiLoading, setTiLoading] = useState(true);
  const [mmtiActive, setMmtiActive] = useState(false);

  // "Kodet reale" për matrix-in: tokena të shkurtër (shi) + rreshta të plotë (feed):
  // sinjale me Hyrje/SL/TP/conf, formula matematikore dhe rregulla — nga sinjalet reale.
  const buildFeed = useCallback(async () => {
    const tok = new Set<string>(['EMA200', 'RSI', 'MACD', 'ADX', 'ATR', 'Supertrend', 'EfficiencyRatio', 'Bollinger', 'confluence', 'D1', 'BLEJ', 'SHIT']);
    const formulaLines = [
      'EMA = Price·k + EMA₋₁·(1−k)    k = 2/(n+1)',
      'RSI = 100 − 100/(1 + RS)    RS = avgGain / avgLoss',
      'MACD = EMA12 − EMA26    Signal = EMA9(MACD)    Hist = MACD − Signal',
      'ATR = max(H−L, |H−C₋₁|, |L−C₋₁|)    → volatility',
      'ADX = WilderAvg(DX)    DX = 100·|+DI − −DI| / (+DI + −DI)',
      'SL = ATR × 1.5  (oil ×2)    TP = SL × 2    →    R:R = 1:2',
      'lot = risk / (slDist × valuePerPrice)',
      'Confluence = Σ factors / max    →    confidence',
      'Efficiency Ratio = |Δnet| / Σ|Δ|    Supertrend = (H+L)/2 ± ATR×3',
      'EMA200 ↓  &  1h+4h agree  &  ADX ≥ 25  →  valid signal',
    ];
    const sigLines: string[] = [];
    try {
      const { data } = await supabase.from('signals')
        .select('symbol, type, confidence, entry_price, target_price, stop_loss, status, features')
        .not('features', 'is', null).order('created_at', { ascending: false }).limit(50);
      for (const s of (data ?? []) as { symbol: string; type: string; confidence: number; entry_price: number | null; target_price: number | null; stop_loss: number | null; status: string; features: Record<string, unknown> }[]) {
        const f = s.features || {};
        const dir = s.type === 'buy' ? 'BUY' : 'SELL';
        const st = s.status === 'hit_tp' ? ' → ✓TP' : s.status === 'hit_sl' ? ' → ✗SL' : '';
        sigLines.push(`${s.symbol} ${dir} │ Entry ${s.entry_price ?? '—'} │ SL ${s.stop_loss ?? '—'} │ TP ${s.target_price ?? '—'} │ conf ${s.confidence}% │ ADX ${f.adx ?? '—'} RSI ${f.rsi ?? '—'}${st}`);
        tok.add(s.symbol);
        if (f.adx != null) tok.add(`ADX${f.adx}`);
        if (f.rsi != null) tok.add(`RSI${f.rsi}`);
        if (f.conf != null) tok.add(`conf${f.conf}`);
        if (f.er != null) tok.add(`ER${f.er}`);
      }
    } catch { /* injoro */ }
    setTokens([...tok]);
    setLines([...sigLines, ...formulaLines]);
  }, []);

  useEffect(() => { buildFeed(); }, [buildFeed]);

  const load = useCallback(async (advise = false) => {
    if (advise) setAdvising(true); else setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke('strategy-advisor', { body: { advise } });
    if (error) setErr(error.message);
    else {
      if (data?.analytics) setAnalytics(data.analytics as Analytics);
      if (advise) setAdvice((data?.advice as Advice) ?? { error: t('Pa përgjigje') });
    }
    if (advise) setAdvising(false); else setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Mësimi nga trade-t REALE të llogarisë aktive (lab-trades) — vetëm lexim, s'prek robotin.
  const loadTradeIntel = useCallback(async () => {
    setTiLoading(true);
    const { data, error } = await supabase.functions.invoke('lab-trades', { body: {} });
    if (!error && data && !(data as { error?: string }).error) setTradeIntel(data as TradeIntel);
    setTiLoading(false);
  }, []);
  useEffect(() => { loadTradeIntel(); }, [loadTradeIntel]);

  // MMTI — gjendja e super-robotit të ri (i ndarë). Vetëm lexim/ndez-fik; s'prek robotin aktual.
  useEffect(() => {
    supabase.from('mmti_state').select('active').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setMmtiActive(!!(data as { active?: boolean }).active); });
  }, []);
  const toggleMmti = useCallback(async () => {
    const next = !mmtiActive; setMmtiActive(next);
    try { await supabase.from('mmti_state').update({ active: next, trades_learned: tradeIntel?.total ?? 0, updated_at: new Date().toISOString() }).eq('id', 1); } catch { /* injoro */ }
  }, [mmtiActive, tradeIntel]);

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
            <p className="text-gray-400 text-sm">{t('Mësimi nga rezultatet — win-rate sipas kushteve + sugjerime nga Claude.')}</p>
          </div>
        </div>
        <button onClick={() => load(false)} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* ====== MMTI — super-roboti i ri (i NDARË; vetëm mëson nga aktuali) ====== */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-gray-900 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-amber-500/15 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center font-black text-gray-950 text-[11px]">MMTI</div>
            <div>
              <div className="text-white font-bold text-sm flex items-center gap-2">MMTI
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">{mmtiActive ? t('Po mëson') : t('Në gjumë')}</span>
              </div>
              <div className="text-gray-500 text-[11px]">{t('Super-roboti i ri — mëson nga roboti aktual, i ndarë plotësisht.')}</div>
            </div>
          </div>
          <button onClick={toggleMmti} aria-label="MMTI" className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${mmtiActive ? 'bg-amber-500' : 'bg-gray-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${mmtiActive ? 'translate-x-7' : ''}`} />
          </button>
        </div>

        <MmtiRobot active={mmtiActive} />

        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400">{t('Po mëson nga trade-t reale')}</span>
            <span className="text-amber-400 font-semibold">{Math.min(100, tradeIntel?.total ?? 0)}/100</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.min(100, tradeIntel?.total ?? 0)}%` }} />
          </div>
          {tradeIntel && tradeIntel.bySession.length > 0 && (
            <p className="text-gray-400 text-[12px]">{t('Çfarë ka mësuar deri tani:')} <span className="text-gray-200">{t('Sesioni më i mirë')}: <b className="text-amber-300">{tradeIntel.bySession[0].label}</b> · {t('Strategjia')}: <b className="text-amber-300">{tradeIntel.byStrategy[0]?.label}</b> · expectancy <b className="text-green-400">+${tradeIntel.overall.expectancy}</b></span></p>
          )}
          <div className="flex items-start gap-2 text-[11px] bg-gray-950/50 border border-gray-800 rounded-lg p-2.5 text-gray-400">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            {t('MMTI ende NUK tregton — vetëm mëson. Tregtimi aktivizohet pas ~100 trade + miratimit tënd, si robot krejt i ndarë që s\'prek aktualin.')}
          </div>
        </div>
      </div>

      {/* Inteligjenca live — "matrix" me kodet reale + robot që endet gjatë analizës */}
      <div className="rounded-2xl border border-green-500/20 bg-[#02060a] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-green-500/15">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-green-400">
            <Bot className="w-3.5 h-3.5" /> Live Intelligence
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${advising ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
            <span className={advising ? 'text-amber-400' : 'text-green-500'}>{advising ? 'ANALYZING' : 'ACTIVE'}</span>
          </div>
        </div>
        <div className="h-44 sm:h-52">
          <IntelligenceMatrix lines={lines} tokens={tokens} active={advising} />
        </div>
      </div>

      {/* MËSIMI NGA TRADE-T REALE (llogaria aktive) — vetëm lexim */}
      {!tiLoading && tradeIntel && tradeIntel.total > 0 && (
        <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-400" />{t('Mësimi nga trade-t REALE')}
            <span className="text-[11px] text-gray-500 font-normal">· {t('llogaria aktive')} · {tradeIntel.days}{t('d')}</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { k: t('Trade'), v: String(tradeIntel.overall.n) },
              { k: t('Win-rate'), v: `${tradeIntel.overall.winRate}%`, c: rateColor(tradeIntel.overall.winRate) },
              { k: t('Neto'), v: `${tradeIntel.overall.net >= 0 ? '+' : ''}${tradeIntel.overall.net}`, c: tradeIntel.overall.net >= 0 ? 'text-green-400' : 'text-red-400' },
              { k: t('Expectancy/trade'), v: `${tradeIntel.overall.expectancy >= 0 ? '+' : ''}${tradeIntel.overall.expectancy}`, c: tradeIntel.overall.expectancy >= 0 ? 'text-green-400' : 'text-red-400' },
              { k: t('Profit factor'), v: String(tradeIntel.overall.profitFactor) },
            ].map((c) => (
              <div key={c.k} className="bg-gray-950 border border-gray-800 rounded-xl p-2.5">
                <div className="text-[9px] text-gray-500 uppercase tracking-wide">{c.k}</div>
                <div className={`text-base font-bold mt-0.5 ${c.c ?? 'text-white'}`}>{c.v}</div>
              </div>
            ))}
          </div>
          {[{ title: t('Sipas sesionit'), rows: tradeIntel.bySession }, { title: t('Sipas strategjisë'), rows: tradeIntel.byStrategy }].map((blk) => (
            <div key={blk.title}>
              <div className="text-[11px] uppercase tracking-wide text-amber-300/80 mb-1.5">{blk.title}</div>
              <div className="space-y-1.5">
                {blk.rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <div className="w-40 text-xs text-gray-300 truncate">{r.label}</div>
                    <div className="flex-1 h-5 bg-gray-950 rounded-md overflow-hidden relative">
                      <div className={`h-full ${barColor(r.winRate)} opacity-80`} style={{ width: `${r.winRate}%` }} />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-white/90">{r.winRate}% · {r.n} trade</span>
                    </div>
                    <div className={`w-20 text-right text-[11px] ${r.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.net >= 0 ? '+' : ''}${r.net}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-gray-600 text-[11px]">{t('Të dhëna reale nga MT5 (P&L i mbyllur). Bëhet i besueshëm pas ~100 trade-sh.')}</p>
        </div>
      )}

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-900 rounded-2xl animate-pulse" />)}</div>
      ) : !analytics || analytics.total === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <Database className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">{t('Po mblidhen të dhëna…')}</p>
          <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
            {t('"Pikat kyçe" ruhen për çdo sinjal të ri (Faza 2). Analiza bëhet e besueshme pas ~100 sinjalesh të mbyllura. Kthehu pas disa ditësh tregtimi.')}
          </p>
        </div>
      ) : (
        <>
          {/* Përmbledhja */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: t('Sinjale të mbyllura'), v: String(analytics.total) },
              { k: t('Win-rate'), v: `${analytics.winRate}%`, c: rateColor(analytics.winRate) },
              { k: t('Fitime / Humbje'), v: `${analytics.wins} / ${analytics.losses}` },
              { k: t('Mesatare rezultati'), v: `${analytics.avgR > 0 ? '+' : ''}${analytics.avgR}%`, c: analytics.avgR >= 0 ? 'text-green-400' : 'text-red-400' },
            ].map((c) => (
              <div key={c.k} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{c.k}</div>
                <div className={`text-lg font-bold mt-0.5 ${c.c ?? 'text-white'}`}>{c.v}</div>
              </div>
            ))}
          </div>

          {!enough && (
            <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {t('Mostër e vogël ({n}). Përfundimet bëhen të besueshme pas ~100 sinjalesh — mos ndrysho strategjinë ende.', { n: analytics.total })}
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
              <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" />{t('Claude Strategjist (Faza 4)')}</h3>
              <button onClick={() => load(true)} disabled={advising || !enough}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {advising ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
                {advising ? t('Duke analizuar…') : t('Analizo me Claude')}
              </button>
            </div>
            {!enough && <p className="text-gray-500 text-xs">{t('Aktivizohet pas ≥20 sinjalesh të mbyllura.')}</p>}

            {advice && advice.error && <p className="text-red-400 text-xs">{advice.error}</p>}
            {advice && !advice.error && (
              <div className="space-y-3">
                {advice.insights && advice.insights.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-purple-300 mb-1">{t('Vëzhgime')}</div>
                    <ul className="space-y-1">{advice.insights.map((x, i) => <li key={i} className="text-gray-300 text-[13px] flex gap-2"><span className="text-purple-400">•</span>{x}</li>)}</ul>
                  </div>
                )}
                {advice.suggestions && advice.suggestions.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-purple-300 mb-1">{t('Sugjerime')}</div>
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
                <p className="text-gray-600 text-[11px]">{t('⚠️ Sugjerimet janë këshilla — testoji në DEMO para se t\'i aplikosh te paratë reale.')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
