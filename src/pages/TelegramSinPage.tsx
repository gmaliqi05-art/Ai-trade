import { useState, useEffect, useCallback } from 'react';
import {
  Send, Power, PowerOff, Loader2, Copy, ExternalLink, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Info, RefreshCw, Monitor, ShieldAlert, BarChart3, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { ClientPage } from '../App';
import { checkMetaApiConnection, loadMetaApiConfig, type AccountInfo } from '../services/metaapi';
import {
  loadTelegramSinConfig, saveTelegramSinConfigPartial, loadTelegramSignals,
  generateWebhookSecret, webhookUrlFor, setWebhookUrl,
  loadOthersState, setOthersEnabled, loadOpenTgTrades, type TgTradeRow,
  loadTgChannels, upsertTgChannel, type TgChannelRow,
  DEFAULT_TG_CONFIG, type TelegramSinConfig, type TelegramSignalRow, type TpMode, type OthersState,
} from '../services/telegramSin';

export default function TelegramSinPage({ onNavigate }: { onNavigate: (p: ClientPage) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();

  const [cfg, setCfg] = useState<TelegramSinConfig>(DEFAULT_TG_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [signals, setSignals] = useState<TelegramSignalRow[]>([]);
  // NËN-FAQET sipas kanalit: 'all' ose tg_chat_id. Emrat e njohur të kanaleve → etiketa miqësore.
  const [channel, setChannel] = useState<string>('all');
  // Pamja: 'home' (dy tabelat e kanaleve) ose 'detail' (raportet e plota të një kanali).
  const [view, setView] = useState<'home' | 'detail'>('home');
  const [openTrades, setOpenTrades] = useState<TgTradeRow[]>([]);
  const [chParams, setChParams] = useState<Record<string, TgChannelRow>>({});
  const CHANNEL_NAMES: Record<string, string> = {
    '-1003603315504': 'BESA DIGITAL VIP',
  };

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
    try { setSignals(await loadTelegramSignals(user.id, 100)); } catch { /* */ }
    try { setOpenTrades(await loadOpenTgTrades(user.id)); } catch { /* */ }
    try {
      const rows = await loadTgChannels(user.id);
      const m: Record<string, TgChannelRow> = {};
      for (const r of rows) m[String(r.chat_id)] = r;
      setChParams(m);
    } catch { /* */ }
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

  // Krijon adresën e lidhjes (webhook_secret) pa pasur nevojë për bot token — për metodën abonues (kopjues).
  const ensureSecret = async () => {
    if (!user || cfg.webhook_secret) return;
    const secret = generateWebhookSecret();
    setCfg((p) => ({ ...p, webhook_secret: secret }));
    try { await saveTelegramSinConfigPartial(user.id, { webhook_secret: secret }); flash('success', t('Adresa e lidhjes u krijua.')); }
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

  // ---- KANALET: regjistri (të njohurit + të parët nga sinjalet) dhe statistikat për secilin ----
  const chanMap = new Map<string, string>();
  for (const [id, name] of Object.entries(CHANNEL_NAMES)) chanMap.set(id, name);
  for (const s0 of signals) {
    const id = s0.tg_chat_id != null ? String(s0.tg_chat_id) : '';
    if (id && !chanMap.has(id)) chanMap.set(id, s0.tg_sender || id);
  }
  for (const [k, v] of chanMap) chanMapRef.set(k, v);
  const sigsOf = (id: string) => signals.filter((s0) => String(s0.tg_chat_id ?? '') === id);
  const statsOf = (list: TelegramSignalRow[]) => {
    const entries = list.filter((s0) => s0.kind === 'entry' && ['executed', 'partial', 'pending', 'closed'].includes(s0.status));
    const hit = (n: number) => entries.filter((s0) => (s0.tp_hit ?? 0) >= n).length;
    const sl = entries.filter((s0) => s0.status === 'closed' && (s0.tp_hit ?? 0) === 0).length;
    const decided = hit(1) + sl;
    return { n: entries.length, tp1: hit(1), tp2: hit(2), tp3: hit(3), sl, wr: decided ? Math.round((hit(1) / decided) * 100) : null };
  };
  const sigIdsOf = (id: string) => new Set(sigsOf(id).map((s0) => s0.id));
  const activeOf = (id: string) => { const ids = sigIdsOf(id); return openTrades.filter((tr) => tr.signal_id && ids.has(tr.signal_id)).length; };
  const chanOff = (id: string) => {
    const ch = chParams[id];
    return ch ? !ch.enabled : (cfg.disabled_chats || []).includes(id);
  };
  // Çelësi PËR KANAL + parametrat e VETË kanalit (lot/TP/SL/max/shkallët) — kërkesa e pronarit.
  const chDefaults = (id: string, name: string): TgChannelRow => ({
    chat_id: id, name, enabled: true, lot: cfg.lot, tp_mode: cfg.tp_mode,
    fallback_sl_usd: cfg.fallback_sl_usd, move_be_after_tp1: cfg.move_be_after_tp1, max_open: cfg.max_open,
  });
  const setChParam = async (id: string, name: string, patch: Partial<TgChannelRow>) => {
    if (!user) return;
    const base = chParams[id] ?? chDefaults(id, name);
    const next = { ...base, ...patch };
    setChParams((p0) => ({ ...p0, [id]: next }));
    try { await upsertTgChannel(user.id, id, next); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };
  const toggleChannel = (id: string) => {
    const name = chanMapRef.get(id) || id;
    setChParam(id, name, { enabled: chanOff(id) });
  };
  const chanMapRef = new Map<string, string>();

  // Blloku i raporteve (stats + tabela e plotë) — përdoret nga pamja e detajuar e kanalit.
  const renderSignalsBlock = (list: TelegramSignalRow[]) => {
    const st = statsOf(list);
    return (
      <>
        {st.n > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {[
              { l: t('Sinjale'), v: String(st.n), c: 'text-white' },
              { l: '≥TP1', v: String(st.tp1), c: 'text-emerald-400' },
              { l: '≥TP2', v: String(st.tp2), c: 'text-emerald-400' },
              { l: '≥TP3', v: String(st.tp3), c: 'text-emerald-400' },
              { l: 'SL', v: String(st.sl), c: 'text-red-400' },
              { l: t('Sukses'), v: st.wr == null ? '—' : `${st.wr}%`, c: st.wr != null && st.wr >= 50 ? 'text-emerald-400' : 'text-amber-400' },
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-black/20 border border-white/5 px-2 py-1.5 text-center">
                <div className="text-[10px] text-gray-500">{x.l}</div>
                <div className={`text-sm font-bold ${x.c}`}>{x.v}</div>
              </div>
            ))}
          </div>
        )}
        {list.length === 0 ? (
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
                  <th className="text-left py-2 pr-3 font-medium">{t('Statusi')}</th>
                  <th className="text-left py-2 font-medium">{t('Rezultati')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
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
                      <td className="py-2 pr-3"><StatusBadge status={s.status} t={t} /></td>
                      <td className="py-2">
                        {(s.tp_hit ?? 0) > 0
                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">→ TP{s.tp_hit}</span>
                          : s.status === 'closed' && s.kind === 'entry'
                            ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300">SL</span>
                            : <span className="text-gray-600 text-[10px]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  // ===== PAMJA E DETAJUAR E NJË KANALI: të gjitha raportet e tij =====
  if (view === 'detail' && channel !== 'all') {
    const name = chanMap.get(channel) || channel;
    return (
      <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setView('home')} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white"><ArrowLeft className="w-3.5 h-3.5" />{t('Kthehu')}</button>
          <h1 className="text-sm sm:text-base font-bold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-sky-400" />{name} — {t('Raportet e plota')}</h1>
          <button onClick={refresh} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white"><RefreshCw className="w-3.5 h-3.5" />{t('Rifresko')}</button>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          {renderSignalsBlock(sigsOf(channel))}
        </div>
      </div>
    );
  }

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
        <h2 className="text-sm font-semibold text-white">{t('Parametrat e parazgjedhur (për kanale të reja)')}</h2>

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
              <option value="last">{t('TP më i larti — 1 pozicion, alarme për çdo TP')}</option>
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
            <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={cfg.move_be_after_tp1} onChange={(e) => setAndSave('move_be_after_tp1', e.target.checked)} />
              <span>
                {t('Mbrojtja shkallë-shkallë e TP-ve')}
                <span className="block text-[10px] text-gray-500">{t('SL gjithmonë NJË TP mbrapa: TP1 preket → SL në breakeven · TP2 → SL te TP1 · TP3 → SL te TP2 …')}</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Lidhja me Telegram — metoda ABONUES (kopjues) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Send className="w-4 h-4 text-sky-400" /> {t('Lidhja me Telegram')}</h2>
        <p className="text-[11px] text-gray-400">{t('Ti je abonues i kanalit — përdorim "kopjuesin" që e lexon kanalin me llogarinë tënde (pa qenë admin).')}</p>
        <ol className="text-[11px] text-gray-400 space-y-1 list-decimal list-inside">
          <li>{t('Kopjo adresën e lidhjes më poshtë.')}</li>
          <li>{t('Ndiq udhëzuesin e kopjuesit (dosja telegram-forwarder) për ta lidhur me kanalin.')}</li>
          <li>{t('Ndeze çelësin "Aktiv" lart.')}</li>
        </ol>

        {hookUrl ? (
          <div className="rounded-lg bg-black/20 border border-white/5 p-2 space-y-2">
            <div className="text-[10px] text-gray-400">{t('Adresa e lidhjes (webhook — privat, mos e ndaj)')}</div>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-sky-300 truncate flex-1">{hookUrl}</code>
              <button onClick={() => copy(hookUrl)} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-200 hover:bg-sky-500/25 whitespace-nowrap"><Copy className="w-3.5 h-3.5" />{t('Kopjo')}</button>
            </div>
            <div className="text-[10px] text-gray-500">{t('Kjo adresë shkon te kopjuesi (forwarder) — jo te @BotFather.')}</div>
          </div>
        ) : (
          <button onClick={ensureSecret} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30">
            <Send className="w-4 h-4" /> {t('Krijo adresën e lidhjes')}
          </button>
        )}

        {/* Opsion dytësor: bot për një GRUP (vetëm nëse je admin i një grupi) */}
        <details className="group">
          <summary className="text-[11px] text-gray-400 cursor-pointer select-none hover:text-gray-300">{t('Opsion tjetër: ke një grup ku mund të shtosh një bot?')}</summary>
          <div className="mt-2 space-y-2 pl-1">
            <p className="text-[10px] text-gray-500">{t('Vetëm nëse ke një GRUP (jo kanal) ku je admin: krijo bot te @BotFather, ngjit token-in dhe kliko "Lidh me Telegram".')}</p>
            <input
              type="text" defaultValue={cfg.bot_token} key={`tok-${loaded}`} placeholder="123456:ABC-DEF..."
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cfg.bot_token) ensureSecretAndSaveToken(v); }}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
            <button
              disabled={!cfg.bot_token || !cfg.webhook_secret}
              onClick={() => window.open(setWebhookUrl(cfg.bot_token, cfg.webhook_secret), '_blank')}
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ExternalLink className="w-4 h-4" /> {t('Lidh me Telegram')}
            </button>
          </div>
        </details>
      </div>

      {/* DY TABELAT E KANALEVE (kërkesa e pronarit): info + çelës ON/OFF për secilin kanal,
          sinjalet e fundit + aktivët + raporti i shkurtër, dhe butoni → raportet e plota. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[...chanMap.entries()].map(([id, name]) => {
          const list = sigsOf(id);
          const st = statsOf(list);
          const off = chanOff(id);
          const act = activeOf(id);
          const last = list[0];
          return (
            <div key={id} className={`rounded-xl border p-3 sm:p-4 space-y-3 ${off ? 'border-white/10 bg-white/[0.02] opacity-80' : 'border-sky-500/25 bg-sky-500/[0.04]'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Send className={`w-4 h-4 flex-shrink-0 ${off ? 'text-gray-500' : 'text-sky-400'}`} />
                  <span className="text-sm font-semibold text-white truncate">{name}</span>
                </div>
                {/* Çelësi PËR KANAL — fik/ndez marrjen e sinjaleve VETËM nga ky kanal */}
                <button onClick={() => toggleChannel(id)}
                  className={`flex items-center gap-2 flex-shrink-0 ${off ? '' : ''}`} title={off ? t('Aktivizo kanalin') : t('Çaktivizo kanalin')}>
                  <span className={`text-[10px] font-bold ${off ? 'text-gray-500' : 'text-emerald-400'}`}>{off ? 'OFF' : 'ON'}</span>
                  <span className={`w-10 h-5 rounded-full relative transition-all ${off ? 'bg-gray-700' : 'bg-emerald-500'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${off ? 'left-0.5' : 'left-5'}`} />
                  </span>
                </button>
              </div>

              {/* Raporti i shkurtër + aktivët */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { l: t('Sinjale'), v: String(st.n), c: 'text-white' },
                  { l: t('Aktive'), v: String(act), c: act > 0 ? 'text-sky-300' : 'text-gray-400' },
                  { l: '≥TP1/SL', v: `${st.tp1}/${st.sl}`, c: 'text-gray-200' },
                  { l: t('Sukses'), v: st.wr == null ? '—' : `${st.wr}%`, c: st.wr != null && st.wr >= 50 ? 'text-emerald-400' : 'text-amber-400' },
                ].map((x) => (
                  <div key={x.l} className="rounded-lg bg-black/20 border border-white/5 px-1.5 py-1 text-center">
                    <div className="text-[9px] text-gray-500">{x.l}</div>
                    <div className={`text-xs font-bold ${x.c}`}>{x.v}</div>
                  </div>
                ))}
              </div>

              {/* Sinjalet e fundit (3) */}
              {list.length === 0 ? (
                <p className="text-[11px] text-gray-500">{t('Ende s\'ka sinjale nga ky kanal.')}</p>
              ) : (
                <div className="space-y-1">
                  {list.slice(0, 3).map((s0) => {
                    const d = new Date(s0.created_at);
                    return (
                      <div key={s0.id} className="flex items-center justify-between text-[11px] bg-black/20 rounded-lg px-2 py-1">
                        <span className="text-gray-500">{d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={s0.direction === 'buy' ? 'text-emerald-400 font-semibold' : s0.direction === 'sell' ? 'text-red-400 font-semibold' : 'text-gray-400'}>
                          {s0.kind === 'exit' ? t('Dalje') : s0.direction ? s0.direction.toUpperCase() : '—'}
                        </span>
                        <span>
                          {(s0.tp_hit ?? 0) > 0
                            ? <span className="text-emerald-300 font-bold">→TP{s0.tp_hit}</span>
                            : s0.status === 'closed' && s0.kind === 'entry'
                              ? <span className="text-red-300 font-bold">SL</span>
                              : <StatusBadge status={s0.status} t={t} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* PARAMETRAT E KANALIT — secili grup i ka të VETAT (lot, TP, SL, max, shkallët) */}
              {(() => {
                const ch = chParams[id] ?? chDefaults(id, name);
                return (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                    <label className="block">
                      <span className="text-[9px] text-gray-500">{t('Lot (për çdo TP)')}</span>
                      <input type="number" step="0.01" min="0.01" defaultValue={ch.lot} key={`l-${id}-${ch.lot}`}
                        onBlur={(e) => { const v = Math.max(Number(e.target.value) || 0.01, 0.01); if (v !== ch.lot) setChParam(id, name, { lot: v }); }}
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white" />
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-gray-500">{t('Mënyra e TP-ve')}</span>
                      <select value={ch.tp_mode} onChange={(e) => setChParam(id, name, { tp_mode: e.target.value as TpMode })}
                        className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[11px] text-white">
                        <option value="multi">Multi (1/TP)</option>
                        <option value="last">{t('TP më i larti')}</option>
                        <option value="first">TP1</option>
                        <option value="split">{t('Ndaj lotin')}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-gray-500">{t('SL rezervë ($)')}</span>
                      <input type="number" step="1" min="0" defaultValue={ch.fallback_sl_usd} key={`f-${id}-${ch.fallback_sl_usd}`}
                        onBlur={(e) => { const v = Math.max(Number(e.target.value) || 0, 0); if (v !== ch.fallback_sl_usd) setChParam(id, name, { fallback_sl_usd: v }); }}
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white" />
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-gray-500">{t('Max pozicione')}</span>
                      <input type="number" step="1" min="1" defaultValue={ch.max_open} key={`m-${id}-${ch.max_open}`}
                        onBlur={(e) => { const v = Math.max(Number(e.target.value) || 1, 1); if (v !== ch.max_open) setChParam(id, name, { max_open: v }); }}
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white" />
                    </label>
                    <label className="col-span-2 flex items-center gap-2 text-[10px] text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={ch.move_be_after_tp1} onChange={(e) => setChParam(id, name, { move_be_after_tp1: e.target.checked })} />
                      {t('Mbrojtja shkallë-shkallë e TP-ve')}
                    </label>
                  </div>
                );
              })()}

              {/* → Raportet e plota të kanalit */}
              <button onClick={() => { setChannel(id); setView('detail'); }}
                className="w-full inline-flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-200 hover:bg-sky-500/25">
                <BarChart3 className="w-3.5 h-3.5" />{t('Raportet e plota')} →
              </button>
            </div>
          );
        })}

        {/* Karta e kanalit të dytë NË PRITJE — derisa të lidhet kopjuesi i FX+ */}
        {![...chanMap.values()].some((n) => /XNINE/i.test(n)) && (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3 sm:p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[160px]">
            <Send className="w-5 h-5 text-gray-500" />
            <p className="text-sm font-semibold text-gray-300">FX+ | XNINE LEVEL 2</p>
            <p className="text-[11px] text-gray-500">{t('Në pritje të lidhjes — ndiq udhëzimet për kopjuesin e dytë (numri tjetër i telefonit). Tabela aktivizohet vetë me sinjalin e parë.')}</p>
          </div>
        )}
      </div>

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
