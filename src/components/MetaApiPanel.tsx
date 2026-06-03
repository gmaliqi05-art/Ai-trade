// Paneli MetaApi — KONFIGURIMI i lidhjes MT5 + mbrojtja e rrezikut + auto-trade.
// Veprimet e tregtimit (BLEJ/SHIT) dhe pozicionet janë te faqja "Tregto Live".

import { useEffect, useState, useCallback } from 'react';
import { Cloud, Loader2, ShieldAlert, Power, CheckCircle, AlertCircle, Play, Save, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  loadMetaApiConfig, saveMetaApiConfig, checkMetaApiConnection,
  DEFAULT_CONFIG, type MetaApiConfig,
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

  const refresh = useCallback(async () => {
    if (!user) return;
    const c = await loadMetaApiConfig(user.id);
    setCfg(c); setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  // Ndryshon dhe RUAN menjëherë — për kontrollet kritike të sigurisë
  // (Auto-trade, Kill-switch, Mode) që nuk duhet të varen nga butoni "Ruaj".
  const setAndSave = async <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    if (!user) return;
    setMsg(null);
    try {
      await saveMetaApiConfig(user.id, next);
      setMsg({ type: 'success', text: 'U ruajt automatikisht.' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

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

  if (loading) return <div className="h-40 bg-gray-800 rounded-2xl animate-pulse" />;

  const configured = cfg.account_id && cfg.token;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold flex items-center gap-2"><Cloud className="w-5 h-5 text-amber-400" />Lidhja & Konfigurimi (MetaApi)</h3>
        <span className={`text-xs px-2.5 py-1 rounded-full border ${cfg.mode === 'demo' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
          {cfg.mode === 'demo' ? 'DEMO' : 'LIVE — para reale'}
        </span>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Këtu lidh dhe konfiguron llogarinë MT5 (Vantage) përmes <span className="text-amber-400">MetaApi.cloud</span>.
        Tregtimi (BLEJ/SHIT) dhe pozicionet e hapura janë te faqja <span className="text-amber-400 font-medium">Tregto Live</span>.
      </p>

      {/* Udhëzues hap-pas-hapi me lidhje korrekte */}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 space-y-2.5">
        <div className="text-xs font-semibold text-white flex items-center gap-2">
          <Cloud className="w-4 h-4 text-amber-400" />Si të lidhësh robotin me MT5 (4 hapa)
        </div>
        <ol className="space-y-2 text-[11px] text-gray-300 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-amber-400 font-bold">1.</span>
            <span>
              <strong className="text-white">Llogaria MT5 (Vantage)</strong> — duhet ta kesh tashmë (Login, Password, Server p.sh. <code className="text-amber-300">VantageInternational-Demo</code>).
              Nëse jo, hape te <a href="https://www.vantagemarkets.com/" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">vantagemarkets.com</a> ose shkarko <a href="https://www.metatrader5.com/en/download" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">MetaTrader 5</a>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-400 font-bold">2.</span>
            <span>
              Hap <a href="https://app.metaapi.cloud/accounts" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline font-semibold">app.metaapi.cloud/accounts</a> → krijo llogari falas →
              <strong className="text-white"> Add account</strong> → zgjidh MT5 dhe fut Login/Password/Server-in e Vantage. MetaApi e lidh në cloud dhe të jep një <strong className="text-white">Account ID</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-400 font-bold">3.</span>
            <span>
              Hap <a href="https://app.metaapi.cloud/token" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline font-semibold">app.metaapi.cloud/token</a> → krijo një <strong className="text-white">API Token</strong> dhe kopjoje.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-400 font-bold">4.</span>
            <span>
              Ngjit <strong className="text-white">Account ID</strong> + <strong className="text-white">Token</strong> poshtë, zgjidh rajonin, kliko <strong className="text-white">Ruaj</strong> → <strong className="text-white">Testo lidhjen</strong>.
            </span>
          </li>
        </ol>
      </div>

      {/* Kredencialet */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="MetaApi Account ID">
          <input value={cfg.account_id} onChange={e => set('account_id', e.target.value)} placeholder="p.sh. 0a1b2c3d-..."
            className="inp" />
        </Field>
        <Field label="Rajoni (i njëjti si te MetaApi)">
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
          <Field label="Humbja maks. ditore ($)"><input type="number" step="1" value={cfg.max_daily_loss} onChange={e => set('max_daily_loss', +e.target.value)} className="inp" /></Field>
          <Field label="Pozicione maks. njëkohësisht"><input type="number" step="1" value={cfg.max_open_trades} onChange={e => set('max_open_trades', +e.target.value)} className="inp" /></Field>
        </div>
        {/* Sqarimi i fushave të rrezikut */}
        <ul className="mt-2.5 space-y-1 text-[11px] text-gray-500 leading-relaxed">
          <li><span className="text-gray-300">Lot default:</span> madhësia e çdo trade-i (0.01 = më i vogli, rrezik minimal).</li>
          <li><span className="text-gray-300">Lot maksimal:</span> kufiri i sipërm — asnjë trade s'kalon këtë lot.</li>
          <li><span className="text-gray-300">Humbja maks. ditore ($):</span> shumë <strong className="text-amber-400">në para</strong> (monedha e llogarisë). P.sh. <code className="text-amber-300">5</code> = (1) kur humbja e ditës arrin ~5$, roboti <strong>ndalon trade-t e reja</strong>; dhe (2) <strong>SL-ja e çdo trade-i auto kufizohet</strong> që humbja maks. e tij të mos kalojë ~5$. Vendos sa je gati të humbasësh maksimumi.</li>
          <li><span className="text-gray-300">Pozicione maks.:</span> sa trade mund të jenë hapur njëkohësisht (p.sh. 3).</li>
        </ul>
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
          ekzekutohen <span className="text-white">automatikisht</span> në MT5 (çdo minutë), brenda mbrojtjeve të rrezikut sipër.
        </p>
      </div>

      {/* Toggles të sigurisë */}
      <div className="flex flex-wrap gap-3">
        <Toggle on={cfg.mode === 'live'} onClick={() => setAndSave('mode', cfg.mode === 'demo' ? 'live' : 'demo')}
          label={cfg.mode === 'demo' ? 'Mode: DEMO' : 'Mode: LIVE'} danger={cfg.mode === 'live'} icon={Cloud} />
        <Toggle on={cfg.auto_trade} onClick={() => setAndSave('auto_trade', !cfg.auto_trade)} label="Auto-trade" icon={Play} />
        <Toggle on={cfg.kill_switch} onClick={() => setAndSave('kill_switch', !cfg.kill_switch)} label="Kill-switch" danger icon={Power} />
      </div>
      <p className="text-[11px] text-gray-500 -mt-2 flex items-center gap-1">
        <Power className="w-3 h-3 text-amber-400" /> Këto 3 butona ruhen <span className="text-gray-300">menjëherë</span>. <span className="text-gray-300">Kill-switch ON</span> ndalon çdo trade (urgjencë).
      </p>

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

      {/* Veprimet — vetëm ruajtja dhe testi i lidhjes */}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn-amber">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Ruaj cilësimet
        </button>
        <button onClick={testConnection} disabled={!configured || !!busy} className="btn-ghost">
          {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}Testo lidhjen
        </button>
      </div>

      <style>{`
        .inp { width:100%; background:#1f2937; border:1px solid #374151; border-radius:0.75rem; padding:0.55rem 0.75rem; color:#fff; font-size:0.8rem; outline:none; }
        .inp:focus { border-color:#f59e0b; }
        .btn-amber,.btn-ghost { display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:600; padding:0.55rem 0.9rem; border-radius:0.75rem; transition:all .15s; }
        .btn-amber { background:#f59e0b; color:#0a0a0a; }
        .btn-amber:disabled { opacity:.5; }
        .btn-ghost { background:#1f2937; color:#d1d5db; border:1px solid #374151; }
        .btn-ghost:disabled { opacity:.5; }
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
  };
  return map[code] || message || code;
}
