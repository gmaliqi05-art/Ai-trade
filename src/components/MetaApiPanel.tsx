// Paneli MetaApi (Faza 5): konfigurim i llogarisë MT5 në cloud + auto-trade me
// mbrojtje rreziku. "Demo i pari" — mode-i fillon demo dhe kill-switch është gati.

import { useEffect, useState, useCallback } from 'react';
import { Cloud, Loader2, ShieldAlert, Power, CheckCircle, AlertCircle, Play, Save, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  loadMetaApiConfig, saveMetaApiConfig, checkMetaApiConnection, executeTrade, loadExecutions,
  DEFAULT_CONFIG, type MetaApiConfig, type TradeExecution,
} from '../services/metaapi';

const REGIONS = ['new-york', 'london', 'singapore'];

export default function MetaApiPanel() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<MetaApiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [c, ex] = await Promise.all([loadMetaApiConfig(user.id), loadExecutions(user.id)]);
    setCfg(c); setExecutions(ex); setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!user) return;
    setSaving(true); setMsg(null);
    try { await saveMetaApiConfig(user.id, cfg); setMsg({ type: 'success', text: 'Cilësimet u ruajtën.' }); }
    catch (e) { setMsg({ type: 'error', text: (e as Error).message }); }
    setSaving(false);
  };

  const testConnection = async () => {
    setBusy('check'); setMsg(null);
    const r = await checkMetaApiConnection();
    if (r.error) setMsg({ type: 'error', text: errText(r.error, r.message) });
    else setMsg({ type: 'success', text: `Lidhja OK (${r.mode}). Llogaria u arrit.` });
    setBusy(null);
  };

  const testTrade = async (action: 'BUY' | 'SELL') => {
    setBusy(action); setMsg(null);
    const r = await executeTrade({ action, symbol: 'XAUUSD', volume: cfg.default_lot });
    if (r.error) setMsg({ type: 'error', text: errText(r.error, r.message) });
    else setMsg({ type: 'success', text: `Urdhër ${action} XAUUSD dërguar (${r.mode}). Order: ${r.order_id ?? 'n/a'}` });
    await refresh();
    setBusy(null);
  };

  if (loading) return <div className="h-40 bg-gray-800 rounded-2xl animate-pulse" />;

  const configured = cfg.account_id && cfg.token;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold flex items-center gap-2"><Cloud className="w-5 h-5 text-amber-400" />Auto-Trade (MetaApi.cloud)</h3>
        <span className={`text-xs px-2.5 py-1 rounded-full border ${cfg.mode === 'demo' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
          {cfg.mode === 'demo' ? 'DEMO' : 'LIVE — para reale'}
        </span>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Lidh llogarinë tënde MT5 në cloud për ekzekutim automatik me mbrojtje rreziku.
        Krijo një token + account-id falas te <span className="text-amber-400">metaapi.cloud</span>.
        <span className="text-amber-400 font-medium"> Demo i pari</span> — testo gjithmonë në demo para parave reale.
      </p>

      {/* Kredencialet */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="MetaApi Account ID">
          <input value={cfg.account_id} onChange={e => set('account_id', e.target.value)} placeholder="p.sh. 0a1b2c3d-..."
            className="inp" />
        </Field>
        <Field label="Rajoni">
          <select value={cfg.region} onChange={e => set('region', e.target.value)} className="inp">
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="MetaApi Token" full>
          <div className="relative">
            <input type={showToken ? 'text' : 'password'} value={cfg.token} onChange={e => set('token', e.target.value)}
              placeholder="token-i nga metaapi.cloud" className="inp pr-9" />
            <button onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
      </div>

      {/* Mbrojtja e rrezikut */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-2"><ShieldAlert className="w-4 h-4 text-amber-400" />Mbrojtja e rrezikut</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Lot default"><input type="number" step="0.01" value={cfg.default_lot} onChange={e => set('default_lot', +e.target.value)} className="inp" /></Field>
          <Field label="Lot maksimal"><input type="number" step="0.01" value={cfg.max_lot} onChange={e => set('max_lot', +e.target.value)} className="inp" /></Field>
          <Field label="Humbje ditore maks."><input type="number" step="1" value={cfg.max_daily_loss} onChange={e => set('max_daily_loss', +e.target.value)} className="inp" /></Field>
          <Field label="Pozicione maks."><input type="number" step="1" value={cfg.max_open_trades} onChange={e => set('max_open_trades', +e.target.value)} className="inp" /></Field>
        </div>
      </div>

      {/* Auto-execute mbi sinjale */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-2"><Play className="w-4 h-4 text-amber-400" />Auto-execute mbi sinjale</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Besueshmëri minimale (%)"><input type="number" step="1" min="0" max="100" value={cfg.min_confidence} onChange={e => set('min_confidence', +e.target.value)} className="inp" /></Field>
          <Field label="Simbolet e lejuara (me presje)"><input value={cfg.auto_symbols} onChange={e => set('auto_symbols', e.target.value)} placeholder="XAUUSD" className="inp" /></Field>
        </div>
        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
          Kur <span className="text-amber-400">Auto-trade</span> është ON, sinjalet BLEJ/SHIT për këto simbole me besueshmëri ≥ pragut
          ekzekutohen <span className="text-white">automatikisht</span> në MT5 (çdo minutë), brenda mbrojtjeve të rrezikut.
        </p>
      </div>

      {/* Toggles */}
      <div className="flex flex-wrap gap-3">
        <Toggle on={cfg.mode === 'live'} onClick={() => set('mode', cfg.mode === 'demo' ? 'live' : 'demo')}
          label={cfg.mode === 'demo' ? 'Mode: DEMO' : 'Mode: LIVE'} danger={cfg.mode === 'live'} icon={Cloud} />
        <Toggle on={cfg.auto_trade} onClick={() => set('auto_trade', !cfg.auto_trade)} label="Auto-trade" icon={Play} />
        <Toggle on={cfg.kill_switch} onClick={() => set('kill_switch', !cfg.kill_switch)} label="Kill-switch" danger icon={Power} />
      </div>

      {cfg.mode === 'live' && (
        <div className="flex items-center gap-2 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-red-400">
          <AlertCircle className="w-4 h-4" /> Mode LIVE përdor para reale. Sigurohu që e ke testuar në demo.
        </div>
      )}

      {msg && (
        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{msg.text}
        </div>
      )}

      {/* Veprimet */}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn-amber">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Ruaj cilësimet
        </button>
        <button onClick={testConnection} disabled={!configured || !!busy} className="btn-ghost">
          {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}Testo lidhjen
        </button>
        <button onClick={() => testTrade('BUY')} disabled={!configured || !!busy} className="btn-green">
          {busy === 'BUY' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}Test BLEJ XAUUSD
        </button>
        <button onClick={() => testTrade('SELL')} disabled={!configured || !!busy} className="btn-red">
          {busy === 'SELL' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}Test SHIT XAUUSD
        </button>
      </div>

      {/* Ekzekutimet e fundit */}
      {executions.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Ekzekutimet e fundit</div>
          <div className="space-y-1.5">
            {executions.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className={`font-bold ${e.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{e.action === 'BUY' ? 'BLEJ' : 'SHIT'}</span>
                  <span className="text-white">{e.symbol}</span>
                  <span className="text-gray-500">{e.volume} lot · {e.mode}</span>
                </span>
                <span className={`px-2 py-0.5 rounded-full ${e.status === 'executed' ? 'bg-green-500/15 text-green-400' : e.status === 'rejected' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                  {e.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .inp { width:100%; background:#1f2937; border:1px solid #374151; border-radius:0.75rem; padding:0.55rem 0.75rem; color:#fff; font-size:0.8rem; outline:none; }
        .inp:focus { border-color:#f59e0b; }
        .btn-amber,.btn-ghost,.btn-green,.btn-red { display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:600; padding:0.55rem 0.9rem; border-radius:0.75rem; transition:all .15s; }
        .btn-amber { background:#f59e0b; color:#0a0a0a; }
        .btn-amber:disabled { opacity:.5; }
        .btn-ghost { background:#1f2937; color:#d1d5db; border:1px solid #374151; }
        .btn-green { background:rgba(34,197,94,.15); color:#4ade80; border:1px solid rgba(34,197,94,.3); }
        .btn-red { background:rgba(239,68,68,.15); color:#f87171; border:1px solid rgba(239,68,68,.3); }
        .btn-green:disabled,.btn-red:disabled,.btn-ghost:disabled { opacity:.5; }
      `}</style>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label, icon: Icon, danger }: { on: boolean; onClick: () => void; label: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
        on
          ? danger ? 'bg-red-500/15 text-red-400 border-red-500/40' : 'bg-green-500/15 text-green-400 border-green-500/40'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
      }`}>
      <Icon className="w-3.5 h-3.5" />{label}: {on ? 'ON' : 'OFF'}
    </button>
  );
}

function errText(code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: 'Plotëso Account ID dhe Token, pastaj ruaj.',
    metaapi_unreachable: 'S\'u arrit MetaApi — kontrollo token-in, account-id dhe rajonin.',
    kill_switch: 'Kill-switch është aktiv — çaktivizoje për të tregtuar.',
    max_open_trades: 'Arritur limiti i pozicioneve të hapura.',
    max_daily_loss: 'Arritur limiti i humbjes ditore.',
    trade_failed: 'MetaApi e refuzoi urdhrin.',
  };
  return map[code] || message || code;
}
