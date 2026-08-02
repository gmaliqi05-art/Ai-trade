import { useState, useEffect, useCallback } from 'react';
import {
  Crosshair, Send, Power, PowerOff, Loader2, Copy, ExternalLink, ShieldAlert, ChevronDown, Info,
  Filter, Smile, MessageSquareOff, Ban, Save,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';
import GoldSniperPage from '../pages/GoldSniperPage';
import {
  loadTelegramSinConfig, saveTelegramSinConfigPartial,
  generateWebhookSecret, webhookUrlFor, setWebhookUrl,
  loadOthersStateAdmin, setOthersEnabledAdmin,
  DEFAULT_TG_CONFIG, type TelegramSinConfig, type OthersState,
} from '../services/telegramSin';

// KONSOLA ADMIN — "GoldSniperFX".
// Këtu janë mbledhur nënfaqet e INFRASTRUKTURËS që më parë ishin te faqja e përdoruesit
// (Konfigurimi i Sinjaleve) por që përdoruesit nuk i duhen:
//   1) Publikimi i sinjaleve te kanali GoldSniper|FX
//   2) Lidhja me Telegram (adresa e webhook-ut / boti)
//   3) Parametrat e parazgjedhur (aktivizimi + simboli për kanale të reja)
//   4) Robotët e tjerë (MMT + Sinjalet)
//
// E RËNDËSISHME: feed-i i GoldSniperFX i takon llogarisë PRONARE (ajo që ka kanalin te
// gold_sniper_config), jo llogarisë admin. Prandaj çdo panel punon mbi 'owner' — të njëjtin
// rresht që lexon edhe funksioni 'platform-poll'. Kështu asnjë lidhje ekzistuese nuk prishet.
export default function AdminGoldSniperPage() {
  const { t } = useI18n();

  const [owner, setOwner] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string>('');
  const [ownerErr, setOwnerErr] = useState<string | null>(null);

  const [cfg, setCfg] = useState<TelegramSinConfig>(DEFAULT_TG_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [others, setOthers] = useState<OthersState | null>(null);
  const [othersBusy, setOthersBusy] = useState(false);

  // FILTRAT E MESAZHEVE (ruhen te gold_sniper_config i pronarit; lexohen nga 'platform-poll').
  const [fStrip, setFStrip] = useState(true);
  const [fHideChat, setFHideChat] = useState(false);
  const [fWords, setFWords] = useState('');
  const [fBusy, setFBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  // Pronari i feed-it — përcaktohet nga DB (funksioni 'goldsniper_owner').
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('goldsniper_owner');
      if (error) { setOwnerErr(error.message); return; }
      const id = data ? String(data) : '';
      if (!id) { setOwnerErr(t('Asnjë llogari nuk e ka të lidhur kanalin GoldSniper|FX ende.')); return; }
      setOwner(id);
      const { data: p } = await supabase.from('profiles').select('username, full_name').eq('id', id).maybeSingle();
      const pr = p as { username?: string; full_name?: string } | null;
      setOwnerName(pr?.full_name || pr?.username || id);
    })();
  }, [t]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try { setCfg(await loadTelegramSinConfig(owner)); setLoaded(true); } catch { setLoaded(false); }
    try {
      const { data } = await supabase.from('gold_sniper_config')
        .select('msg_strip_emojis, msg_hide_chat, msg_blocked_words').eq('user_id', owner).maybeSingle();
      const g = data as { msg_strip_emojis?: boolean; msg_hide_chat?: boolean; msg_blocked_words?: string } | null;
      if (g) { setFStrip(g.msg_strip_emojis !== false); setFHideChat(!!g.msg_hide_chat); setFWords(g.msg_blocked_words || ''); }
    } catch { /* */ }
    try { setOthers(await loadOthersStateAdmin(owner)); } catch { /* */ }
  }, [owner]);
  useEffect(() => { refresh(); }, [refresh]);

  const setAndSave = async <K extends keyof TelegramSinConfig>(k: K, v: TelegramSinConfig[K]) => {
    if (!owner) return;
    setCfg((p) => ({ ...p, [k]: v }));
    if (!loaded) { flash('error', t('Po ngarkohet konfigurimi — prit pak.')); return; }
    try { await saveTelegramSinConfigPartial(owner, { [k]: v }); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const toggleActive = async () => {
    if (!owner) return;
    const next = !cfg.active;
    let secret = cfg.webhook_secret;
    const patch: Partial<TelegramSinConfig> = { active: next };
    if (next && !secret) { secret = generateWebhookSecret(); patch.webhook_secret = secret; }
    setCfg((p) => ({ ...p, ...patch }));
    try { await saveTelegramSinConfigPartial(owner, patch); flash('success', next ? t('Telegram Sin u aktivizua.') : t('Telegram Sin u çaktivizua.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const ensureSecret = async () => {
    if (!owner || cfg.webhook_secret) return;
    const secret = generateWebhookSecret();
    setCfg((p) => ({ ...p, webhook_secret: secret }));
    try { await saveTelegramSinConfigPartial(owner, { webhook_secret: secret }); flash('success', t('Adresa e lidhjes u krijua.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const ensureSecretAndSaveToken = async (token: string) => {
    if (!owner) return;
    let secret = cfg.webhook_secret;
    const patch: Partial<TelegramSinConfig> = { bot_token: token };
    if (!secret) { secret = generateWebhookSecret(); patch.webhook_secret = secret; }
    setCfg((p) => ({ ...p, ...patch }));
    try { await saveTelegramSinConfigPartial(owner, patch); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const toggleOthers = async () => {
    if (!owner || !others) return;
    const turnOn = !others.othersOn;
    setOthersBusy(true);
    try {
      await setOthersEnabledAdmin(owner, turnOn);
      setOthers(await loadOthersStateAdmin(owner));
      flash('success', turnOn ? t('Robotët e tjerë u ndezën.') : t('Robotët e tjerë u ndalën — vetëm Telegram Sin punon.'));
    } catch (e) { flash('error', (e as Error).message); }
    finally { setOthersBusy(false); }
  };

  const saveFilters = async () => {
    if (!owner) return;
    setFBusy(true);
    const { error } = await supabase.from('gold_sniper_config').update({
      msg_strip_emojis: fStrip, msg_hide_chat: fHideChat, msg_blocked_words: fWords.trim(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', owner);
    setFBusy(false);
    if (error) flash('error', error.message);
    else flash('success', t('Filtrat u ruajtën — zbatohen menjëherë te mesazhet e reja.'));
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => flash('success', t('U kopjua.'))).catch(() => {}); };
  const hookUrl = cfg.webhook_secret ? webhookUrlFor(cfg.webhook_secret) : '';

  if (ownerErr) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm px-4 py-3 flex items-center gap-2">
          <Info className="w-4 h-4" />{ownerErr}
        </div>
      </div>
    );
  }
  if (!owner) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 space-y-4">
      {/* Header + llogaria pronare e feed-it */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Crosshair className="w-6 h-6 text-amber-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white">GoldSniperFX</h1>
          <p className="text-xs text-gray-400 truncate">
            {t('Konfigurimi i feed-it dhe i kanalit — llogaria pronare')}: <span className="text-amber-300 font-semibold">{ownerName}</span>
          </p>
        </div>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 border ${msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* 1) PUBLIKIMI I SINJALEVE te kanali — e njëjta faqe, por mbi llogarinë pronare. */}
      <details className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03]" open>
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Crosshair className="w-4 h-4 text-amber-400" />{t('Publiko sinjale te kanali')}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="border-t border-white/5">
          <GoldSniperPage ownerId={owner} />
        </div>
      </details>

      {/* 2) LIDHJA ME TELEGRAM — adresa e webhook-ut për kopjuesin (forwarder). */}
      <details className="rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Send className="w-4 h-4 text-sky-400" />{t('Lidhja me Telegram')}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-3">
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
      </details>

      {/* 3) PARAMETRAT E PARAZGJEDHUR — aktivizimi i feed-it + simboli për kanale të reja. */}
      <details className="rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Power className="w-4 h-4 text-emerald-400" />{t('Parametrat e parazgjedhur (për kanale të reja)')}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('Simboli parazgjedhur')}</label>
              <input type="text" defaultValue={cfg.symbol_default} key={`sym-${loaded}`}
                onBlur={(e) => setAndSave('symbol_default', (e.target.value || 'XAUUSD').toUpperCase().trim())}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <p className="text-[11px] text-gray-500">{t('Lot-i, TP-të, SL rezervë, max pozicionet dhe mbrojtja shkallë-shkallë rregullohen nga vetë përdoruesi te karta e kanalit.')}</p>
          </div>
        </div>
      </details>

      {/* 3.5) FILTRAT E MESAZHEVE — çfarë lejohet të kalojë nga platforma e jashtme. */}
      <details className="rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Filter className="w-4 h-4 text-sky-400" />{t('Filtrat e mesazheve')}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-4">
          <p className="text-[11px] text-gray-400">
            {t('Kontrollo çfarë kalon nga platforma e jashtme te abonentët dhe te kanali në Telegram. Sinjalet e tregtimit dhe urdhrat e robotit (SL, TP, breakeven, mbyll) kalojnë gjithmonë — filtrat prekin vetëm mesazhet e tjera.')}
          </p>

          <label className="flex items-start justify-between gap-3 rounded-xl bg-black/20 border border-white/5 p-3 cursor-pointer">
            <span className="flex gap-2.5">
              <Smile className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <span className="block text-sm font-semibold text-white">{t('Hiq emoji-t dhe simbolet')}</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">{t('Mesazhet pastrohen nga emoji-t dhe simbolet dekorative para se të shfaqen ose të postohen.')}</span>
              </span>
            </span>
            <input type="checkbox" checked={fStrip} onChange={(e) => setFStrip(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 accent-emerald-500 shrink-0" />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-xl bg-black/20 border border-white/5 p-3 cursor-pointer">
            <span className="flex gap-2.5">
              <MessageSquareOff className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <span>
                <span className="block text-sm font-semibold text-white">{t('Fshih komentet dhe bisedat')}</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">{t('Kalojnë vetëm sinjalet dhe urdhrat e robotit; çdo mesazh tjetër bisede nuk shfaqet askund.')}</span>
              </span>
            </span>
            <input type="checkbox" checked={fHideChat} onChange={(e) => setFHideChat(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 accent-emerald-500 shrink-0" />
          </label>

          <label className="block">
            <span className="text-[11px] text-gray-500 flex items-center gap-1.5 mb-1">
              <Ban className="w-3.5 h-3.5 text-red-400" />{t('Fjalët kyçe të bllokuara (një për rresht ose ndarë me presje)')}
            </span>
            <textarea value={fWords} onChange={(e) => setFWords(e.target.value)} rows={4}
              placeholder={t('p.sh.\nliquidated\npromo\nreferral')}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 resize-none" />
            <span className="block text-[10px] text-gray-600 mt-1">{t('Nëse mesazhi përmban ndonjë nga këto fjalë, nuk kalon as te abonentët, as te kanali.')}</span>
          </label>

          <button onClick={saveFilters} disabled={fBusy}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-gray-950 disabled:opacity-50">
            {fBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj filtrat')}
          </button>
        </div>
      </details>

      {/* 4) ROBOTËT E TJERË (MMT + Sinjalet) — çelësi master mbi llogarinë pronare. */}
      <details className="rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-400" />{t('Robotët e tjerë (MMT + Sinjalet)')}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="px-3 sm:px-4 pb-3 sm:pb-4">
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
      </details>
    </div>
  );
}
