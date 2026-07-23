import { useState, useEffect, useCallback } from 'react';
import {
  Send, Power, PowerOff, Loader2, Copy, ExternalLink, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Info, RefreshCw, Monitor, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { ClientPage } from '../App';
import { checkMetaApiConnection, loadMetaApiConfig, type AccountInfo } from '../services/metaapi';
import {
  loadTelegramSinConfig, saveTelegramSinConfigPartial, loadTelegramSignals,
  generateWebhookSecret, webhookUrlFor, setWebhookUrl,
  loadOthersState, setOthersEnabled,
  DEFAULT_TG_CONFIG, type TelegramSinConfig, type TelegramSignalRow, type TpMode, type OthersState,
} from '../services/telegramSin';

export default function TelegramSinPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();

  const [cfg, setCfg] = useState<TelegramSinConfig>(DEFAULT_TG_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [signals, setSignals] = useState<TelegramSignalRow[]>([]);

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [metaConfigured, setMetaConfigured] = useState(false);
  const [mtMode, setMtMode] = useState<'demo' | 'live'>('demo');
  const [accLoading, setAccLoading] = useState(true);

  const [others, setOthers] = useState<OthersState | null>(null);
  const [othersBusy, setOthersBusy] = useState(false);

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  const refresh = useCallback(async () => {
    if (!user) return;
    try { const c = await loadTelegramSinConfig(user.id); setCfg(c); setLoaded(true); } catch { setLoaded(false); }
    try { setSignals(await loadTelegramSignals(user.id, 50)); } catch { /* */ }
    try { setOthers(await loadOthersState(user.id)); } catch { /* */ }
  }, [user]);

  const toggleOthers = async () => {
    if (!user || !others) return;
    const turnOn = !others.othersOn;
    setOthersBusy(true);
    try {
      await setOthersEnabled(user.id, turnOn);
      setOthers(await loadOthersState(user.id));
      flash('success', turnOn ? t('Robotët e tjerë u ndezën.') : t('Robotët e tjerë u ndalën — vetëm Telegram Sin punon.'));
    } catch (e) { flash('error', (e as Error).message); }
    finally { setOthersBusy(false); }
  };

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    setAccLoading(true);
    try {
      const mc = await loadMetaApiConfig(user.id);
      const configured = !!(mc.account_id && mc.token);
      setMetaConfigured(configured);
      setMtMode(mc.mode === 'live' ? 'live' : 'demo');
      if (configured) {
        const res = await checkMetaApiConnection();
        if (res && !res.error && res.account) setAccount(res.account);
      }
    } catch { /* */ } finally { setAccLoading(false); }
  }, [user]);

  useEffect(() => { refresh(); refreshAccount(); }, [refresh, refreshAccount]);

  const setAndSave = async <K extends keyof TelegramSinConfig>(k: K, v: TelegramSinConfig[K]) => {
    setCfg((p) => ({ ...p, [k]: v }));
    if (!user) return;
    if (!loaded) { flash('error', t('Po ngarkohet konfigurimi — prit pak.')); return; }
    try { await saveTelegramSinConfigPartial(user.id, { [k]: v }); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  // Aktivizim: sigurohu që ekziston webhook_secret para se ta ndezësh.
  const toggleActive = async () => {
    if (!user) return;
    const next = !cfg.active;
    let secret = cfg.webhook_secret;
    const patch: Partial<TelegramSinConfig> = { active: next };
    if (next && !secret) { secret = generateWebhookSecret(); patch.webhook_secret = secret; }
    setCfg((p) => ({ ...p, ...patch }));
    try { await saveTelegramSinConfigPartial(user.id, patch); flash('success', next ? t('Telegram Sin u aktivizua.') : t('Telegram Sin u çaktivizua.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const ensureSecretAndSaveToken = async (token: string) => {
    if (!user) return;
    let secret = cfg.webhook_secret;
    const patch: Partial<TelegramSinConfig> = { bot_token: token };
    if (!secret) { secret = generateWebhookSecret(); patch.webhook_secret = secret; }
    setCfg((p) => ({ ...p, ...patch }));
    try { await saveTelegramSinConfigPartial(user.id, patch); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => flash('success', t('U kopjua.'))).catch(() => {}); };

  const money = (n?: number) => (n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cur = account?.currency || '';
  const hookUrl = cfg.webhook_secret ? webhookUrlFor(cfg.webhook_secret) : '';

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <Send className="w-5 h-5 text-sky-400" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white">Telegram Sin</h1>
          <p className="text-xs text-gray-400">{t('Roboti që hyn në trade sipas sinjaleve nga Telegram — 24/7.')}</p>
        </div>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 border ${msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* Master: ndal/nis robotët e tjerë (MMT + Sinjalet) — që të punojë vetëm Telegram Sin */}
      <div className={`rounded-xl border p-3 sm:p-4 ${others && !others.othersOn ? 'bg-red-500/[0.06] border-red-500/30' : 'bg-white/[0.03] border-white/10'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {others && !others.othersOn
              ? <PowerOff className="w-5 h-5 text-red-400" />
              : <ShieldAlert className="w-5 h-5 text-amber-400" />}
            <div>
              <div className="text-sm font-semibold text-white">{t('Robotët e tjerë (MMT + Sinjalet)')}</div>
              <div className="text-[11px] text-gray-400">
                {others
                  ? (others.othersOn
                      ? t('Aktivë tani. Fike që të tregtojë VETËM Telegram Sin.')
                      : t('Të ndalur — vetëm Telegram Sin po punon.'))
                  : t('Po ngarkohet…')}
              </div>
              {others && (
                <div className="text-[10px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  <span>{t('Sinjalet')}: {others.signalsOn ? t('ON') : t('OFF')}</span>
                  <span>MMT: {others.mmtControllable ? (others.mmtOn ? t('ON') : t('OFF')) : t('s\'menaxhohet nga kjo llogari')}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={toggleOthers}
            disabled={othersBusy || !others}
            className={`inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg font-semibold whitespace-nowrap disabled:opacity-40 ${others && others.othersOn ? 'bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30' : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30'}`}
          >
            {othersBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : (others && others.othersOn ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />)}
            {others && others.othersOn ? t('Ndal të tjerët') : t('Nis të tjerët')}
          </button>
        </div>
      </div>

      {/* MetaTrader Live — llogaria ku tregton Telegram Sin (e njëjta si te Trade Live) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">{t('MetaTrader 5 — Live')}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${mtMode === 'live' ? 'bg-red-500/20 text-red-300' : 'bg-sky-500/20 text-sky-300'}`}>
              {mtMode === 'live' ? 'LIVE' : 'DEMO'}
            </span>
          </div>
          <button onClick={refreshAccount} className="text-gray-400 hover:text-white p-1" title={t('Rifresko')}>
            {accLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
        {metaConfigured ? (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: t('Balanca'), value: money(account?.balance) },
              { label: t('Equity'), value: money(account?.equity) },
              { label: t('Marzh i lirë'), value: money(account?.freeMargin) },
            ].map((c) => (
              <div key={c.label} className="rounded-lg bg-black/20 border border-white/5 px-2 py-2">
                <div className="text-[10px] text-gray-400">{c.label}</div>
                <div className="text-sm font-bold text-white truncate">{c.value} <span className="text-[10px] text-gray-500">{cur}</span></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400 flex items-center justify-between gap-2">
            <span>{t('Llogaria MetaApi s\'është konfiguruar ende.')}</span>
            <button onClick={() => onNavigate('metatrader')} className="text-amber-400 hover:underline whitespace-nowrap">{t('Konfiguro →')}</button>
          </div>
        )}
      </div>

      {/* Cilësimet kryesore: Aktivizim + Lot + Mënyra e TP */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 space-y-4">
        <h2 className="text-sm font-semibold text-white">{t('Cilësimet')}</h2>

        {/* Aktivizim */}
        <button
          onClick={toggleActive}
          className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-all ${cfg.active ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-black/20 border-white/10'}`}
        >
          <div className="flex items-center gap-3 text-left">
            <Power className={`w-5 h-5 ${cfg.active ? 'text-emerald-400' : 'text-gray-500'}`} />
            <div>
              <div className="text-sm font-semibold text-white">{cfg.active ? t('Aktiv') : t('Joaktiv')}</div>
              <div className="text-[11px] text-gray-400">{t('ON = roboti hyn në trade sapo vjen një sinjal nga Telegram.')}</div>
            </div>
          </div>
          <div className={`w-12 h-6 rounded-full relative transition-all ${cfg.active ? 'bg-emerald-500' : 'bg-gray-700'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${cfg.active ? 'left-7' : 'left-1'}`} />
          </div>
        </button>

        {/* Lot */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Lot (për çdo TP)')}</label>
            <input
              type="number" step="0.01" min="0.01" defaultValue={cfg.lot}
              key={`lot-${loaded}`}
              onBlur={(e) => setAndSave('lot', Math.max(Number(e.target.value) || 0.01, 0.01))}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
            <p className="text-[10px] text-gray-500 mt-1">{t('Ata s\'e dërgojnë lotin — ti e cakton sa të rrezikosh.')}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Mënyra e TP-ve')}</label>
            <select
              value={cfg.tp_mode}
              onChange={(e) => setAndSave('tp_mode', e.target.value as TpMode)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="multi">{t('Multi — 1 pozicion për çdo TP (TP1..TP4)')}</option>
              <option value="first">{t('Vetëm TP1 — një pozicion i vetëm')}</option>
              <option value="split">{t('Ndaj lotin — 1 lot i ndarë mbi TP-të')}</option>
            </select>
            <p className="text-[10px] text-gray-500 mt-1">{t('Ata dërgojnë disa TP (TP1–TP4) — kështu i menaxhon të gjitha.')}</p>
          </div>
        </div>

        {/* Të avancuara */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('SL rezervë ($)')}</label>
            <input type="number" step="1" min="0" defaultValue={cfg.fallback_sl_usd} key={`fb-${loaded}`}
              onBlur={(e) => setAndSave('fallback_sl_usd', Math.max(Number(e.target.value) || 0, 0))}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Max pozicione')}</label>
            <input type="number" step="1" min="1" defaultValue={cfg.max_open} key={`mo-${loaded}`}
              onBlur={(e) => setAndSave('max_open', Math.max(Number(e.target.value) || 1, 1))}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Simboli parazgjedhur')}</label>
            <input type="text" defaultValue={cfg.symbol_default} key={`sym-${loaded}`}
              onBlur={(e) => setAndSave('symbol_default', (e.target.value || 'XAUUSD').toUpperCase().trim())}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={cfg.move_be_after_tp1} onChange={(e) => setAndSave('move_be_after_tp1', e.target.checked)} />
              {t('SL në breakeven pas TP1')}
            </label>
          </div>
        </div>
      </div>

      {/* Lidhja me Telegram */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Send className="w-4 h-4 text-sky-400" /> {t('Lidhja me Telegram')}</h2>
        <ol className="text-[11px] text-gray-400 space-y-1 list-decimal list-inside">
          <li>{t('Hap @BotFather në Telegram, krijo një bot dhe kopjo token-in.')}</li>
          <li>{t('Ngjite token-in këtu poshtë dhe ruaje.')}</li>
          <li>{t('Kliko "Lidh me Telegram" (hap një tab — duhet të shohësh "ok":true).')}</li>
          <li>{t('Shto botin në grupin ku trejderat dërgojnë sinjalet.')}</li>
          <li>{t('Ndeze çelësin "Aktiv" lart.')}</li>
        </ol>

        <div>
          <label className="text-xs text-gray-400 block mb-1">{t('Bot token')}</label>
          <input
            type="text" defaultValue={cfg.bot_token} key={`tok-${loaded}`} placeholder="123456:ABC-DEF..."
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cfg.bot_token) ensureSecretAndSaveToken(v); }}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </div>

        {hookUrl && (
          <div className="rounded-lg bg-black/20 border border-white/5 p-2 space-y-2">
            <div className="text-[10px] text-gray-400">{t('URL-ja e webhook-ut (privat — mos e ndaj)')}</div>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-sky-300 truncate flex-1">{hookUrl}</code>
              <button onClick={() => copy(hookUrl)} className="p-1 text-gray-400 hover:text-white" title={t('Kopjo')}><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            disabled={!cfg.bot_token || !cfg.webhook_secret}
            onClick={() => window.open(setWebhookUrl(cfg.bot_token, cfg.webhook_secret), '_blank')}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ExternalLink className="w-4 h-4" /> {t('Lidh me Telegram')}
          </button>
        </div>
      </div>

      {/* Raportet e sinjaleve */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">{t('Sinjalet e marra')}</h2>
          <button onClick={refresh} className="text-gray-400 hover:text-white p-1" title={t('Rifresko')}><RefreshCw className="w-4 h-4" /></button>
        </div>
        {signals.length === 0 ? (
          <div className="text-xs text-gray-500 flex items-center gap-2 py-4"><Info className="w-4 h-4" /> {t('Ende s\'ka sinjale. Sapo trejderat të dërgojnë, do shfaqen këtu.')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 pr-3 font-medium">{t('Data / Ora')}</th>
                  <th className="text-left py-2 pr-3 font-medium">{t('Simboli')}</th>
                  <th className="text-left py-2 pr-3 font-medium">{t('Drejtimi')}</th>
                  <th className="text-right py-2 pr-3 font-medium">Entry</th>
                  <th className="text-right py-2 pr-3 font-medium">SL</th>
                  <th className="text-right py-2 pr-3 font-medium">TP1</th>
                  <th className="text-right py-2 pr-3 font-medium">TP2</th>
                  <th className="text-right py-2 pr-3 font-medium">TP3</th>
                  <th className="text-right py-2 pr-3 font-medium">TP4</th>
                  <th className="text-left py-2 font-medium">{t('Statusi')}</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => {
                  const d = new Date(s.created_at);
                  const tps = Array.isArray(s.tps) ? s.tps : [];
                  const dir = s.direction === 'buy' ? 'buy' : s.direction === 'sell' ? 'sell' : null;
                  return (
                    <tr key={s.id} className="border-b border-white/5">
                      <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-2 pr-3 text-white">{s.symbol || '—'}</td>
                      <td className="py-2 pr-3">
                        {s.kind === 'exit' ? <span className="text-amber-300">{t('Dalje')}</span>
                          : dir === 'buy' ? <span className="inline-flex items-center gap-1 text-emerald-400"><TrendingUp className="w-3 h-3" />BUY</span>
                          : dir === 'sell' ? <span className="inline-flex items-center gap-1 text-red-400"><TrendingDown className="w-3 h-3" />SELL</span>
                          : <span className="text-gray-500">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-300">{s.entry_type === 'market' ? 'MKT' : (s.entry_price ?? '—')}</td>
                      <td className="py-2 pr-3 text-right text-gray-300">{s.stop_loss ?? '—'}</td>
                      {[0, 1, 2, 3].map((i) => <td key={i} className="py-2 pr-3 text-right text-gray-300">{tps[i] ?? '—'}</td>)}
                      <td className="py-2">
                        <StatusBadge status={s.status} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { cls: string; label: string; icon?: 'ok' | 'x' }> = {
    executed: { cls: 'text-emerald-300 bg-emerald-500/10', label: t('Ekzekutuar'), icon: 'ok' },
    pending: { cls: 'text-indigo-300 bg-indigo-500/10', label: t('Në pritje') },
    partial: { cls: 'text-amber-300 bg-amber-500/10', label: t('Pjesërisht'), icon: 'ok' },
    modified: { cls: 'text-purple-300 bg-purple-500/10', label: t('Ndryshuar') },
    closed: { cls: 'text-sky-300 bg-sky-500/10', label: t('Mbyllur') },
    rejected: { cls: 'text-red-300 bg-red-500/10', label: t('Refuzuar'), icon: 'x' },
    ignored: { cls: 'text-gray-400 bg-white/5', label: t('Injoruar') },
    received: { cls: 'text-gray-300 bg-white/5', label: t('Marrë') },
  };
  const m = map[status] || { cls: 'text-gray-400 bg-white/5', label: status };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${m.cls}`}>
      {m.icon === 'ok' && <CheckCircle2 className="w-3 h-3" />}
      {m.icon === 'x' && <XCircle className="w-3 h-3" />}
      {m.label}
    </span>
  );
}
