import { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, Loader2, Search, Wifi, WifiOff, Power, PowerOff, ShieldCheck, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

// MONITORI I LIDHJEVE MT5 (i rindërtuar, 2 gusht 2026).
// Versioni i vjetër lexonte tabelën 'metatrader_connections' që ka 0 rreshta — faqja dilte
// gjithmonë bosh. Lidhjet REALE janë te 'metaapi_config'; lexohen përmes RPC-së admin-të-sigurt
// 'admin_metaapi_overview' (token-at NUK ekspozohen kurrë — kthehet vetëm po/jo).
interface Row {
  user_id: string;
  username: string | null;
  full_name: string | null;
  mode: string | null;
  region: string | null;
  auto_trade: boolean;
  kill_switch: boolean;
  has_account: boolean;
  has_token: boolean;
  last_connected_at: string | null;
  disconnect_since: string | null;
  updated_at: string | null;
}

export default function AdminMetaTraderPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_metaapi_overview');
    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = rows.filter(r =>
    (r.username || '').toLowerCase().includes(q) || (r.full_name || '').toLowerCase().includes(q));

  const connected = rows.filter(r => r.has_account && r.has_token && !r.disconnect_since).length;
  const disconnected = rows.filter(r => !!r.disconnect_since).length;
  const autoOn = rows.filter(r => r.auto_trade && !r.kill_switch).length;

  const fmtTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{t('Lidhjet MT5 (MetaApi)')}</h2>
            <p className="text-gray-500 text-xs">{t('Llogaritë reale të lidhura të përdoruesve — pa ekspozuar asnjë kredencial.')}</p>
          </div>
        </div>
        <button onClick={load} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('Të lidhur'), value: connected, icon: Wifi, cls: 'text-emerald-400 bg-emerald-500/10' },
          { label: t('Të shkëputur'), value: disconnected, icon: WifiOff, cls: 'text-red-400 bg-red-500/10' },
          { label: t('Auto-trade aktiv'), value: autoOn, icon: Power, cls: 'text-amber-400 bg-amber-500/10' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-xs">{c.label}</span>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.cls}`}><Icon className="w-4 h-4" /></div>
              </div>
              <div className="text-2xl font-bold text-white">{c.value}</div>
            </div>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Kërko përdorues...')}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500" />
      </div>

      {err && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-900 rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 font-medium px-4 py-3">{t('Përdoruesi')}</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">{t('Modaliteti')}</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">{t('Rajoni')}</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">{t('Konfigurimi')}</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">Auto-trade</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">{t('Gjendja')}</th>
                  <th className="text-right text-gray-500 font-medium px-4 py-3">{t('Lidhur së fundi')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(r => (
                  <tr key={r.user_id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{r.full_name || r.username || r.user_id.slice(0, 8)}</div>
                      {r.username && <div className="text-gray-500 text-xs">{r.username}</div>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.mode === 'live' ? 'bg-red-500/15 text-red-300' : 'bg-sky-500/15 text-sky-300'}`}>
                        {(r.mode || 'demo').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">{r.region || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {r.has_account && r.has_token
                        ? <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><ShieldCheck className="w-3.5 h-3.5" />{t('I plotë')}</span>
                        : <span className="inline-flex items-center gap-1 text-amber-400 text-xs"><ShieldAlert className="w-3.5 h-3.5" />{t('I paplotë')}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.kill_switch
                        ? <span className="inline-flex items-center gap-1 text-red-400 text-xs"><PowerOff className="w-3.5 h-3.5" />{t('Ndalur')}</span>
                        : r.auto_trade
                          ? <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><Power className="w-3.5 h-3.5" />ON</span>
                          : <span className="text-gray-500 text-xs">OFF</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.disconnect_since
                        ? <span className="inline-flex items-center gap-1 text-red-400 text-xs"><WifiOff className="w-3.5 h-3.5" />{t('Shkëputur')}</span>
                        : <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><Wifi className="w-3.5 h-3.5" />{t('Në rregull')}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">{fmtTime(r.last_connected_at || r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">{t('Asnjë llogari MT5 e konfiguruar ende.')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
