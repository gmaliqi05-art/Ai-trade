// Paneli MetaApi — KONFIGURIMI i lidhjes MT5 + mbrojtja e rrezikut + auto-trade.
// Ristrukturuar në seksione të qarta sipas funksionit; çdo fushë ka shpjegimin e vet.
// Veprimet e tregtimit (BLEJ/SHIT) dhe pozicionet janë te faqja "Tregto Live".

import { useEffect, useState, useCallback } from 'react';
import {
  Cloud, Loader2, ShieldAlert, Power, CheckCircle, AlertCircle, Play, Save,
  Eye, EyeOff, Layers, ChevronDown, Gauge, TrendingUp, Zap,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useAuth } from '../context/AuthContext';
import {
  loadMetaApiConfig, saveMetaApiConfig, checkMetaApiConnection,
  DEFAULT_CONFIG, type MetaApiConfig,
} from '../services/metaapi';

const REGIONS = ['new-york', 'london', 'singapore'];

export default function MetaApiPanel() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<MetaApiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const c = await loadMetaApiConfig(user.id);
    setCfg(c); setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  // Ndryshon dhe RUAN menjëherë — për kontrollet kritike (Auto-trade, Kill-switch, Mode, strategjitë).
  const setAndSave = async <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    if (!user) return;
    setMsg(null);
    try {
      await saveMetaApiConfig(user.id, next);
      setMsg({ type: 'success', text: t('U ruajt automatikisht.') });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true); setMsg(null);
    try { await saveMetaApiConfig(user.id, cfg); setMsg({ type: 'success', text: t('Cilësimet u ruajtën.') }); }
    catch (e) { setMsg({ type: 'error', text: (e as Error).message }); }
    setSaving(false);
  };

  const testConnection = async () => {
    setBusy('check'); setMsg(null);
    const r = await checkMetaApiConnection();
    if (r.error) setMsg({ type: 'error', text: errText(t, r.error, r.message) });
    else setMsg({ type: 'success', text: t('Lidhja OK ({mode}). Llogaria u arrit.', { mode: r.mode }) });
    setBusy(null);
  };

  if (loading) return <div className="h-40 bg-gray-800 rounded-2xl animate-pulse" />;

  const configured = !!(cfg.account_id && cfg.token);

  return (
    <div className="space-y-4">
      {/* ======= TITULLI + STATUSI ======= */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-white font-semibold flex items-center gap-2"><Cloud className="w-5 h-5 text-amber-400" />{t('Lidhja & Konfigurimi (MetaApi)')}</h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full border ${configured ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
            {configured ? t('I lidhur') : t('Pa lidhur')}
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full border ${cfg.mode === 'demo' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
            {cfg.mode === 'demo' ? t('DEMO') : t('LIVE — para reale')}
          </span>
        </div>
      </div>

      {/* ======= KONTROLLET KRYESORE (ruhen menjëherë) ======= */}
      <Section icon={Power} title={t('Kontrollet kryesore')} subtitle={t('Ndez/fik tregtimin automatik dhe sigurinë. Ruhen menjëherë.')}>
        <div className="grid sm:grid-cols-3 gap-3">
          <BigToggle
            on={cfg.auto_trade} onClick={() => setAndSave('auto_trade', !cfg.auto_trade)} icon={Play}
            title={t('Auto-trade')} desc={t('Roboti hap trade vetë sipas sinjaleve dhe modeleve aktive.')} />
          <BigToggle
            on={cfg.mode === 'live'} onClick={() => setAndSave('mode', cfg.mode === 'demo' ? 'live' : 'demo')} icon={Cloud} danger={cfg.mode === 'live'}
            title={cfg.mode === 'demo' ? t('Mode: DEMO') : t('Mode: LIVE')} desc={cfg.mode === 'demo' ? t('Para virtuale — pa rrezik. Ideale për test.') : t('PARA REALE. Sigurohu që e ke testuar në demo.')} onLabel={cfg.mode === 'live' ? 'LIVE' : 'DEMO'} forceOnColor={cfg.mode === 'live'} />
          <BigToggle
            on={cfg.kill_switch} onClick={() => setAndSave('kill_switch', !cfg.kill_switch)} icon={Power} danger
            title={t('Kill-switch')} desc={t('ON = ndalon menjëherë çdo trade të ri (urgjencë).')} />
        </div>
        {cfg.mode === 'live' && (
          <div className="flex items-center gap-2 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" /> {t('Mode LIVE përdor para reale. Sigurohu që e ke testuar në demo.')}
          </div>
        )}
      </Section>

      {/* ======= 1. LIDHJA ME MT5 ======= */}
      <Section icon={Cloud} title={t('1. Lidhja me MT5')} subtitle={t('Lidh llogarinë tënde MT5 (Vantage) përmes MetaApi.cloud.')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('MetaApi Account ID')}>
            <input value={cfg.account_id} onChange={e => set('account_id', e.target.value)} placeholder={t('p.sh. 0a1b2c3d-...')} className="inp" />
          </Field>
          <Field label={t('Rajoni (i njëjti si te MetaApi)')}>
            <select value={cfg.region} onChange={e => set('region', e.target.value)} className="inp">
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label={t('MetaApi Token')} full>
            <div className="relative">
              <input type={showToken ? 'text' : 'password'} value={cfg.token} onChange={e => set('token', e.target.value)}
                placeholder={t('token-i nga metaapi.cloud')} className="inp pr-9" />
              <button onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving} className="btn-amber">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj cilësimet')}
          </button>
          <button onClick={testConnection} disabled={!configured || !!busy} className="btn-ghost">
            {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}{t('Testo lidhjen')}
          </button>
        </div>

        {/* Udhëzuesi hap-pas-hapi (i palosur) */}
        <button onClick={() => setShowGuide(s => !s)} className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showGuide ? 'rotate-180' : ''}`} />{t('Si të lidhësh robotin me MT5 (4 hapa)')}
        </button>
        {showGuide && (
          <ol className="space-y-2 text-[11px] text-gray-300 leading-relaxed bg-gray-800/40 border border-gray-700/50 rounded-xl p-3">
            <li className="flex gap-2"><span className="text-amber-400 font-bold">1.</span><span dangerouslySetInnerHTML={{ __html: t('<strong class="text-white">Llogaria MT5 (Vantage)</strong> — duhet ta kesh tashmë (Login, Password, Server p.sh. <code class="text-amber-300">VantageInternational-Demo</code>). Nëse jo, hape te <a href="https://www.vantagemarkets.com/" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline">vantagemarkets.com</a> ose shkarko <a href="https://www.metatrader5.com/en/download" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline">MetaTrader 5</a>.') }} /></li>
            <li className="flex gap-2"><span className="text-amber-400 font-bold">2.</span><span dangerouslySetInnerHTML={{ __html: t('Hap <a href="https://app.metaapi.cloud/accounts" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline font-semibold">app.metaapi.cloud/accounts</a> → krijo llogari falas → <strong class="text-white"> Add account</strong> → zgjidh MT5 dhe fut Login/Password/Server-in e Vantage. MetaApi e lidh në cloud dhe të jep një <strong class="text-white">Account ID</strong>.') }} /></li>
            <li className="flex gap-2"><span className="text-amber-400 font-bold">3.</span><span dangerouslySetInnerHTML={{ __html: t('Hap <a href="https://app.metaapi.cloud/token" target="_blank" rel="noopener noreferrer" class="text-amber-400 underline font-semibold">app.metaapi.cloud/token</a> → krijo një <strong class="text-white">API Token</strong> dhe kopjoje.') }} /></li>
            <li className="flex gap-2"><span className="text-amber-400 font-bold">4.</span><span dangerouslySetInnerHTML={{ __html: t('Ngjit <strong class="text-white">Account ID</strong> + <strong class="text-white">Token</strong> poshtë, zgjidh rajonin, kliko <strong class="text-white">Ruaj</strong> → <strong class="text-white">Testo lidhjen</strong>.') }} /></li>
          </ol>
        )}
      </Section>

      {/* ======= 2. MBROJTJA E RREZIKUT (globale) ======= */}
      <Section icon={ShieldAlert} title={t('2. Mbrojtja e rrezikut')} subtitle={t('Këto kufij vlejnë për ÇDO trade — manual, swing dhe scalp.')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <NumField label={t('Lot default')} hint={t('Madhësia bazë e çdo trade-i (0.01 = minimale, rrezik më i vogël).')}
            value={cfg.default_lot} step="0.01" min="0.01" onChange={v => set('default_lot', v)} onBlur={save} />
          <NumField label={t('Lot maksimal')} hint={t('Kufiri i sipërm — asnjë trade s\'e kalon këtë lot.')}
            value={cfg.max_lot} step="0.01" min="0.01" onChange={v => set('max_lot', v)} onBlur={save} />
          <NumField label={t('Humbja maks. ditore ($)')} hint={t('Kur humbja e ditës arrin këtë shumë ($), roboti ndalon trade-t e reja dhe kufizon SL-në e çdo trade-i.')}
            value={cfg.max_daily_loss} step="1" min="0" onChange={v => set('max_daily_loss', v)} onBlur={save} />
          <NumField label={t('Pozicione maks. njëkohësisht')} hint={t('Sa trade mund të jenë hapur në të njëjtën kohë (p.sh. 3).')}
            value={cfg.max_open_trades} step="1" min="1" onChange={v => set('max_open_trades', v)} onBlur={save} />
          <NumField label={t('Rreziku per-trade (%)')} hint={t('% e kapitalit që rrezikon çdo trade (profesionalisht 1%). Loti llogaritet vetë nga kjo + distanca e SL-së.')}
            value={cfg.risk_per_trade_pct} step="0.1" min="0" onChange={v => set('risk_per_trade_pct', v)} onBlur={save} full />
        </div>
      </Section>

      {/* ======= 3. MADHËSIA E POZICIONIT (lot dinamik) ======= */}
      <Section icon={Gauge} title={t('3. Madhësia sipas besueshmërisë')} subtitle={t('Sa më e fortë analiza, aq më i madh loti.')}
        right={<TogglePill on={cfg.dynamic_lot} onClick={() => setAndSave('dynamic_lot', !cfg.dynamic_lot)} t={t} />}>
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 transition-opacity ${cfg.dynamic_lot ? '' : 'opacity-40 pointer-events-none'}`}>
          <NumField label={t('Lot kur ≥ 70%')} hint={t('Besueshmëri e mesme → pozicion bazë.')} value={cfg.lot_conf_70} step="0.01" min="0.01" onChange={v => set('lot_conf_70', v)} onBlur={save} />
          <NumField label={t('Lot kur ≥ 80%')} hint={t('Besueshmëri e mirë → pozicion më i madh.')} value={cfg.lot_conf_80} step="0.01" min="0.01" onChange={v => set('lot_conf_80', v)} onBlur={save} />
          <NumField label={t('Lot kur ≥ 90%')} hint={t('Besueshmëri shumë e lartë → pozicioni maksimal.')} value={cfg.lot_conf_90} step="0.01" min="0.01" onChange={v => set('lot_conf_90', v)} onBlur={save} />
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Loti nuk kalon kurrë <span class="text-gray-300">Lot maksimal</span>. Kur <span class="text-gray-300">JOAKTIV</span>, përdoret gjithmonë <span class="text-gray-300">Lot default</span>.') }} />
      </Section>

      {/* ======= 4. AUTO-EKZEKUTIMI I SINJALEVE ======= */}
      <Section icon={Play} title={t('4. Auto-ekzekutimi i sinjaleve')} subtitle={t('Filtrat që vendosin cilat sinjale hyjnë automatik (kur Auto-trade është ON).')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <NumField label={t('Besueshmëri minimale (%)')} hint={t('Vetëm sinjalet me besueshmëri ≥ këtij pragu ekzekutohen auto.')}
            value={cfg.min_confidence} step="1" min="0" max="100" onChange={v => set('min_confidence', v)} onBlur={save} />
          <Field label={t('Simbolet e lejuara (me presje)')}>
            <input value={cfg.auto_symbols} onChange={e => set('auto_symbols', e.target.value)} onBlur={save} placeholder="XAUUSD" className="inp" />
            <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Vetëm këto simbole tregtohen automatik (p.sh. XAUUSD).')}</p>
          </Field>
        </div>
      </Section>

      {/* ======= 5. MODELET E TREGTIMIT ======= */}
      <Section icon={Layers} title={t('5. Modelet e tregtimit')} subtitle={t('Zgjidh cilat modele do të përdorë roboti. Mund t\'i mbash të dyja aktive.')}>
        {/* Tabela krahasuese */}
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-500 bg-gray-800/40">
                <th className="text-left font-medium px-3 py-2">{t('Modeli')}</th>
                <th className="text-left font-medium px-3 py-2">{t('Grafikët')}</th>
                <th className="text-left font-medium px-3 py-2">{t('Frekuenca')}</th>
                <th className="text-left font-medium px-3 py-2">{t('SL / TP')}</th>
                <th className="text-right font-medium px-3 py-2">{t('Gjendja')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              <tr>
                <td className="px-3 py-2 text-white font-medium flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-green-400" />{t('Afat-gjatë (swing)')}</td>
                <td className="px-3 py-2 text-gray-300">15m / 1h / 4h</td>
                <td className="px-3 py-2 text-gray-300">{t('I rrallë')}</td>
                <td className="px-3 py-2 text-gray-300">{t('nga ATR (i gjerë)')}</td>
                <td className="px-3 py-2 text-right">{cfg.strategy_swing ? <span className="text-green-400 font-semibold">{t('AKTIV')}</span> : <span className="text-gray-500">{t('JOAKTIV')}</span>}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-white font-medium flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" />{t('Afat-shkurt (scalp)')}</td>
                <td className="px-3 py-2 text-gray-300">1m / 5m</td>
                <td className="px-3 py-2 text-gray-300">{t('Shpesh')}</td>
                <td className="px-3 py-2 text-gray-300">{t('fiks (i ngushtë)')}</td>
                <td className="px-3 py-2 text-right">{cfg.strategy_scalp ? <span className="text-amber-400 font-semibold">{t('AKTIV')}</span> : <span className="text-gray-500">{t('JOAKTIV')}</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Karta SWING */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.strategy_swing ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-400" />{t('Afat-gjatë (swing)')}</span>
            <button onClick={() => setAndSave('strategy_swing', !cfg.strategy_swing)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.strategy_swing ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.strategy_swing ? t('AKTIV') : t('JOAKTIV')}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Analiza klasike e robotit në grafikët <span class="text-gray-300">15m / 1h / 4h</span>. Trade më të rralla, SL/TP të gjera (nga ATR), të konfirmuara nga Roboti. Më e qëndrueshme. Përdor mbrojtjen e rrezikut sipër — pa parametra shtesë.') }} />
        </div>

        {/* Karta SCALP — me parametrat e veta brenda */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.strategy_scalp ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />{t('Afat-shkurt (scalp)')}</span>
            <button onClick={() => setAndSave('strategy_scalp', !cfg.strategy_scalp)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.strategy_scalp ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.strategy_scalp ? t('AKTIV') : t('JOAKTIV')}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Roboti përcjell tregun çdo minutë në <span class="text-gray-300">1m / 5m</span> dhe hyn në lëvizje të shpejta me SL/TP të ngushtë. Del herët për të mbajtur profitin. Më shumë trade, më aktiv.') }} />

          {/* Nën-parametrat e scalp */}
          <div className={`mt-3 space-y-3 transition-opacity ${cfg.strategy_scalp ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <div className="pr-3">
                <span className="text-[12px] font-semibold text-white">{t('Hyr edhe në lëvizje të vogla')}</span>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{t('ON = shumë më shumë trade (vetëm trend, pa pritur breakout), por më shumë humbje të vogla.')}</p>
              </div>
              <button onClick={() => setAndSave('scalp_small_moves', !cfg.scalp_small_moves)}
                className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.scalp_small_moves ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
                {cfg.scalp_small_moves ? t('AKTIV') : t('JOAKTIV')}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <NumField label={t('SL scalp ($ lëvizje)')} hint={t('Mbyll trade-in nëse ari shkon kaq $ kundër (p.sh. 2).')} value={cfg.scalp_sl_usd} step="0.1" min="0.3" onChange={v => set('scalp_sl_usd', v)} onBlur={save} />
              <NumField label={t('TP scalp ($ lëvizje)')} hint={t('Merr fitimin kur ari shkon kaq $ në favor (p.sh. 4).')} value={cfg.scalp_tp_usd} step="0.1" min="0.3" onChange={v => set('scalp_tp_usd', v)} onBlur={save} />
              <NumField label={t('Scalp maks. njëkohësisht')} hint={t('Sa pozicione scalp lejohen në të njëjtën kohë.')} value={cfg.scalp_max_trades} step="1" min="1" onChange={v => set('scalp_max_trades', v)} onBlur={save} />
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('<span class="text-amber-400 font-semibold">ℹ️ Mbrojtja "qëndro në profit":</span> sapo trade-i shkon në fitim, SL ngrihet drejt hyrjes; nëse momentumi kthehet, mbyllet që të mbash fitimin. <span class="text-gray-400">SL shumë i ngushtë (p.sh. 2$) preket shpesh nga zhurma — normale për scalp.</span>') }} />
          </div>
        </div>
      </Section>

      {/* ======= 6. MBROJTJA E FITIMIT (TRAILING SL) ======= */}
      <Section icon={TrendingUp} title={t('6. Mbrojtja e fitimit (Trailing SL)')}
        subtitle={t('SL ndjek profitin automatik te ÇDO trade — mban një pjesë të fitimit kur çmimi ecën në favor.')}
        right={<TogglePill on={cfg.trail_enabled} onClick={() => setAndSave('trail_enabled', !cfg.trail_enabled)} t={t} />}>
        <div className={`space-y-3 transition-opacity ${cfg.trail_enabled ? '' : 'opacity-40 pointer-events-none'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-2.5">
              <label className="block text-[11px] font-medium text-gray-300 mb-1">{t('% e fitimit që mban SL')}</label>
              <div className="flex gap-1.5 mb-1.5">
                {[{ p: 25, l: '¼' }, { p: 33, l: '⅓' }, { p: 50, l: '½' }, { p: 66, l: '⅔' }].map(o => (
                  <button key={o.p} onClick={() => setAndSave('trail_lock_pct', o.p)}
                    className={`flex-1 text-[11px] py-1 rounded-lg border transition-colors ${Math.round(cfg.trail_lock_pct) === o.p ? 'bg-amber-500 text-gray-950 border-amber-500 font-semibold' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>{o.l} ({o.p}%)</button>
                ))}
              </div>
              <input type="number" step="1" min="5" max="95" value={cfg.trail_lock_pct} onChange={e => set('trail_lock_pct', +e.target.value)} onBlur={save} className="inp" />
              <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Sa shumë e fitimit mban SL ndërsa trade-i ecën. P.sh. 50% → kur je +10$, SL mban +5$; kur je +20$, SL mban +10$.')}</p>
            </div>
            <NumField label={t('Fillon pas (+$ fitim)')} hint={t('Trailing-u nis vetëm pasi fitimi kalon këtë shumë ($) — që SL të mos lëvizë nga zhurma e vogël.')}
              value={cfg.trail_start_usd} step="0.1" min="0.1" onChange={v => set('trail_start_usd', v)} onBlur={save} />
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('<span class="text-amber-400 font-semibold">ℹ️ Si punon:</span> roboti e kontrollon çdo minutë; sapo fitimi kalon pragun, SL zhvendoset për të mbajtur përqindjen e zgjedhur të fitimit, dhe ngjitet vetëm përpara (kurrë mbrapa). Vlen për të gjitha trade-t e hapura — manual, sinjal, swing, scalp.') }} />
        </div>
      </Section>

      {msg && (
        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{msg.text}
        </div>
      )}

      {/* Ruajtja finale (fushat numerike ruhen vetë on-blur; ky është rezervë) */}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn-amber">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj cilësimet')}
        </button>
      </div>

      <style>{`
        .inp { width:100%; background:#1f2937; border:1px solid #374151; border-radius:0.6rem; padding:0.5rem 0.7rem; color:#fff; font-size:0.8rem; outline:none; }
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

// —— Komponente ndihmëse ——

function Section({ icon: Icon, title, subtitle, right, children }: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string;
  right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-amber-400" /></div>
          <div>
            <h4 className="text-sm font-semibold text-white leading-tight">{title}</h4>
            {subtitle && <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-[11px] font-medium text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, hint, value, onChange, onBlur, step, min, max, full }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; onBlur: () => void;
  step?: string; min?: string; max?: string; full?: boolean;
}) {
  return (
    <div className={`bg-gray-800/40 border border-gray-700/50 rounded-xl p-2.5 ${full ? 'sm:col-span-2' : ''}`}>
      <label className="block text-[11px] font-medium text-gray-300 mb-1">{label}</label>
      <input type="number" step={step} min={min} max={max} value={value} onChange={e => onChange(+e.target.value)} onBlur={onBlur} className="inp" />
      {hint && <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
}

function TogglePill({ on, onClick, t }: { on: boolean; onClick: () => void; t: (k: string) => string }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
      {on ? t('AKTIV') : t('JOAKTIV')}
    </button>
  );
}

function BigToggle({ on, onClick, icon: Icon, title, desc, danger, onLabel, forceOnColor }: {
  on: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>;
  title: string; desc: string; danger?: boolean; onLabel?: string; forceOnColor?: boolean;
}) {
  const active = on || forceOnColor;
  const activeCls = danger ? 'bg-red-500/10 border-red-500/40' : 'bg-green-500/10 border-green-500/40';
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${active ? activeCls : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-semibold flex items-center gap-1.5 ${active ? (danger ? 'text-red-400' : 'text-green-400') : 'text-white'}`}>
          <Icon className="w-4 h-4" />{title}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? (danger ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400') : 'bg-gray-700 text-gray-400'}`}>
          {onLabel || (on ? 'ON' : 'OFF')}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">{desc}</p>
    </button>
  );
}

function errText(t: (key: string, params?: Record<string, string | number>) => string, code: string, message?: string): string {
  const map: Record<string, string> = {
    metaapi_not_configured: t('Plotëso Account ID dhe Token, pastaj ruaj.'),
    metaapi_unreachable: t('S\'u arrit MetaApi — kontrollo token-in, account-id dhe rajonin.'),
  };
  return map[code] || message || code;
}
