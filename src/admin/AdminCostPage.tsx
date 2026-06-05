// Paneli i admin-it: sa tokena & para shpenzon platforma nga AI (Claude/OpenAI/Gemini)
// dhe sa thirrje bën te MetaApi. Agregimet bëhen server-side me RPC get_usage_summary().
import { useCallback, useEffect, useState } from 'react';
import { Coins, Brain, Activity, RefreshCw, Loader2, Cpu, Server } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

interface AiModelRow { provider: string; model: string | null; calls: number; tokens: number; cost: number; }
interface MetaActionRow { action: string; calls: number; cost: number; }
interface Summary {
  ai_cost_month: number; ai_tokens_month: number; ai_calls_month: number;
  ai_cost_today: number; ai_calls_today: number;
  meta_calls_month: number; meta_cost_month: number; meta_calls_today: number;
  ai_by_model: AiModelRow[]; meta_by_action: MetaActionRow[];
}

const usd = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: (n || 0) < 1 ? 4 : 2, maximumFractionDigits: 4 })}`;
const num = (n: number) => Number(n || 0).toLocaleString('en-US');

export default function AdminCostPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase.rpc('get_usage_summary');
    if (error) setError(error.message);
    else setS(data as Summary);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const aiModels = s?.ai_by_model || [];
  const metaActions = s?.meta_by_action || [];
  const totalMonth = (s?.ai_cost_month || 0) + (s?.meta_cost_month || 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Coins className="w-6 h-6 text-amber-400" />{t('Kostot & përdorimi (API)')}</h2>
          <p className="text-gray-400 text-sm mt-1">{t('Sa tokena & para shpenzon platforma nga AI (Claude/OpenAI/Gemini) dhe MetaApi — muaji aktual.')}</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-700 rounded-xl transition-all"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center py-16"><Loader2 className="w-7 h-7 text-amber-400 animate-spin" /></div>
      ) : error ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-amber-300 text-sm">
          {t('Të dhënat e përdorimit ende s\'janë gati. Publiko në Bolt që të aplikohet migrimi (tabelat e përdorimit).')} <span className="text-amber-400/60">({error})</span>
        </div>
      ) : (
        <>
          {/* Kartat kryesore */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card icon={Coins} color="text-amber-400" label={t('Kosto totale (muaji)')} value={usd(totalMonth)} sub={t('AI + MetaApi')} />
            <Card icon={Brain} color="text-purple-400" label={t('Kosto AI (muaji)')} value={usd(s?.ai_cost_month || 0)} sub={t('{calls} thirrje · {tok} tokena', { calls: num(s?.ai_calls_month || 0), tok: num(s?.ai_tokens_month || 0) })} />
            <Card icon={Cpu} color="text-blue-400" label={t('AI sot')} value={usd(s?.ai_cost_today || 0)} sub={t('{calls} thirrje sot', { calls: num(s?.ai_calls_today || 0) })} />
            <Card icon={Server} color="text-green-400" label={t('MetaApi (muaji)')} value={usd(s?.meta_cost_month || 0)} sub={t('{calls} thirrje · {today} sot', { calls: num(s?.meta_calls_month || 0), today: num(s?.meta_calls_today || 0) })} />
          </div>

          {/* AI sipas modelit */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" /><h3 className="text-white font-semibold text-sm">{t('AI sipas modelit (muaji)')}</h3></div>
            {aiModels.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-6">{t('Asnjë thirrje AI këtë muaj.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-medium px-4 py-2">{t('Ofruesi · Modeli')}</th>
                    <th className="text-right font-medium px-4 py-2">{t('Thirrje')}</th>
                    <th className="text-right font-medium px-4 py-2">{t('Tokena')}</th>
                    <th className="text-right font-medium px-4 py-2">{t('Kosto')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {aiModels.map((g, i) => (
                      <tr key={i} className="hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 text-white">{g.provider} · {g.model || '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{num(g.calls)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{num(g.tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-400 font-semibold">{usd(g.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* MetaApi sipas veprimit */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2"><Activity className="w-4 h-4 text-green-400" /><h3 className="text-white font-semibold text-sm">{t('MetaApi sipas veprimit (muaji)')}</h3></div>
            {metaActions.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-6">{t('Asnjë thirrje MetaApi këtë muaj.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-medium px-4 py-2">{t('Veprimi')}</th>
                    <th className="text-right font-medium px-4 py-2">{t('Thirrje')}</th>
                    <th className="text-right font-medium px-4 py-2">{t('Kosto (vlerësim)')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {metaActions.map((g, i) => (
                      <tr key={i} className="hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 text-white font-medium">{g.action}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{num(g.calls)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-400 font-semibold">{usd(g.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-gray-600 text-xs text-center">{t('Kostot e AI janë të sakta nga tokenat e raportuara nga ofruesi. Kosto e MetaApi është vlerësim ($0.0005/thirrje) — rregullohet sipas planit tënd.')}</p>
        </>
      )}
    </div>
  );
}

function Card({ icon: Icon, color, label, value, sub }: { icon: React.ElementType; color: string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <Icon className={`w-4 h-4 mb-2 ${color}`} />
      <div className="text-white font-bold text-xl">{value}</div>
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
      <div className="text-gray-600 text-[11px] mt-1">{sub}</div>
    </div>
  );
}
