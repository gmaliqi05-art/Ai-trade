import { useCallback, useEffect, useState } from 'react';
import { Brain, Power, ShieldAlert, Activity, RefreshCw, Loader2, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';

// MMT — SUPER ROBOTI (faqe KOMPLET E VEÇANTË nga Cilësimet e robotëve ekzistues).
// Faza HIJE: tregton vetëm në letër; këtu menaxhohen cilësimet e tij dhe shihet performanca.

interface MmtConfig {
  active: boolean; paper_equity: number; risk_pct: number; rr: number;
  max_open: number; max_same_dir: number; daily_stop_pct: number; kill_after_sl: number;
  adx_trend_min: number; adx_range_max: number; er_trend_min: number;
  overext_atr: number; overext_days: number; sessions: [number, number][];
  blackout_until: string | null; be_at_r: number; trail_at_r: number; trail_lock_pct: number;
  live_enabled: boolean; live_lots: number; live_user_id: string | null;
  spike_mult: number; zone_atr: number; pressure_pct: number;
}
interface MmtTrade {
  id: string; side: string; strategy: string; regime: string; entry_price: number; sl: number; tp: number;
  lots: number; status: string; exit_price: number | null; pnl_usd: number | null; r_multiple: number | null;
  reason: string | null; opened_at: string; closed_at: string | null;
}
interface ScanRow { id: number; scanned_at: string; price: number | null; regime: string | null; decision: string | null; reject_reason: string | null; adx: number | null; er: number | null; rsi15: number | null; }

const REGJIME: Record<string, string> = {
  TREND_UP: 'Trend LART', TREND_DOWN: 'Trend POSHTË', RANGE: 'Range (anësor)',
  TRANSITION: 'Tranzicion (pa tregti)', EVENT: 'Ngjarje (blackout)',
};

export default function MmtPage() {
  const { profile, user } = useAuth();
  const { t } = useI18n();
  const [cfg, setCfg] = useState<MmtConfig | null>(null);
  const [trades, setTrades] = useState<MmtTrade[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessionsTxt, setSessionsTxt] = useState('7-10,13-17');

  const load = useCallback(async () => {
    const [{ data: c }, { data: tr }, { data: sc }] = await Promise.all([
      supabase.from('mmt_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('mmt_trades').select('*').order('opened_at', { ascending: false }).limit(30),
      supabase.from('mmt_scan_log').select('*').order('scanned_at', { ascending: false }).limit(12),
    ]);
    if (c) {
      setCfg(c as MmtConfig);
      const s = (c as MmtConfig).sessions;
      if (Array.isArray(s)) setSessionsTxt(s.map(([a, b]) => `${a}-${b}`).join(','));
    }
    setTrades((tr ?? []) as MmtTrade[]);
    setScans((sc ?? []) as ScanRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const set = <K extends keyof MmtConfig>(k: K, v: MmtConfig[K]) => setCfg(p => (p ? { ...p, [k]: v } : p));
  const save = async (patch?: Partial<MmtConfig>) => {
    if (!cfg) return;
    setSaving(true);
    // Sesionet nga teksti "7-10,13-17" → [[7,10],[13,17]] (injoro pjesët e pavlefshme).
    const sessions = sessionsTxt.split(',').map(p => p.split('-').map(x => parseInt(x.trim(), 10)))
      .filter(a => a.length === 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]) && a[0] >= 0 && a[1] <= 24 && a[0] < a[1]) as [number, number][];
    const body = { ...cfg, ...patch, sessions: sessions.length ? sessions : cfg.sessions, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('mmt_config').update(body).eq('id', 1);
    if (!error && patch) setCfg(p => (p ? { ...p, ...patch } : p));
    setSaving(false);
  };

  if (!profile?.is_admin) {
    return <div className="p-6"><p className="text-gray-400">{t('Kjo faqe është vetëm për administratorin.')}</p></div>;
  }
  if (loading || !cfg) {
    return <div className="p-6 flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />{t('Duke ngarkuar…')}</div>;
  }

  const closed = trades.filter(x => x.status !== 'open');
  const wins = closed.filter(x => Number(x.pnl_usd) > 0);
  const totalPnl = closed.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
  const totalR = closed.reduce((a, x) => a + Number(x.r_multiple ?? 0), 0);
  const lastScan = scans[0];

  const num = (label: string, key: keyof MmtConfig, step = '0.1', hint?: string) => (
    <label className="block">
      <span className="text-[11px] text-gray-400">{label}</span>
      <input type="number" step={step} value={String(cfg[key] ?? '')}
        onChange={e => set(key, Number(e.target.value) as never)} onBlur={() => save()}
        className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
    </label>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Brain className="w-6 h-6 text-amber-400" />MMT — Super Roboti</h2>
        <p className="text-gray-400 text-sm mt-1">{t('Motor krejt i veçantë (regjim + ansambël + mbrojtje prop-style). Faza HIJE: tregton vetëm në letër — asnjë para reale.')}</p>
      </div>

      {/* STATUSI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Regjimi tani')}</p>
          <p className="text-white font-bold text-sm mt-1">{lastScan?.regime ? (REGJIME[lastScan.regime] || lastScan.regime) : '—'}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">ADX {lastScan?.adx ?? '—'} · ER {lastScan?.er ?? '—'} · RSI15 {lastScan?.rsi15 ?? '—'}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Bilanci (letër)')}</p>
          <p className={`font-bold text-sm mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} $</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{totalR >= 0 ? '+' : ''}{totalR.toFixed(1)} R gjithsej</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Fitore / Humbje')}</p>
          <p className="text-white font-bold text-sm mt-1">{wins.length}W / {closed.length - wins.length}L</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{closed.length ? Math.round((wins.length / closed.length) * 100) : 0}% {t('fitore')}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500">{t('Skanimi i fundit')}</p>
          <p className="text-white font-bold text-sm mt-1">{lastScan ? new Date(lastScan.scanned_at).toLocaleTimeString() : '—'}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{lastScan?.decision || '—'}{lastScan?.reject_reason ? ` · ${lastScan.reject_reason}` : ''}</p>
        </div>
      </div>

      {/* NDEZ/FIK + rifresko */}
      <div className="flex items-center gap-3">
        <button onClick={() => save({ active: !cfg.active })}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold transition ${cfg.active ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
          <Power className="w-4 h-4" />{cfg.active ? 'MMT (Hije): ON' : 'MMT (Hije): OFF'}
        </button>
        <button onClick={load} className="p-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
        {saving && <span className="text-[11px] text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t('Duke ruajtur…')}</span>}
      </div>

      {/* CILËSIMET — të VEÇANTA nga robotët e tjerë */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-400" />{t('Cilësimet MMT (vetëm ky robot)')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {num(t('Kapitali i letrës ($)'), 'paper_equity', '50')}
          {num(t('Rreziku për trade (%)'), 'risk_pct', '0.1', t('PTJ: max 1%'))}
          {num('R:R (trend)', 'rr', '0.5', t('MMTI mësoi 1:4'))}
          {num(t('Pozicione maks.'), 'max_open', '1')}
          {num(t('Maks. në 1 drejtim'), 'max_same_dir', '1', t('anti-stacking'))}
          {num(t('Stop ditor (%)'), 'daily_stop_pct', '0.5', t('prop-firm: 4-5%'))}
          {num(t('Kill pas N SL/ditë'), 'kill_after_sl', '1', t('Dhoma: 2'))}
          {num('ADX min (trend)', 'adx_trend_min', '1', t('industri: 25'))}
          {num('ADX max (range)', 'adx_range_max', '1')}
          {num('ER min (trend)', 'er_trend_min', '0.05')}
          {num(t('Mbi-ekstension (×ATR)'), 'overext_atr', '0.1', t('mos shit te fundi'))}
          {num(t('Dritarja e ekstremit (ditë)'), 'overext_days', '1')}
          {num('Break-even në (+R)', 'be_at_r', '0.1')}
          {num('Trailing pas (+R)', 'trail_at_r', '0.1')}
          {num('Trailing mban (%)', 'trail_lock_pct', '5')}
          {num(t('Roja e spike-ve (×mes 1m)'), 'spike_mult', '0.5', t('qiri > kaq × mesatarja → prit'))}
          {num(t('Zona e rrezikut (×ATR)'), 'zone_atr', '0.1', t('S/R + nivele $50'))}
          {num(t('Presioni kundër maks (%)'), 'pressure_pct', '5', t('rrjedha e parasë 1m'))}
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Sesionet (orë UTC)')}</span>
            <input value={sessionsTxt} onChange={e => setSessionsTxt(e.target.value)} onBlur={() => save()}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="7-10,13-17" />
            <span className="text-[10px] text-gray-600">{t('kill-zones; NY = 16-21')}</span>
          </label>
        </div>
        <label className="block sm:max-w-xs">
          <span className="text-[11px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{t('Blackout ngjarjesh deri më (UTC)')}</span>
          <input type="datetime-local" value={cfg.blackout_until ? cfg.blackout_until.slice(0, 16) : ''}
            onChange={e => set('blackout_until', e.target.value ? new Date(e.target.value).toISOString() : null)} onBlur={() => save()}
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          <span className="text-[10px] text-gray-600">{t('P.sh. para fjalimeve të Fed — pa hyrje të reja deri atëherë.')}</span>
        </label>
      </div>

      {/* LIVE — çelësi në dorën e pronarit (default OFF). Kur ndizet, MMT ekzekuton REALISHT te MT5. */}
      <div className={`rounded-2xl p-4 space-y-3 border ${cfg.live_enabled ? 'bg-red-500/5 border-red-500/40' : 'bg-gray-900 border-gray-800'}`}>
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Power className={`w-4 h-4 ${cfg.live_enabled ? 'text-red-400' : 'text-gray-500'}`} />
          {t('LIVE — para reale')} {cfg.live_enabled && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">{t('AKTIV')}</span>}
        </h3>
        <p className="text-[11px] text-gray-400 leading-snug">
          {t('Kur ky çelës është ON, çdo hyrje e MMT ekzekutohet REALISHT te llogaria MT5 (me lot fiks të vogël), përveç regjistrimit në letër. Rekomandim: lëre OFF derisa hija të mbledhë 50+ trade dhe rezultatet të të bindin — pastaj nise me 0.01.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <button type="button"
            onClick={() => save({ live_enabled: !cfg.live_enabled, live_user_id: cfg.live_user_id || user?.id || null })}
            className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition ${cfg.live_enabled ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
            <Power className="w-4 h-4" />{cfg.live_enabled ? t('LIVE: ON — po tregton realisht') : t('LIVE: OFF — vetëm letër')}
          </button>
          {num(t('Lot live (fiks)'), 'live_lots', '0.01', t('fillimi i sigurt: 0.01'))}
          <label className="block">
            <span className="text-[11px] text-gray-400">{t('Llogaria MT5')}</span>
            <button type="button" onClick={() => save({ live_user_id: user?.id || null })}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-white text-left">
              {cfg.live_user_id ? (cfg.live_user_id === user?.id ? t('✓ Llogaria ime MT5') : `${cfg.live_user_id.slice(0, 8)}…`) : t('Kliko: përdor llogarinë time')}
            </button>
          </label>
        </div>
      </div>

      {/* TRADE-T HIJE */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-amber-400" />{t('Tregtimet në hije (letër)')}</h3>
        {trades.length === 0 ? <p className="text-gray-600 text-xs text-center py-3">{t('Ende asnjë trade — motori pret regjimin dhe sesionin e duhur.')}</p> : (
          <div className="space-y-2">
            {trades.slice(0, 12).map(x => (
              <div key={x.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  {x.side === 'BUY' ? <TrendingUp className="w-3.5 h-3.5 text-green-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  <span className="text-white font-semibold">{x.side}</span>
                  <span className="text-gray-500">{x.strategy}/{x.regime}</span>
                  <span className="text-gray-300">@{Number(x.entry_price).toFixed(2)}</span>
                  <span className="text-gray-500">SL {Number(x.sl).toFixed(2)} · TP {Number(x.tp).toFixed(2)} · {x.lots} lot</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${x.status === 'open' ? 'bg-blue-500/20 text-blue-300' : Number(x.pnl_usd) > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{x.status}</span>
                  {x.pnl_usd != null && <span className={Number(x.pnl_usd) >= 0 ? 'text-green-400' : 'text-red-400'}>{Number(x.pnl_usd) >= 0 ? '+' : ''}{Number(x.pnl_usd).toFixed(2)}$ ({Number(x.r_multiple).toFixed(1)}R)</span>}
                  <span className="text-gray-600">{new Date(x.opened_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LOGU I SKANIMEVE */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">{t('Historiku i skanimeve MMT — regjimi & vendimi')}</h3>
        <div className="space-y-1.5">
          {scans.map(s => (
            <div key={s.id} className="flex items-center justify-between text-[11px] text-gray-400 border-b border-gray-800/60 pb-1.5">
              <span>{new Date(s.scanned_at).toLocaleTimeString()} · <span className="text-gray-300">{s.regime ? (REGJIME[s.regime] || s.regime) : '—'}</span></span>
              <span className={s.decision?.startsWith('open') ? 'text-green-400 font-semibold' : ''}>{s.decision}{s.reject_reason ? ` — ${s.reject_reason}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
