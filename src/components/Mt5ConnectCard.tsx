import { useState, useEffect, useCallback } from 'react';
import { Cloud, Loader2, Save, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import {
  loadMetaApiConfig, saveMetaApiConfigPartial, checkMetaApiConnection, metaApiErrorKey,
  DEFAULT_CONFIG, type MetaApiConfig,
} from '../services/metaapi';

// RAJONET E METAAPI-t. Lista është vetëm NDIHMESE, jo kufizuese: MetaApi shton vende të reja
// (dhe ka variante 'backup-…' për kopjet), ndaj një listë e ngurtë do të mbetej gjithmonë prapa.
// Rasti real, 4 gusht 2026: llogaria e një përdoruesi nuk lidhej dot nga 'london', ai krijoi një
// kopje te 'backup-new-york' — dhe ajo vlerë nuk ekzistonte fare te lista jonë, pra s'kishte si ta
// zgjidhte. Tani fusha pranon çdo tekst; këto janë thjesht sugjerime.
const REGIONS = ['new-york', 'london', 'singapore', 'backup-new-york', 'backup-london', 'backup-singapore'];

/**
 * Kartë E VETËMJAFTUESHME e lidhjes me MT5/MetaApi — Account ID, Rajoni, Token, Link rikonfigurimi,
 * Ruaj/Testo + udhëzimet 4-hapëshe. Vendoset te faqja Telegram Sin që lidhjet të bëhen prej andej
 * (kërkesa e pronarit: shumë faqe do të mbyllen me kod, kjo mbetet pika e vetme e konfigurimit).
 * S'prek fushat e tjera të konfigurimit (ruajtje e pjesshme).
 */
export default function Mt5ConnectCard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<MetaApiConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { setCfg(await loadMetaApiConfig(user.id)); setLoaded(true); } catch { setLoaded(false); }
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!user) return;
    if (!loaded) { setMsg({ type: 'error', text: t('Po ngarkohet konfigurimi — rifresko faqen para se të ruash.') }); return; }
    setSaving(true); setMsg(null);
    try {
      await saveMetaApiConfigPartial(user.id, { account_id: cfg.account_id, token: cfg.token, region: cfg.region, config_link: cfg.config_link });
      setMsg({ type: 'success', text: t('Cilësimet u ruajtën.') });
    } catch (e) { setMsg({ type: 'error', text: (e as Error).message }); }
    setSaving(false);
  };

  const testConnection = async () => {
    setBusy(true); setMsg(null);
    const r = await checkMetaApiConnection();
    // Gabimi teknik i MetaApi-t (JSON) përkthehet në një fjali që i thotë përdoruesit ÇFARË të bëjë.
    if (r.error) setMsg({ type: 'error', text: t(metaApiErrorKey(r.message)) });
    else setMsg({ type: 'success', text: t('Lidhja OK ({mode}). Llogaria u arrit.', { mode: r.mode }) });
    setBusy(false);
  };

  const configured = !!(cfg.account_id && cfg.token);
  const inp = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-400">{t('Roboti lidhet me llogarinë tënde MT5 përmes Account ID + Token.')}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${configured ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
          {configured ? t('I lidhur') : t('Pa lidhur')}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-gray-500">{t('MetaApi Account ID')}</span>
          <input value={cfg.account_id} onChange={e => set('account_id', e.target.value)} placeholder={t('p.sh. 0a1b2c3d-...')} className={inp} />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-500">{t('Rajoni (i njëjti si te MetaApi)')}</span>
          <input list="metaapi-regions" value={cfg.region}
            onChange={e => set('region', e.target.value.trim().toLowerCase())}
            placeholder="new-york" className={inp} />
          <datalist id="metaapi-regions">
            {REGIONS.map(r => <option key={r} value={r} />)}
          </datalist>
          <span className="block text-[10px] text-gray-600 mt-1">
            {t('Shkruaje saktësisht si te MetaApi — p.sh. london, new-york, backup-new-york.')}
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[11px] text-gray-500">{t('MetaApi Token')}</span>
          <div className="relative">
            <input type={showToken ? 'text' : 'password'} value={cfg.token} onChange={e => set('token', e.target.value)}
              placeholder={t('token-i nga metaapi.cloud')} className={`${inp} pr-9`} />
            <button onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[11px] text-gray-500">{t('Link rikonfigurimi (opsional)')}</span>
          <input value={cfg.config_link} onChange={e => set('config_link', e.target.value)} onBlur={save}
            placeholder={t('ngjit linkun nga MetaApi (configure-trading-account-credentials/...)')} className={inp} />
          {cfg.config_link && (
            <a href={cfg.config_link} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-colors">
              <Cloud className="w-3.5 h-3.5" />{t('Hap faqen e rikonfigurimit te MetaApi')}
            </a>
          )}
          <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Shkurtore për ta rregulluar lidhjen kur bie: hap faqen e MetaApi për të rifutur kredencialet. NUK është mënyrë lidhjeje — roboti lidhet me Account ID + Token.')}</p>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj cilësimet')}
        </button>
        <button onClick={testConnection} disabled={!configured || busy} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}{t('Testo lidhjen')}
        </button>
      </div>

      {msg && (
        <div className={`text-[11px] rounded-lg px-2.5 py-1.5 ${msg.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>
      )}

      <button onClick={() => setShowGuide(s => !s)} className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showGuide ? 'rotate-180' : ''}`} />{t('Si të lidhësh robotin me MT5 (4 hapa)')}
      </button>
      {showGuide && (
        <ol className="space-y-2 text-[11px] text-gray-300 leading-relaxed bg-black/30 border border-white/10 rounded-xl p-3">
          <li className="flex gap-2"><span className="text-amber-400 font-bold">1.</span><span dangerouslySetInnerHTML={{ __html: t('<strong class="text-white">Llogaria MT5 (Vantage)</strong> — duhet ta kesh tashmë (Login, Password, Server p.sh. <code class="text-amber-300">VantageInternational-Demo</code>). Nëse jo, hape te <a href="https://www.vantagemarkets.com/" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline">vantagemarkets.com</a> ose shkarko <a href="https://www.metatrader5.com/en/download" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline">MetaTrader 5</a>.') }} /></li>
          <li className="flex gap-2"><span className="text-amber-400 font-bold">2.</span><span dangerouslySetInnerHTML={{ __html: t('Hap <a href="https://app.metaapi.cloud/accounts" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline font-semibold">app.metaapi.cloud/accounts</a> → krijo llogari falas → <strong class="text-white"> Add account</strong> → zgjidh MT5 dhe fut Login/Password/Server-in e Vantage. MetaApi e lidh në cloud dhe të jep një <strong class="text-white">Account ID</strong>.') }} /></li>
          <li className="flex gap-2"><span className="text-amber-400 font-bold">3.</span><span dangerouslySetInnerHTML={{ __html: t('Hap <a href="https://app.metaapi.cloud/token" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline font-semibold">app.metaapi.cloud/token</a> → krijo një <strong class="text-white">API Token</strong> dhe kopjoje.') }} /></li>
          <li className="flex gap-2"><span className="text-amber-400 font-bold">4.</span><span dangerouslySetInnerHTML={{ __html: t('Ngjit <strong class="text-white">Account ID</strong> + <strong class="text-white">Token</strong> poshtë, zgjidh rajonin, kliko <strong class="text-white">Ruaj</strong> → <strong class="text-white">Testo lidhjen</strong>.') }} /></li>
        </ol>
      )}
    </div>
  );
}
