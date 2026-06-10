// ProTrade Intelligence — faqja e klientit me sinjalet e rafinuara nga motori AI.
// Përdoruesi mund të: (1) ndezë auto-trade (roboti hap vetë sinjalet), ose
// (2) tregtojë manualisht — klik mbi sinjal → mbush tabelën te "Tregto Live" (si ari).
import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Bot, TrendingUp, TrendingDown, Loader2, ArrowRight, RefreshCw, Lock, Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n, dtLocale } from '../i18n/i18n';
import type { ClientPage } from '../App';
import MmtiRobot from '../admin/MmtiRobot';

interface Signal {
  id: string; symbol: string; type: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  analysis: string | null; timeframe: string | null; created_at: string;
}

const FRESH_MIN = 30; // sinjal i freskët për tregtim manual

// Preset-et e MMTI-t (super-roboti i ri) — TP më i gjerë (1:3) për fitim më të madh se roboti normal (1:2).
const MMTI_PRESETS: { label: string; key: string; sl: number; tp: number; lot: number; daily: number }[] = [
  { label: '€100',    key: '100',    sl: 2,   tp: 6,   lot: 0.01, daily: 5 },
  { label: '€500',    key: '500',    sl: 3,   tp: 9,   lot: 0.02, daily: 25 },
  { label: '€1,000',  key: '1000',   sl: 4,   tp: 12,  lot: 0.05, daily: 50 },
  { label: '€5,000',  key: '5000',   sl: 6,   tp: 18,  lot: 0.2,  daily: 250 },
  { label: '€50,000', key: '50000',  sl: 20,  tp: 60,  lot: 1,    daily: 1500 },
  { label: '€100k',   key: '100000', sl: 100, tp: 300, lot: 2,    daily: 3000 },
];

export default function ProTradePage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [autoTrade, setAutoTrade] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const now = new Date().toISOString();
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [sg, cfg] = await Promise.all([
      supabase.from('signals')
        .select('id, symbol, type, confidence, entry_price, target_price, stop_loss, analysis, timeframe, created_at')
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .gte('created_at', since)
        .order('confidence', { ascending: false })
        .limit(12),
      supabase.from('metaapi_config').select('auto_trade, account_id, token').eq('user_id', user.id).maybeSingle(),
    ]);
    if (sg.data) setSignals(sg.data as Signal[]);
    if (cfg.data) {
      setAutoTrade(!!cfg.data.auto_trade);
      setConfigured(!!(cfg.data.account_id && cfg.data.token));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // MMTI (super-roboti i ri, i ndarë) — preferencat per-përdorues + progresi i mësimit. Vetëm hije.
  const [mmtiActive, setMmtiActive] = useState(false);
  const [mmtiPreset, setMmtiPreset] = useState<string | null>(null);
  const [mmtiLearned, setMmtiLearned] = useState(0);
  useEffect(() => {
    if (!user) return;
    supabase.from('mmti_config').select('active, capital_preset').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) { setMmtiActive(!!(data as { active?: boolean }).active); setMmtiPreset((data as { capital_preset?: string }).capital_preset ?? null); } });
    supabase.from('trade_executions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'executed')
      .then(({ count }) => setMmtiLearned(count ?? 0));
  }, [user]);
  const saveMmti = useCallback(async (patch: Record<string, unknown>) => {
    if (!user) return;
    try { await supabase.from('mmti_config').upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); } catch { /* injoro */ }
  }, [user]);
  const pickMmtiPreset = (p: typeof MMTI_PRESETS[number]) => { setMmtiPreset(p.key); saveMmti({ capital_preset: p.key, params: { sl: p.sl, tp: p.tp, lot: p.lot, daily: p.daily, risk: 1 } }); };
  const toggleMmtiShadow = () => { const next = !mmtiActive; setMmtiActive(next); saveMmti({ active: next }); };

  const toggleAuto = async () => {
    if (!user || !configured) return;
    setSaving(true); setMsg(null);
    const next = !autoTrade;
    const { error } = await supabase.from('metaapi_config')
      .update({ auto_trade: next, updated_at: new Date().toISOString() }).eq('user_id', user.id);
    if (error) setMsg({ type: 'error', text: error.message });
    else { setAutoTrade(next); setMsg({ type: 'success', text: next ? t('Auto-trade NDEZUR — roboti do hapë vetë sinjalet.') : t('Auto-trade FIKUR — tregto manualisht.') }); }
    setSaving(false);
  };

  // Tregto manualisht: dorëzon sinjalin te "Tregto Live", që mbush tabelën automatik (si ari).
  const tradeManual = (s: Signal) => {
    try { localStorage.setItem('protrade_apply_signal', JSON.stringify(s)); } catch { /* injoro */ }
    onNavigate('market_prices');
  };

  const isFresh = (iso: string) => (Date.now() - new Date(iso).getTime()) < FRESH_MIN * 60 * 1000;
  const fmtTime = (iso: string) => new Date(iso).toLocaleString(dtLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const selMmti = MMTI_PRESETS.find((p) => p.key === mmtiPreset);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      {/* Titulli */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-gray-950" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">ProTrade Intelligence</h2>
            <p className="text-gray-400 text-sm">{t('Sinjale të rafinuara nga motori AI. Tregto automatik ose manual.')}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Karta Auto-trade */}
      <div className={`rounded-2xl border p-4 transition-colors ${autoTrade ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-900 border-gray-800'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${autoTrade ? 'bg-green-500/20' : 'bg-gray-800'}`}>
              <Bot className={`w-5 h-5 ${autoTrade ? 'text-green-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <div className="text-white font-semibold text-sm">{t('Auto-trade i sinjaleve')}</div>
              <div className="text-gray-400 text-xs">{autoTrade ? t('Roboti hap vetë sinjalet (me të gjitha portat e sigurisë).') : t('I fikur — ti vendos manualisht mbi çdo sinjal.')}</div>
            </div>
          </div>
          <button
            onClick={toggleAuto}
            disabled={saving || !configured}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-all disabled:opacity-50 ${autoTrade ? 'bg-green-500 text-gray-950 border-green-500' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : autoTrade ? t('AKTIV') : t('JOAKTIV')}
          </button>
        </div>
        {!configured && (
          <button onClick={() => onNavigate('metatrader')} className="mt-3 w-full flex items-center justify-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2">
            <Lock className="w-3.5 h-3.5" /> {t('Lidh llogarinë MT5 te Lidhja & Konfigurimi për të aktivizuar.')}
          </button>
        )}
        {msg && <div className={`mt-2 text-xs ${msg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</div>}
      </div>

      {/* ====== MMTI — super-roboti i ri (në hije/mësim, llogari e ndarë) ====== */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-gray-900 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-amber-500/15 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center font-black text-gray-950 text-[11px]">MMTI</div>
            <div>
              <div className="text-white font-bold text-sm flex items-center gap-2">{t('MMTI — Super Robot')}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">{t('Po mëson · Shadow')}</span>
              </div>
              <div className="text-gray-500 text-[11px]">{t('Robot i ri që mëson nga tregtimet — synon fitime më të mëdha.')}</div>
            </div>
          </div>
          <button onClick={toggleMmtiShadow} aria-label="MMTI" className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${mmtiActive ? 'bg-amber-500' : 'bg-gray-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${mmtiActive ? 'translate-x-7' : ''}`} />
          </button>
        </div>

        <MmtiRobot active={mmtiActive} />

        <div className="p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1"><span className="text-gray-400">{t('Po mëson nga tregtimet e tua')}</span><span className="text-amber-400 font-semibold">{Math.min(100, mmtiLearned)}/100</span></div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.min(100, mmtiLearned)}%` }} /></div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{t('Kapitali yt — rekomandime')}</div>
            <div className="flex flex-wrap gap-2">
              {MMTI_PRESETS.map((p) => (
                <button key={p.key} onClick={() => pickMmtiPreset(p)} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${mmtiPreset === p.key ? 'bg-amber-500 text-gray-950 border-amber-500' : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-amber-500/50'}`}>{p.label}</button>
              ))}
            </div>
          </div>

          {selMmti && (
            <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
              <div className="text-amber-300 font-semibold text-xs mb-1.5">{t('Profili MMTI (fitim më i madh)')}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-gray-300">
                <div><span className="text-gray-500">SL:</span> ${selMmti.sl}</div>
                <div><span className="text-gray-500">TP:</span> <span className="text-green-400">${selMmti.tp}</span></div>
                <div><span className="text-gray-500">R:R:</span> 1:{Math.round(selMmti.tp / selMmti.sl)}</div>
                <div><span className="text-gray-500">{t('Humbja ditore')}:</span> €{selMmti.daily}</div>
              </div>
              <div className="text-gray-500 text-[10px] mt-1.5">{t('TP më i gjerë se roboti normal (1:3 vs 1:2) → fito më shumë te kushtet fituese.')}</div>
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] bg-gray-950/50 border border-gray-800 rounded-lg p-2.5 text-gray-400">
            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            {t('MMTI ende NUK tregton — mëson në hije. Do aktivizohet në një llogari të NDARË (s\'prek robotin aktual) pas validimit + miratimit tënd.')}
          </div>
        </div>
      </div>

      {/* Lista e sinjaleve */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wide">
          <Zap className="w-3.5 h-3.5 text-amber-400" /> {t('Sinjalet aktive')}
        </div>
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-900 rounded-2xl animate-pulse" />)
        ) : signals.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <Sparkles className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-white font-medium">{t('Asnjë sinjal aktiv tani')}</p>
            <p className="text-gray-500 text-sm mt-1">{t('Sinjale gjenerohen vetëm kur tregu është i hapur. Prit pak.')}</p>
          </div>
        ) : (
          signals.map(s => {
            const buy = s.type === 'buy';
            const fresh = isFresh(s.created_at);
            return (
              <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{s.symbol}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${buy ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                      {buy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{buy ? t('BLEJ') : t('SHIT')}
                    </span>
                    {s.timeframe && <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{s.timeframe}</span>}
                  </div>
                  <span className="text-amber-400 font-bold text-sm">{Math.round(Number(s.confidence))}%</span>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="bg-gray-950/50 rounded-lg py-1.5">
                    <div className="text-[10px] text-gray-500">{t('Hyrja')}</div>
                    <div className="text-white text-xs font-semibold">{s.entry_price ?? '—'}</div>
                  </div>
                  <div className="bg-gray-950/50 rounded-lg py-1.5">
                    <div className="text-[10px] text-gray-500">SL</div>
                    <div className="text-red-400 text-xs font-semibold">{s.stop_loss ?? '—'}</div>
                  </div>
                  <div className="bg-gray-950/50 rounded-lg py-1.5">
                    <div className="text-[10px] text-gray-500">TP</div>
                    <div className="text-green-400 text-xs font-semibold">{s.target_price ?? '—'}</div>
                  </div>
                </div>

                {s.analysis && <p className="text-gray-500 text-[11px] mt-2 leading-relaxed line-clamp-2">{s.analysis}</p>}

                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-gray-600">🕒 {fmtTime(s.created_at)}{fresh ? '' : ` · ${t('i vjetër')}`}</span>
                  <button
                    onClick={() => tradeManual(s)}
                    disabled={!fresh}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {t('Tregto manualisht')} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-center text-gray-600 text-[11px]">{t('Sinjalet janë probabilitete, jo garanci. Menaxho gjithmonë rrezikun.')}</p>
    </div>
  );
}
