// Paneli MetaApi — KONFIGURIMI i lidhjes MT5 + mbrojtja e rrezikut + auto-trade.
// Ristrukturuar në seksione të qarta sipas funksionit; çdo fushë ka shpjegimin e vet.
// Veprimet e tregtimit (BLEJ/SHIT) dhe pozicionet janë te faqja "Tregto Live".

import { useEffect, useState, useCallback } from 'react';
import {
  Cloud, Loader2, ShieldAlert, Power, CheckCircle, AlertCircle, Play, Save,
  Eye, EyeOff, Layers, ChevronDown, Gauge, TrendingUp, Zap, Plus, X, Lock, Check, Clock,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useAuth } from '../context/AuthContext';
import {
  loadMetaApiConfig, saveMetaApiConfigPartial, checkMetaApiConnection,
  DEFAULT_CONFIG, type MetaApiConfig,
} from '../services/metaapi';

const REGIONS = ['new-york', 'london', 'singapore'];

// Rekomandime sipas kapitalit — vendosin cilesimet (rrezik/lot/SL-TP/limite) te shkallezuara
// nga sjellja aktuale fituese e robotit. Vetem pikenisje; perdoruesi i ndryshon vete me pas.
// NUK prek logjiken e robotit (auto-trade-runner) apo te sinjaleve (engine-scan).
const CAPITAL_PRESETS: { label: string; cfg: Partial<MetaApiConfig> }[] = [
  { label: '€100',    cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 5,    max_lot: 0.01, default_lot: 0.01, scalp_sl_usd: 2,   scalp_tp_usd: 4,    scalp_max_trades: 1, max_open_trades: 1, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 0.5 } },
  { label: '€500',    cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 25,   max_lot: 0.02, default_lot: 0.01, scalp_sl_usd: 3,   scalp_tp_usd: 6,    scalp_max_trades: 2, max_open_trades: 2, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 1 } },
  { label: '€1,000',  cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 50,   max_lot: 0.05, default_lot: 0.02, scalp_sl_usd: 4,   scalp_tp_usd: 8,    scalp_max_trades: 2, max_open_trades: 2, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 1 } },
  { label: '€5,000',  cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 250,  max_lot: 0.2,  default_lot: 0.05, scalp_sl_usd: 6,   scalp_tp_usd: 12,   scalp_max_trades: 3, max_open_trades: 3, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 1.5 } },
  { label: '€50,000', cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 1500, max_lot: 1,    default_lot: 0.5,  scalp_sl_usd: 20,  scalp_tp_usd: 40,   scalp_max_trades: 3, max_open_trades: 3, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 2 } },
  { label: '€100k',   cfg: { risk_per_trade_pct: 1, dynamic_lot: true, max_daily_loss: 3000, max_lot: 2,    default_lot: 0.5,  scalp_sl_usd: 100, scalp_tp_usd: 1000, scalp_max_trades: 3, max_open_trades: 3, trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 2 } },
];

// A përputhet plotësisht konfigurimi aktual me një preset kapitali? (për ta theksuar atë aktiv).
function presetActive(p: typeof CAPITAL_PRESETS[number], cfg: MetaApiConfig): boolean {
  return Object.entries(p.cfg).every(([k, v]) => {
    const cur = cfg[k as keyof MetaApiConfig];
    return typeof v === 'number' ? Number(cur) === v : cur === v;
  });
}

export default function MetaApiPanel() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<MetaApiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [connOpen, setConnOpen] = useState(false); // kredencialet — të palosura/mbyllura si default (mos i prek aksidentalisht)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // `loaded` bëhet true VETËM kur konfigurimi real u lexua me sukses. Pa këtë, asnjë ruajtje
  // nuk lejohet — që një gjendje DEFAULT (p.sh. nga sesion i skaduar) të mos mbishkruajë realin.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { const c = await loadMetaApiConfig(user.id); setCfg(c); setLoaded(true); }
    catch { setLoaded(false); /* dështim kalimtar → ruaj gjendjen; mos lejo ruajtje që mbishkruan */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  // Ndryshon dhe RUAN menjëherë — ruajtje E PJESSHME (vetëm fusha që ndryshoi), që të mos preken
  // fushat e tjera (p.sh. auto_trade). Bllokohet derisa konfigurimi real të jetë ngarkuar.
  const setAndSave = async <K extends keyof MetaApiConfig>(k: K, v: MetaApiConfig[K]) => {
    setCfg(p => ({ ...p, [k]: v }));
    if (!user) return;
    if (!loaded) { setMsg({ type: 'error', text: t('Po ngarkohet konfigurimi — rifresko faqen para se të ndryshosh.') }); return; }
    setMsg(null);
    try {
      await saveMetaApiConfigPartial(user.id, { [k]: v });
      setMsg({ type: 'success', text: t('U ruajt automatikisht.') });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  // Ndryshon DISA fusha njëherësh dhe i ruan (vetëm ato fusha) — p.sh. presetet, Trailing A/B.
  const setManyAndSave = async (patch: Partial<MetaApiConfig>) => {
    setCfg(p => ({ ...p, ...patch }));
    if (!user) return;
    if (!loaded) { setMsg({ type: 'error', text: t('Po ngarkohet konfigurimi — rifresko faqen para se të ndryshosh.') }); return; }
    setMsg(null);
    try {
      await saveMetaApiConfigPartial(user.id, patch);
      setMsg({ type: 'success', text: t('U ruajt automatikisht.') });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  // Apliko nje preset kapitali (shkruan ne te njejtat fusha si manualisht; pa prekur robotin).
  const applyPreset = (p: typeof CAPITAL_PRESETS[number]) => setManyAndSave(p.cfg);

  const save = async () => {
    if (!user) return;
    if (!loaded) { setMsg({ type: 'error', text: t('Po ngarkohet konfigurimi — rifresko faqen para se të ruash.') }); return; }
    setSaving(true); setMsg(null);
    // Ruaj gjithçka PËRVEÇ çelësave të kohës-reale (auto_trade, kill_switch) — ata ruhen vetëm nga
    // butonat e tyre, që "Ruaj cilësimet" të mos i ndryshojë kurrë pa dashje.
    const { auto_trade: _at, kill_switch: _ks, ...rest } = cfg;
    void _at; void _ks;
    try { await saveMetaApiConfigPartial(user.id, rest); setMsg({ type: 'success', text: t('Cilësimet u ruajtën.') }); }
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
            on={cfg.auto_trade}
            onClick={() => cfg.auto_trade
              ? setAndSave('auto_trade', false)
              /* Ndezja e Robotit të Sinjaleve fik robotët e tjerë — VETËM nëse "të dy njëkohësisht"
                 (allow_both_robots) është OFF. Kur është ON, FastT mbetet ashtu si është. */
              : setManyAndSave(cfg.allow_both_robots
                ? { auto_trade: true }
                : { auto_trade: true, strategy_scalp: false, scalp_live_enabled: false })}
            icon={Play}
            title={t('Auto-trade')} desc={t('Roboti hap trade vetë sipas sinjaleve. Ndezja fik robotët e tjerë (short/FastT).')} />
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
      <Section icon={Cloud} title={t('1. Lidhja me MT5')} subtitle={t('Kredencialet — kliko për të hapur. Mbyllur që të mos preksh aksidentalisht.')} collapsible open={connOpen} onToggle={() => setConnOpen(o => !o)}>
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
          <Field label={t('Link rikonfigurimi (opsional)')} full>
            <input value={cfg.config_link} onChange={e => set('config_link', e.target.value)} onBlur={save}
              placeholder={t('ngjit linkun nga MetaApi (configure-trading-account-credentials/...)')} className="inp" />
            {cfg.config_link && (
              <a href={cfg.config_link} target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-colors">
                <Cloud className="w-3.5 h-3.5" />{t('Hap faqen e rikonfigurimit te MetaApi')}
              </a>
            )}
            <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Shkurtore për ta rregulluar lidhjen kur bie: hap faqen e MetaApi për të rifutur kredencialet. NUK është mënyrë lidhjeje — roboti lidhet me Account ID + Token.')}</p>
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

      {/* ======= REKOMANDIME SIPAS KAPITALIT ======= */}
      <Section icon={Gauge} title={t('Rekomandime sipas kapitalit')} subtitle={t('Kliko sa kapital ke → cilesimet vendosen automatik (rrezik, lot, SL/TP, humbja ditore), te shkallezuara nga sjellja aktuale e robotit.')}>
        <div className="flex flex-wrap gap-2">
          {CAPITAL_PRESETS.map(p => {
            const active = presetActive(p, cfg);
            return (
            <button key={p.label} type="button" onClick={() => applyPreset(p)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-all ${active ? 'bg-amber-500 text-gray-950 border-amber-300 ring-2 ring-amber-400/40 shadow-lg shadow-amber-500/20' : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-amber-500/60 hover:text-amber-400'}`}>
              {p.label}
            </button>
            );
          })}
        </div>
        <p className="text-[11px] text-amber-300/90 mt-2.5 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t('Keto jane vetem REKOMANDIME — nuk prekin logjiken e robotit/sinjaleve. Pas aplikimit, cdo fushe mbetet plotesisht e ndryshueshme nga ti sipas deshires.')}
        </p>
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
          {([
            { thr: 'lot_conf_t1', lot: 'lot_conf_70', hint: t('Besueshmëri e mesme → pozicion bazë.') },
            { thr: 'lot_conf_t2', lot: 'lot_conf_80', hint: t('Besueshmëri e mirë → pozicion më i madh.') },
            { thr: 'lot_conf_t3', lot: 'lot_conf_90', hint: t('Besueshmëri shumë e lartë → pozicioni maksimal.') },
          ] as const).map((b) => (
            <div key={b.lot} className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-2.5">
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-300 mb-1">
                {t('Lot kur ≥')}
                <NumberBox value={cfg[b.thr]} onChange={v => set(b.thr, v)} onCommit={save} step="1" min="1" max="100"
                  className="w-12 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-white text-[11px] text-center focus:outline-none focus:border-amber-500" />%
              </label>
              <NumberBox value={cfg[b.lot]} onChange={v => set(b.lot, v)} onCommit={save} step="0.01" min="0.01" />
              <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{b.hint}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Loti nuk kalon kurrë <span class="text-gray-300">Lot maksimal</span>. Kur <span class="text-gray-300">JOAKTIV</span>, përdoret gjithmonë <span class="text-gray-300">Lot default</span>.') }} />
      </Section>

      {/* ======= 4. AUTO-EKZEKUTIMI I SINJALEVE ======= */}
      <Section icon={Play} title={t('4. Auto-ekzekutimi i sinjaleve')} subtitle={t('Filtrat që vendosin cilat sinjale hyjnë automatik (kur Auto-trade është ON).')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <NumField label={t('Besueshmëri minimale (%)')} hint={t('Vetëm sinjalet me besueshmëri ≥ këtij pragu ekzekutohen auto.')}
            value={cfg.min_confidence} step="1" min="0" max="100" onChange={v => set('min_confidence', v)} onBlur={save} />
          <Field label={t('Simbolet e lejuara')}>
            <SymbolPicker value={cfg.auto_symbols} onChange={v => setAndSave('auto_symbols', v)} />
            <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Ari (XAUUSD) është default. Shto të tjera vetëm nëse i mbështet brokeri yt.')}</p>
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
            {/* SL/TP AUTOMATIK nga analiza (opt-in) — kur ON, roboti i llogarit vetë dhe fushat manuale fiken */}
            <div className="flex items-center justify-between rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2.5">
              <div className="pr-3">
                <span className="text-[12px] font-semibold text-white">{t('SL/TP automatik nga analiza')}</span>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{t('ON = roboti i llogarit SL/TP plotësisht vetë, me të njëjtën analizë si hyrja (volatiliteti ATR) + balancën tënde — fushat manuale poshtë fiken. OFF = vlerat e tua; nëse i vendos në zonë të zhurmshme, roboti i balancon automatikisht.')}</p>
              </div>
              <button onClick={() => setAndSave('auto_sltp', !cfg.auto_sltp)}
                className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.auto_sltp ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
                {cfg.auto_sltp ? t('AKTIV') : t('JOAKTIV')}
              </button>
            </div>
            <div className={`space-y-2.5 transition-opacity ${cfg.auto_sltp ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <NumField label={t('SL scalp ($ lëvizje)')} hint={t('Mbyll trade-in nëse ari shkon kaq $ kundër (p.sh. 2).')} value={cfg.scalp_sl_usd} step="0.1" min="0.3" onChange={v => set('scalp_sl_usd', v)} onBlur={save} />
                <NumField label={t('TP scalp ($ lëvizje)')} hint={t('Merr fitimin kur ari shkon kaq $ në favor (p.sh. 4).')} value={cfg.scalp_tp_usd} step="0.1" min="0.3" onChange={v => set('scalp_tp_usd', v)} onBlur={save} />
                <NumField label={t('SL scalp naftë (% e çmimit)')} hint={t('Për USOIL/UKOIL: SL si PËRQINDJE e çmimit (p.sh. 0.4%). Nafta është më volatile se ari, prandaj përdor % e jo $ fiks.')} value={cfg.scalp_sl_pct_oil} step="0.05" min="0.05" onChange={v => set('scalp_sl_pct_oil', v)} onBlur={save} />
                <NumField label={t('TP scalp naftë (% e çmimit)')} hint={t('Për USOIL/UKOIL: TP si PËRQINDJE e çmimit (p.sh. 0.8%).')} value={cfg.scalp_tp_pct_oil} step="0.05" min="0.05" onChange={v => set('scalp_tp_pct_oil', v)} onBlur={save} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <NumField label={t('Scalp maks. njëkohësisht')} hint={t('Sa pozicione scalp lejohen në të njëjtën kohë.')} value={cfg.scalp_max_trades} step="1" min="1" onChange={v => set('scalp_max_trades', v)} onBlur={save} />
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('<span class="text-amber-400 font-semibold">ℹ️ Mbrojtja "qëndro në profit":</span> sapo trade-i shkon në fitim, SL ngrihet drejt hyrjes; nëse momentumi kthehet, mbyllet që të mbash fitimin. <span class="text-gray-400">SL shumë i ngushtë (p.sh. 2$) preket shpesh nga zhurma — normale për scalp.</span>') }} />
          </div>
        </div>

        {/* Karta SCALP-LIVE — robot scalping në kohë reale (cikël brenda minutës) */}
        {/* RREGULL: vetëm një robot njëherësh. Ndezja e FastT fik Robotin e Sinjaleve, dhe anasjelltas. */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.scalp_live_enabled ? 'bg-rose-500/10 border-rose-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-rose-400" />{t('FastT live (kohë reale)')}</span>
            <button
              onClick={() => cfg.scalp_live_enabled
                ? setAndSave('scalp_live_enabled', false)
                /* Ndezja e FastT-it fik Robotin e Sinjaleve VETËM nëse "të dy njëkohësisht" është OFF. */
                : setManyAndSave(cfg.allow_both_robots
                  ? { scalp_live_enabled: true }
                  : { scalp_live_enabled: true, auto_trade: false, strategy_scalp: false })}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.scalp_live_enabled ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.scalp_live_enabled ? t('AKTIV') : t('JOAKTIV')}
            </button>
          </div>
          {/* Opt-in: lejo Robotin e Sinjaleve + FastT njëkohësisht (përndryshe janë ekskluzivë). */}
          <label className="flex items-center justify-between gap-3 mt-3 cursor-pointer">
            <span className="text-[11px] text-gray-300 leading-snug">{t('Lejo të dy robotët njëkohësisht (Sinjalet + FastT)')}</span>
            <button onClick={() => setAndSave('allow_both_robots', !cfg.allow_both_robots)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${cfg.allow_both_robots ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.allow_both_robots ? t('AKTIV') : t('JOAKTIV')}
            </button>
          </label>
          {cfg.allow_both_robots && (
            <p className="text-[11px] text-emerald-400/90 mt-2">{t('Të dy robotët mund të punojnë bashkë. FastT s\'hap drejtim të kundërt mbi një pozicion ekzistues (anti-hedge).')}</p>
          )}
          {cfg.auto_trade && !cfg.scalp_live_enabled && !cfg.allow_both_robots && (
            <p className="text-[11px] text-amber-400/90 mt-2">{t('Ndezja e FastT do të fikë Robotin e Sinjaleve — vetëm një robot tregton njëherësh.')}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Robot <span class="text-gray-300">krejt i pavarur</span> që ndjek <span class="text-gray-300">qirinjtë live 1m (~çdo 2.5–5 sekonda)</span>: kap ngritjet → BLEJ dhe rëniet → SHIT drejtpërdrejt nga momentum-i i qirinjve, <span class="text-rose-300">pa u ndikuar nga motori/strategjitë e tjera</span>. Mbron fitimin shpejt dhe del në kthesë. <span class="text-rose-300">Pa TP/SL fiks</span> — vetëm një SL "katastrofe" i gjerë te brokeri si parashutë.') }} />

          {/* Nën-parametrat e scalp-live */}
          <div className={`mt-3 space-y-2.5 transition-opacity ${cfg.scalp_live_enabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <NumField label={t('Lot (fiks)')} hint={t('Madhësia e vogël e pozicionit për scalp-live (p.sh. 0.01).')} value={cfg.scalp_live_lot} step="0.01" min="0.01" onChange={v => set('scalp_live_lot', v)} onBlur={save} />
              <NumField label={t('Maks. njëkohësisht')} hint={t('Sa pozicione scalp-live lejohen në të njëjtën kohë.')} value={cfg.scalp_live_max_trades} step="1" min="1" onChange={v => set('scalp_live_max_trades', v)} onBlur={save} />
              <NumField label={t('Marzha e fitimit ($ lëvizje)')} hint={t('Sapo ari shkon kaq $ në favor, aktivizohet mbrojtja e fitimit (grab). P.sh. 0.50.')} value={cfg.scalp_live_grab_usd} step="0.05" min="0.05" onChange={v => set('scalp_live_grab_usd', v)} onBlur={save} />
              <NumField label={t('Kthim i lejuar nga maja ($)')} hint={t('Sa fitim lejohet të kthehet nga maja para se të mbyllet (trailing i ngushtë). P.sh. 0.25.')} value={cfg.scalp_live_giveback_usd} step="0.05" min="0.02" onChange={v => set('scalp_live_giveback_usd', v)} onBlur={save} />
              <NumField label={t('Prerje e hershme ($ kundër)')} hint={t('Hapësira e ri-testit: del nëse ari shkon kaq $ kundër (p.sh. 0.60), para SL-së katastrofe.')} value={cfg.scalp_live_cut_usd} step="0.05" min="0.05" onChange={v => set('scalp_live_cut_usd', v)} onBlur={save} />
              <NumField label={t('SL katastrofe ($ — parashutë)')} hint={t('SL i gjerë te brokeri si rrjetë sigurie nëse roboti/rrjeti bie (p.sh. 1.50). Mos e bëj shumë të vogël.')} value={cfg.scalp_live_catastrophe_usd} step="0.1" min="0.3" onChange={v => set('scalp_live_catastrophe_usd', v)} onBlur={save} />
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('<span class="text-rose-400 font-semibold">⚠️ Agresiv:</span> hyrje/dalje shumë të shpejta. Rekomandohet ta provosh fillimisht në <span class="text-gray-300">demo</span> dhe me lot 0.01 në live. Funksionon vetëm për arin (XAUUSD) gjatë orarit të tregut.') }} />
          </div>
        </div>

        {/* Karta FILTRA TË AVANCUAR (Tier-1) — opt-in, default JOAKTIV */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.advanced_filters ? 'bg-purple-500/10 border-purple-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-purple-400" />{t('Filtra të avancuar (Tier-1)')}</span>
            <button onClick={() => setAndSave('advanced_filters', !cfg.advanced_filters)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.advanced_filters ? 'bg-purple-500/15 text-purple-400 border-purple-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600'}`}>
              {cfg.advanced_filters ? t('AKTIV') : t('JOAKTIV')}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Shton filtra shtesë: <span class="text-gray-300">Efficiency Ratio + Supertrend</span>. <span class="text-gray-400">JOAKTIV (default) = logjika e thjeshtë e provuar (Multi-TF + EMA200 + ADX + volatilitet + trend ditor). Për Ar & Naftë rekomandohet JOAKTIV; ndize vetëm nëse do filtra më strikt.</span>') }} />
        </div>
      </Section>

      {/* ======= 6. MBROJTJA E FITIMIT (TRAILING SL) ======= */}
      <Section icon={TrendingUp} title={t('6. Mbrojtja e fitimit (Trailing SL)')}
        subtitle={t('SL ndjek profitin automatik. Zgjidh VETËM njërën metodë — A ose B. Ndezja e njërës e fik tjetrën vetë.')}>

        {/* Statusi: cila metodë është aktive tani (që përdoruesi ta dijë gjithmonë) */}
        <div className={`flex items-center gap-2 text-[11px] rounded-xl px-3 py-2 border ${
          cfg.broker_trailing ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : cfg.trail_enabled ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-gray-700/40 border-gray-600 text-gray-400'}`}>
          {cfg.broker_trailing || cfg.trail_enabled ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>
            {cfg.broker_trailing
              ? t('Aktive: Metoda B (MT5 tick-by-tick). Roboti NUK e prek SL-në.')
              : cfg.trail_enabled
                ? t('Aktive: Metoda A (Roboti %). Distanca fikse e MT5 është e fikur.')
                : t('Asnjë metodë trailing aktive — SL qëndron aty ku u vendos në hapje.')}
          </span>
        </div>

        {/* —— METODA A: Roboti (përqindje) —— */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.trail_enabled ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-400" />{t('Metoda A — Roboti (përqindje)')}</span>
            <TogglePill on={cfg.trail_enabled}
              onClick={() => setManyAndSave(cfg.trail_enabled ? { trail_enabled: false } : { trail_enabled: true, broker_trailing: false })} t={t} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Roboti kontrollon <span class="text-gray-300">çdo ~7 sekonda</span> dhe e ngjit SL-në që të mbajë një <span class="text-gray-300">përqindje të fitimit</span>. Ngjitet vetëm përpara (kurrë mbrapa). Vlen për të gjitha trade-t — manual, sinjal, swing, scalp.') }} />

          {/* Parametrat e Metodës A — dimohen kur A është JOAKTIVE */}
          <div className={`mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 transition-opacity ${cfg.trail_enabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl p-2.5">
              <label className="block text-[11px] font-medium text-gray-300 mb-1">{t('% e fitimit që mban SL')}</label>
              <div className="flex gap-1.5 mb-1.5">
                {[{ p: 25, l: '¼' }, { p: 33, l: '⅓' }, { p: 50, l: '½' }, { p: 66, l: '⅔' }].map(o => (
                  <button key={o.p} onClick={() => setAndSave('trail_lock_pct', o.p)}
                    className={`flex-1 text-[11px] py-1 rounded-lg border transition-colors ${Math.round(cfg.trail_lock_pct) === o.p ? 'bg-amber-500 text-gray-950 border-amber-500 font-semibold' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>{o.l} ({o.p}%)</button>
                ))}
              </div>
              <NumberBox value={cfg.trail_lock_pct} onChange={v => set('trail_lock_pct', v)} onCommit={save} step="1" min="5" max="95" />
              <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Sa shumë e fitimit mban SL ndërsa trade-i ecën. P.sh. 50% → kur je +10$, SL mban +5$; kur je +20$, SL mban +10$.')}</p>
            </div>
            <NumField label={t('Fillon pas (+$ fitim)')} hint={t('Trailing-u nis vetëm pasi fitimi kalon këtë shumë ($) — që SL të mos lëvizë nga zhurma e vogël.')}
              value={cfg.trail_start_usd} step="0.1" min="0.1" onChange={v => set('trail_start_usd', v)} onBlur={save} />
          </div>
        </div>

        {/* —— METODA B: MT5 tick-by-tick —— */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.broker_trailing ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />{t('Metoda B — Trailing në anë të MT5 (tick-by-tick)')}</span>
            <TogglePill on={cfg.broker_trailing}
              onClick={() => setManyAndSave(cfg.broker_trailing ? { broker_trailing: false } : { broker_trailing: true, trail_enabled: false })} t={t} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('MetaApi e ndjek SL-në <span class="text-gray-300">pas çdo tiku</span> në kohë reale, me <span class="text-gray-300">distancë fikse</span> (= distanca fillestare e SL) — JO me përqindje. Më e shpejtë se Metoda A, por distancë fikse. ⚠️ Eksperimentale — provoje në DEMO; jo çdo broker e mbështet.') }} />
          <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{t('Përqindja (%) e Metodës A nuk përdoret kur kjo metodë është aktive.')}</p>
        </div>

        {/* —— BREAK-EVEN AUTO (rrezik zero + offset) — i pavarur, mund të punojë bashkë me Metodën A —— */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.be_enabled ? 'bg-blue-500/10 border-blue-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Lock className="w-4 h-4 text-blue-400" />{t('Break-even auto (rrezik zero)')}</span>
            <TogglePill on={cfg.be_enabled} onClick={() => setAndSave('be_enabled', !cfg.be_enabled)} t={t} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Sapo trade-i të jetë mjaftueshëm në profit, SL kalon te <span class="text-gray-300">linja e hyrjes + offset</span> (p.sh. +9 pips) — pas kësaj trade-i <span class="text-gray-300">s\'mund të humbë</span>. Vlen për çdo trade (auto ose manual); ngjitet vetëm përpara.') }} />
          <div className={`mt-3 transition-opacity ${cfg.be_enabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <NumField label={t('Offset mbi hyrjen (në çmim $)')} hint={t('Sa $ mbi hyrjen bllokohet SL-ja. 0.9 ≈ 9 pips për ar (1 pip = $0.1). Aktivizohet kur fitimi kalon 2× këtë vlerë.')}
              value={cfg.be_offset_usd} step="0.1" min="0" onChange={v => set('be_offset_usd', v)} onBlur={save} />
          </div>
        </div>

        {/* UDHËZIM: si të zgjedhësh */}
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 space-y-1.5">
          <div className="text-[11px] font-semibold text-blue-300">{t('📘 Cilën të zgjedhësh?')}</div>
          <ul className="space-y-1 text-[10px] text-gray-400 leading-snug">
            <li dangerouslySetInnerHTML={{ __html: t('<span class="text-amber-400 font-semibold">Metoda A (Roboti, %):</span> mban p.sh. 50% të fitimit, çdo ~7s. <span class="text-gray-300">E rekomanduar për shumicën</span> — e parashikueshme dhe ndjek fitimin sipas %.') }} />
            <li dangerouslySetInnerHTML={{ __html: t('<span class="text-amber-400 font-semibold">Metoda B (MT5, tick-by-tick):</span> ndjek me distancë fikse pas çdo tiku — më e shpejtë, por jo me %. Provoje në DEMO së pari.') }} />
            <li dangerouslySetInnerHTML={{ __html: t('<span class="text-gray-300">Që trailing-u të punojë, çdo trade duhet të ketë SL.</span> Të dyja metodat e ngrenë SL vetëm përpara — kurrë mbrapa.') }} />
            <li dangerouslySetInnerHTML={{ __html: t('Nuk ka konflikt: kur ndez njërën metodë, tjetra fiket automatikisht.') }} />
          </ul>
        </div>
      </Section>

      {/* ======= 7. POROSITË PARA HAPJES SË TREGUT (fundjavë/natë) ======= */}
      <Section icon={Clock} title={t('7. Porositë para hapjes së tregut')}
        subtitle={t('Kur tregu është i mbyllur (fundjavë/natë) dhe ti hap një trade, si të trajtohet? Zgjidh VETËM njërën — A ose B.')}>

        {/* Statusi: cila rrugë është aktive tani */}
        <div className={`flex items-center gap-2 text-[11px] rounded-xl px-3 py-2 border ${
          cfg.preopen_mode === 'A' ? 'bg-blue-500/10 border-blue-500/30 text-blue-300' : 'bg-green-500/10 border-green-500/30 text-green-400'}`}>
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>
            {cfg.preopen_mode === 'A'
              ? t('Aktive: Rruga A (pending te brokeri). Porosia mbahet te niveli yt i hyrjes; hyn kur çmimi e prek.')
              : t('Aktive: Rruga B (radha jonë). Porosia hyn në treg automatik pikërisht kur hapet tregu.')}
          </span>
        </div>

        {/* —— RRUGA B: Radha jonë (default, e rekomanduar) —— */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.preopen_mode === 'B' ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Layers className="w-4 h-4 text-green-400" />{t('Rruga B — Radha jonë (e rekomanduar)')}</span>
            <TogglePill on={cfg.preopen_mode === 'B'} onClick={() => setAndSave('preopen_mode', 'B')} t={t} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Porosia ruhet te <span class="text-gray-300">radha jonë</span> dhe roboti e dërgon si <span class="text-gray-300">porosi tregu</span> pikërisht kur hapet tregu — hyn me çmimin e hapjes. <span class="text-gray-300">E parashikueshme dhe 100% nën kontrollin tonë</span> (s\'varet nga brokeri). Kërkon SL për siguri.') }} />
        </div>

        {/* —— RRUGA A: Pending te brokeri —— */}
        <div className={`rounded-xl border p-3.5 transition-colors ${cfg.preopen_mode === 'A' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-gray-800/40 border-gray-700'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white flex items-center gap-2"><Cloud className="w-4 h-4 text-blue-400" />{t('Rruga A — Pending te brokeri')}</span>
            <TogglePill on={cfg.preopen_mode === 'A'} onClick={() => setAndSave('preopen_mode', 'A')} t={t} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('Porosia dërgohet te brokeri si <span class="text-gray-300">pending (limit/stop)</span> te niveli yt i hyrjes — hyn vetëm kur çmimi e prek atë nivel pas hapjes. ⚠️ Jo çdo broker e pranon kur tregu është i mbyllur; nëse e refuzon, porosia bie automatik te radha (Rruga B) që të mos humbasë.') }} />
        </div>

        {/* UDHËZIM */}
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 space-y-1.5">
          <div className="text-[11px] font-semibold text-blue-300">{t('📘 Cilën të zgjedhësh?')}</div>
          <ul className="space-y-1 text-[10px] text-gray-400 leading-snug">
            <li dangerouslySetInnerHTML={{ __html: t('<span class="text-green-400 font-semibold">Rruga B (radha jonë):</span> hyn në hapje me çmimin e tregut, e parashikueshme. <span class="text-gray-300">E rekomanduar për shumicën.</span>') }} />
            <li dangerouslySetInnerHTML={{ __html: t('<span class="text-blue-300 font-semibold">Rruga A (pending te brokeri):</span> respekton nivelin tënd të hyrjes, por varet nga brokeri (mund të mos e pranojë kur tregu mbyllur).') }} />
            <li dangerouslySetInnerHTML={{ __html: t('Sapo hapet tregu, sistemi vepron sipas asaj që ke zgjedhur këtu. Ndezja e njërës e fik tjetrën vetë.') }} />
          </ul>
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

function Section({ icon: Icon, title, subtitle, right, children, collapsible, open = true, onToggle }: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string;
  right?: React.ReactNode; children: React.ReactNode;
  collapsible?: boolean; open?: boolean; onToggle?: () => void;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div onClick={collapsible ? onToggle : undefined}
          className={`flex items-start gap-2.5 ${collapsible ? 'cursor-pointer select-none flex-1' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-amber-400" /></div>
          <div>
            <h4 className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">{title}{collapsible && <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />}</h4>
            {subtitle && <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {(!collapsible || open) && children}
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
      <NumberBox value={value} onChange={onChange} onCommit={onBlur} step={step} min={min} max={max} />
      {hint && <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
}

// Fushë numerike e kontrolluar me BUFFER teksti: kur e fshin, mbetet bosh (pa "0" të detyruar
// para numrit) dhe ruan vetëm një numër të vlefshëm. Normalizohet (heq zerat udhëheqës) në blur.
function NumberBox({ value, onChange, onCommit, step, min, max, className }: {
  value: number; onChange: (v: number) => void; onCommit?: () => void;
  step?: string; min?: string; max?: string; className?: string;
}) {
  const [text, setText] = useState<string>(Number.isFinite(value) ? String(value) : '');

  // Sinkronizo vetëm kur vlera e jashtme (p.sh. butonat preset) ndryshon nga ajo që shfaqet.
  useEffect(() => {
    if (Number(text) !== value) setText(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="number" inputMode="decimal" step={step} min={min} max={max}
      className={className ?? 'inp'} value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        // Gjendje të ndërmjetme gjatë shkrimit — mos ruaj numër ende.
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || raw.endsWith('.')) return;
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        const n = Number(text);
        // Bosh ose jo-numër → kthehu te vlera aktuale; ndryshe normalizo pamjen.
        setText(text === '' || !Number.isFinite(n) ? (Number.isFinite(value) ? String(value) : '') : String(n));
        onCommit?.();
      }}
    />
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

// FOKUS: vetëm Ari + Naftë (mall i lidhur, shtytës të njëjtë USD). Crypto u hoq qëllimisht
// që roboti + AI të jenë më të fokusuar dhe profesionalë te këto dy aktive.
const SYMBOL_GROUPS: { cat: string; syms: [string, string][] }[] = [
  { cat: 'Ari', syms: [['XAUUSD', 'Ari']] },
  { cat: 'Naftë', syms: [['USOIL', 'Naftë (WTI)'], ['UKOIL', 'Naftë (Brent)']] },
];
const DEFAULT_SYMBOL = 'XAUUSD';

// Përzgjedhës simbolesh: Ari gjithmonë default; të tjerat shtohen nga një menu që hapet me klik.
function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Lista e zgjedhur — Ari gjithmonë i pranishëm dhe i pari.
  const raw = (value || DEFAULT_SYMBOL).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const selected = [DEFAULT_SYMBOL, ...raw.filter(s => s !== DEFAULT_SYMBOL)];

  const commit = (arr: string[]) => onChange([DEFAULT_SYMBOL, ...arr.filter(s => s !== DEFAULT_SYMBOL)].join(','));
  const toggle = (sym: string) => {
    if (sym === DEFAULT_SYMBOL) return; // Ari i palëvizshëm
    commit(selected.includes(sym) ? selected.filter(s => s !== sym) : [...selected, sym]);
  };

  return (
    <div className="space-y-2">
      {/* Chips të zgjedhura + butoni hamburger për të hapur menunë */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map(sym => (
          <span key={sym} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${sym === DEFAULT_SYMBOL ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-gray-700/50 text-gray-200 border-gray-600'}`}>
            {sym === DEFAULT_SYMBOL && <Lock className="w-3 h-3" />}
            {sym}
            {sym !== DEFAULT_SYMBOL && (
              <button onClick={() => toggle(sym)} className="text-gray-400 hover:text-red-400" title={t('Hiq')}><X className="w-3 h-3" /></button>
            )}
          </span>
        ))}
        <button onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-600 bg-gray-800 text-gray-300 hover:text-white transition-colors">
          <Plus className="w-3 h-3" />{t('Shto simbol')}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Menyja (hamburger) — hapet vetëm me klik */}
      {open && (
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-2 space-y-2 max-h-64 overflow-y-auto">
          {SYMBOL_GROUPS.map(g => (
            <div key={g.cat}>
              <div className="px-1 mb-1 text-[10px] text-gray-500 font-semibold tracking-wide uppercase">{t(g.cat)}</div>
              <div className="grid grid-cols-2 gap-1">
                {g.syms.map(([sym, name]) => {
                  const on = selected.includes(sym);
                  const locked = sym === DEFAULT_SYMBOL;
                  return (
                    <button key={sym} onClick={() => toggle(sym)} disabled={locked}
                      className={`flex items-center justify-between gap-1 text-left text-[11px] px-2 py-1.5 rounded-lg border transition-colors ${on ? 'bg-amber-500/10 border-amber-500/30 text-white' : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:border-gray-500'} ${locked ? 'opacity-80' : ''}`}>
                      <span className="truncate"><span className="font-semibold">{sym}</span> <span className="text-gray-500">{name}</span></span>
                      {locked ? <Lock className="w-3 h-3 text-amber-400 shrink-0" /> : on ? <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <Plus className="w-3 h-3 text-gray-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button onClick={() => setOpen(false)} className="w-full text-[11px] font-medium text-gray-300 hover:text-white bg-gray-800 rounded-lg py-1.5 transition-colors">{t('Mbyll')}</button>
        </div>
      )}
    </div>
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
