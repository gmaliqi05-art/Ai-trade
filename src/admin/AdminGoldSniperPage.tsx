import { useState, useEffect, useCallback } from 'react';
import {
  Crosshair, Send, Power, PowerOff, Loader2, Copy, ExternalLink, ShieldAlert, ChevronDown, Info,
  Filter, Smile, MessageSquareOff, Ban, Save, MessageSquare, Link2, Lock, CheckCircle2,
  AlertTriangle, Sunrise, Moon, CalendarX, Clock, Trophy, Scissors, XCircle,
  BarChart3, RefreshCw, Bot, ShieldOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';
import GoldSniperPage from '../pages/GoldSniperPage';
import { postGoldSniperSignal } from '../services/goldSniper';
import {
  loadTelegramSinConfig, saveTelegramSinConfigPartial,
  generateWebhookSecret, webhookUrlFor, setWebhookUrl,
  loadOthersStateAdmin, setOthersEnabledAdmin,
  DEFAULT_TG_CONFIG, type TelegramSinConfig, type OthersState,
} from '../services/telegramSin';

// KONSOLA ADMIN — "GoldSniperFX", e ndarë në NËNFAQE (kërkesa e pronarit, 2 gusht 2026):
//   1) MESAZHET (ballina) — mesazhet e gatshme me një prekje + shkrimi manual
//   2) SINJALET — publikimi i një sinjali te kanali
//   3) BLLOKIMET — filtrat e mesazheve që vijnë nga platforma e jashtme
//   4) LIDHJET — Telegram, parametrat e parazgjedhur, robotët e tjerë
//
// E RËNDËSISHME: feed-i i GoldSniperFX i takon llogarisë PRONARE (ajo që ka kanalin te
// gold_sniper_config), jo llogarisë admin. Prandaj çdo panel punon mbi 'owner' — të njëjtin
// rresht që lexon edhe funksioni 'platform-poll'. Kështu asnjë lidhje ekzistuese nuk prishet.
type Tab = 'messages' | 'signals' | 'filters' | 'report' | 'links';

// MESAZHET E GATSHME — tekstet shkojnë te kanali publik, prandaj janë në ANGLISHT.
// {v} zëvendësohet me vlerën e fushës "Çmimi/vlera" (nëse shabllon e kërkon).
interface Quick { id: string; icon: React.ElementType; label: string; text: string; needsValue?: boolean; tone: string }

const QUICK_GROUPS: { group: string; items: Quick[] }[] = [
  {
    group: 'Menaxhimi i rrezikut',
    items: [
      { id: 'be', icon: Lock, tone: 'sky', label: 'SL → Breakeven',
        text: '🔒 MOVE SL TO ENTRY (BREAKEVEN)\n\nSecure your position — risk is now zero.' },
      { id: 'sl', icon: Lock, tone: 'sky', label: 'Lëviz SL te {v}', needsValue: true,
        text: '🔒 MOVE SL TO {v}\n\nProtect your running profit.' },
      { id: 'half', icon: Scissors, tone: 'amber', label: 'Mbyll gjysmën',
        text: '📊 CLOSE HALF OF THE POSITION\n\nTake partial profit and let the rest run with SL at breakeven.' },
      { id: 'close', icon: XCircle, tone: 'red', label: 'Mbyll pozicionin',
        text: '⚠️ CLOSE THE POSITION NOW\n\nMarket conditions changed — we exit and protect the account.' },
    ],
  },
  {
    group: 'Rezultatet',
    items: [
      { id: 'tp1', icon: CheckCircle2, tone: 'emerald', label: 'TP1 u prek',
        text: '✅ TP1 HIT\n\nWell done! Secure partial profit and move SL to entry.' },
      { id: 'tp2', icon: CheckCircle2, tone: 'emerald', label: 'TP2 u prek',
        text: '✅ TP2 HIT\n\nExcellent — another target reached.' },
      { id: 'tp3', icon: CheckCircle2, tone: 'emerald', label: 'TP3 u prek',
        text: '✅ TP3 HIT\n\nOutstanding move — well managed.' },
      { id: 'tp4', icon: Trophy, tone: 'emerald', label: 'TP4 — objektivi i plotë',
        text: '🏆 TP4 HIT — FULL TARGET REACHED\n\nCongratulations to everyone who followed the plan!' },
    ],
  },
  {
    group: 'Sesioni & informacione',
    items: [
      { id: 'morning', icon: Sunrise, tone: 'amber', label: 'Mirëmëngjes — sesioni nis',
        text: '☀️ Good morning traders!\n\nMarket analysis in progress — signals will follow shortly. Stay ready.' },
      { id: 'evening', icon: Moon, tone: 'violet', label: 'Sesioni u mbyll',
        text: '🌙 Session closed for today.\n\nRest well — we are back tomorrow with new setups.' },
      { id: 'closed', icon: CalendarX, tone: 'gray', label: 'Tregu i mbyllur',
        text: '📅 The market is currently closed.\n\nSignals resume at market open. Orders placed now will be queued.' },
      { id: 'news', icon: AlertTriangle, tone: 'red', label: 'Lajme me ndikim',
        text: '⚠️ HIGH IMPACT NEWS AHEAD\n\nNo new entries until volatility settles. Manage your open positions carefully.' },
      { id: 'wait', icon: Clock, tone: 'gray', label: 'Pa setup — durim',
        text: '⏳ No valid setup right now.\n\nPatience is part of the strategy — we only take A+ trades.' },
      { id: 'greatday', icon: Trophy, tone: 'emerald', label: 'Ditë e suksesshme',
        text: '🥇 Great day, team!\n\nAll targets reached. Discipline pays — see you in the next session.' },
    ],
  },
];

// Etiketat e lexueshme të arsyeve të bllokimit (raporti).
const REASON_LABEL: Record<string, string> = {
  mention: 'Përmendje @',
  keyword: 'Fjalë e bllokuar',
  deposit: 'Depozitë / upgrade',
  video: 'Watch the video',
  scalp_group: 'Scalp group',
  siren_media: 'Sirenë me foto',
  siren_no_info: 'Sirenë pa informacion',
  hide_chat: 'Bisedë (filtri i komenteve)',
};

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const TONES: Record<string, string> = {
  sky: 'border-sky-500/30 bg-sky-500/[0.06] hover:bg-sky-500/[0.14] text-sky-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.14] text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/[0.06] hover:bg-amber-500/[0.14] text-amber-300',
  red: 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/[0.14] text-red-300',
  violet: 'border-violet-500/30 bg-violet-500/[0.06] hover:bg-violet-500/[0.14] text-violet-300',
  gray: 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-gray-300',
};

export default function AdminGoldSniperPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('messages');

  const [owner, setOwner] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string>('');
  const [ownerErr, setOwnerErr] = useState<string | null>(null);

  const [cfg, setCfg] = useState<TelegramSinConfig>(DEFAULT_TG_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [others, setOthers] = useState<OthersState | null>(null);
  const [othersBusy, setOthersBusy] = useState(false);

  // MESAZHET
  const [qValue, setQValue] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  // FILTRAT E MESAZHEVE (ruhen te gold_sniper_config i pronarit; lexohen nga 'platform-poll').
  const [fStrip, setFStrip] = useState(true);
  const [fHideChat, setFHideChat] = useState(false);
  const [fWords, setFWords] = useState('');
  const [fNew, setFNew] = useState('');
  const [fBusy, setFBusy] = useState(false);
  // Mesazh PRANË butonit — banneri lart nuk shihet kur faqja është e rrëshqitur poshtë.
  const [fMsg, setFMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // RAPORTI — mesazhet e bllokuara + vendimet e AI-së.
  interface BlockRow { id: string; reason: string; matched: string | null; text_excerpt: string; source: string | null; created_at: string }
  interface AiRow { id: string; text_in: string; text_out: string | null; decision: string; reason: string | null; created_at: string }
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [stats, setStats] = useState<{ total: number; by_reason: Record<string, number>; ai_total: number; ai_applied: number } | null>(null);
  const [repFilter, setRepFilter] = useState<string>('all');
  const [repBusy, setRepBusy] = useState(false);

  const loadReport = useCallback(async () => {
    setRepBusy(true);
    const [b, a, st] = await Promise.all([
      supabase.from('message_block_log').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('signal_ai_log').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.rpc('admin_block_stats', { days: 7 }),
    ]);
    if (b.data) setBlocks(b.data as BlockRow[]);
    if (a.data) setAiRows(a.data as AiRow[]);
    if (st.data) setStats(st.data as typeof stats);
    setRepBusy(false);
  }, []);
  useEffect(() => { if (tab === 'report') loadReport(); }, [tab, loadReport]);

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  // Pronari i feed-it — përcaktohet nga DB (funksioni 'goldsniper_owner').
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('goldsniper_owner');
      if (error) { setOwnerErr(error.message); return; }
      const id = data ? String(data) : '';
      if (!id) { setOwnerErr(t('Asnjë llogari nuk e ka të lidhur kanalin GoldSniper|FX ende.')); return; }
      setOwner(id);
      // Etiketa lexohet me RPC: RLS-ja e 'profiles' lejon vetëm rreshtin e vet, prandaj
      // një select i drejtpërdrejtë do të kthente bosh (edhe për adminin).
      const { data: nm } = await supabase.rpc('goldsniper_owner_name');
      setOwnerName(typeof nm === 'string' && nm ? nm : id);
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

  /* ---------------- MESAZHET ---------------- */

  // Dërgim me NJË PREKJE te kanali (mesazh i gatshëm ose tekst manual).
  const sendMessage = async (id: string, text: string) => {
    if (!owner || sending) return;
    setSending(id);
    const r = await postGoldSniperSignal({ message: text, owner_id: owner });
    setSending(null);
    if (r.ok) { flash('success', t('Mesazhi u dërgua te kanali ✅')); if (id === 'manual') setManual(''); }
    else flash('error', r.message || t('Dërgimi dështoi.'));
  };

  const sendQuick = (q: Quick) => {
    if (q.needsValue && !qValue.trim()) { flash('error', t('Plotëso fillimisht fushën "Çmimi/vlera".')); return; }
    sendMessage(q.id, q.text.replace('{v}', qValue.trim()));
  };

  /* ---------------- KONFIGURIMI ---------------- */

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

  // Lista e fjalëve të bllokuara si varg — burimi mbetet teksti (një fjalë për rresht).
  const wordList = fWords.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
  const setWords = (list: string[]) => setFWords(list.join('\n'));
  const addWord = () => {
    const w = fNew.trim();
    if (!w) return;
    if (wordList.some((x) => x.toLowerCase() === w.toLowerCase())) { setFNew(''); return; }
    setWords([...wordList, w]); setFNew('');
  };
  const removeWord = (i: number) => setWords(wordList.filter((_, j) => j !== i));

  const saveFilters = async (list?: string[]) => {
    if (!owner) return;
    setFBusy(true); setFMsg(null);
    const words = (list ?? wordList).join('\n');
    // VERIFIKIM: kërkohet rreshti i kthyer — një update pa përputhje s'jep gabim, por as ruajtje.
    const { data, error } = await supabase.from('gold_sniper_config').update({
      msg_strip_emojis: fStrip, msg_hide_chat: fHideChat, msg_blocked_words: words,
      updated_at: new Date().toISOString(),
    }).eq('user_id', owner).select('user_id');
    setFBusy(false);
    if (error) { setFMsg({ type: 'error', text: error.message }); return; }
    if (!data || data.length === 0) { setFMsg({ type: 'error', text: t('Ruajtja nuk u konfirmua nga serveri — rifresko faqen dhe provo sërish.') }); return; }
    setFMsg({ type: 'success', text: t('U ruajt — zbatohet menjëherë te mesazhi i parë i ri.') });
    refresh();
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

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'messages', label: t('Mesazhet'), icon: MessageSquare },
    { id: 'signals', label: t('Sinjalet'), icon: Crosshair },
    { id: 'filters', label: t('Bllokimet'), icon: Filter },
    { id: 'report', label: t('Raporti'), icon: BarChart3 },
    { id: 'links', label: t('Lidhjet'), icon: Link2 },
  ];

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

      {/* NËNFAQET */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl border transition-colors ${
                tab === x.id ? 'bg-amber-500 border-amber-500 text-gray-950' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
              <Icon className="w-3.5 h-3.5" />{x.label}
            </button>
          );
        })}
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 border ${msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* ============ 1) MESAZHET (ballina) ============ */}
      {tab === 'messages' && (
        <div className="space-y-4">
          {/* Vlera për shabllonet që e kërkojnë (p.sh. SL → 4050) */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <label className="block max-w-xs">
              <span className="text-[11px] text-gray-500">{t('Çmimi/vlera (përdoret nga shabllonet me {v})')}</span>
              <input value={qValue} onChange={(e) => setQValue(e.target.value)} placeholder="4050"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500" />
            </label>
            <p className="text-[10px] text-gray-600 mt-1.5">{t('Një klik mbi një shabllon e dërgon menjëherë te kanali.')}</p>
          </div>

          {QUICK_GROUPS.map((g) => (
            <div key={g.group} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <h3 className="text-white font-bold text-sm mb-3">{t(g.group)}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {g.items.map((q) => {
                  const Icon = q.icon;
                  const label = q.needsValue ? q.label.replace('{v}', qValue.trim() || '…') : q.label;
                  return (
                    <button key={q.id} onClick={() => sendQuick(q)} disabled={!!sending}
                      title={q.text.replace('{v}', qValue.trim() || '…')}
                      className={`flex items-center gap-2 text-left text-xs font-semibold px-3 py-2.5 rounded-xl border transition-colors disabled:opacity-50 ${TONES[q.tone]}`}>
                      {sending === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Icon className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{t(label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Shkrimi manual */}
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03] p-4 space-y-3">
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-400" />{t('Shkruaj mesazh manual')}
            </h3>
            <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={4}
              placeholder={t('Shkruaj mesazhin që do t\'u shkojë abonentëve te kanali…')}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 resize-none" />
            <button onClick={() => sendMessage('manual', manual.trim())} disabled={!!sending || !manual.trim()}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
              {sending === 'manual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Dërgo te kanali')}
            </button>
          </div>
        </div>
      )}

      {/* ============ 2) SINJALET ============ */}
      {tab === 'signals' && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03] overflow-hidden">
          <GoldSniperPage ownerId={owner} only="compose" />
        </div>
      )}

      {/* ============ 3) BLLOKIMET ============ */}
      {tab === 'filters' && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-sky-400" />{t('Filtrat e mesazheve')}
          </h3>
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

          {/* RREGULLAT E INTEGRUARA — gjithmonë aktive, të zbatuara në server. */}
          <div className="rounded-xl border border-red-500/25 bg-red-500/[0.05] p-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
              <Ban className="w-4 h-4 text-red-400" />{t('Rregullat e integruara (gjithmonë aktive)')}
            </div>
            <ul className="text-[11px] text-gray-400 space-y-1 list-disc list-inside">
              <li>{t('Çdo mesazh me përmendje @emri bllokohet komplet.')}</li>
              <li>{t('Mesazhet me "deposit" ose "upgrade account" bllokohen.')}</li>
              <li>{t('Mesazhet me "watch the video" bllokohen.')}</li>
              <li>{t('"Scalp group" bllokohet — përveç kur mesazhi është sinjal ose urdhër roboti.')}</li>
              <li>{t('Sirena 🚨 me foto/media bllokohet.')}</li>
              <li>{t('Sirena 🚨 pa asnjë informacion (pa çmim, pa sinjal) bllokohet; me informacion kalon.')}</li>
              <li>{t('Mesazhi që ripërshkruan një sinjal: mbahet vetëm sinjali, shfaqet si informacion dhe NUK hap trade të dytë.')}</li>
            </ul>
          </div>

          {/* LISTA E BLLOKIMEVE — shto me një fushë, hiq (zhblloko) me X te secili. */}
          <div className="rounded-xl bg-black/20 border border-white/5 p-3 space-y-3">
            <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5 text-red-400" />{t('Emrat/fjalët e bllokuara')}
            </span>

            <div className="flex gap-2">
              <input value={fNew} onChange={(e) => setFNew(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWord(); } }}
                placeholder={t('Shkruaj një emër ose fjalë dhe shtyp Enter')}
                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500" />
              <button onClick={addWord} disabled={!fNew.trim()}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 disabled:opacity-40">
                <Ban className="w-4 h-4" />{t('Blloko')}
              </button>
            </div>

            {wordList.length === 0 ? (
              <p className="text-[11px] text-gray-600">{t('Asnjë fjalë e bllokuar ende.')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {wordList.map((w, i) => (
                  <span key={`${w}-${i}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold pl-3 pr-1.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-200">
                    {w}
                    <button onClick={() => removeWord(i)} title={t('Zhblloko')}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-red-300 hover:bg-red-500/30 hover:text-white transition-colors">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <p className="text-[10px] text-gray-600">
              {t('Nëse mesazhi përmban ndonjë nga këto fjalë, nuk kalon as te abonentët, as te kanali. Përputhja bëhet me fjalë të plota — "Eric" nuk e kap "America".')}
            </p>
            <p className="text-[10px] text-amber-500/70">{t('Kujdes: ndryshimet zbatohen vetëm pasi të klikosh "Ruaj filtrat".')}</p>
          </div>

          {/* Ruajtja + përgjigjja PRANË butonit (banneri lart nuk shihet kur je poshtë). */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => saveFilters()} disabled={fBusy}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-gray-950 disabled:opacity-50">
              {fBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj filtrat')}
            </button>
            {fMsg && (
              <span className={`text-xs font-semibold ${fMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                {fMsg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ============ RAPORTI — mesazhet e refuzuara + vendimet e AI-së ============ */}
      {tab === 'report' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-gray-400 max-w-lg">
              {t('Çdo mesazh që nuk kalon regjistrohet këtu me arsyen dhe fjalën e saktë që e shkaktoi. Statistikat mbulojnë 7 ditët e fundit.')}
            </p>
            <button onClick={loadReport} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white">
              {repBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>

          {/* Përmbledhja */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l: t('Bllokime (7 ditë)'), v: stats.total, c: 'text-red-400' },
                { l: t('Lloje arsyesh'), v: Object.keys(stats.by_reason || {}).length, c: 'text-amber-400' },
                { l: t('Lexime me AI'), v: stats.ai_total, c: 'text-sky-400' },
                { l: t('Urdhra nga AI'), v: stats.ai_applied, c: 'text-emerald-400' },
              ].map((x) => (
                <div key={x.l} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <div className={`text-2xl font-bold ${x.c}`}>{x.v}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{x.l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filtri sipas arsyes */}
          <div className="flex gap-1.5 flex-wrap">
            {['all', ...Object.keys(stats?.by_reason || {})].map((r) => (
              <button key={r} onClick={() => setRepFilter(r)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${repFilter === r
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
                {r === 'all' ? t('Të gjitha') : REASON_LABEL[r] ? t(REASON_LABEL[r]) : r}
                {r !== 'all' && stats?.by_reason?.[r] ? ` · ${stats.by_reason[r]}` : ''}
              </button>
            ))}
          </div>

          {/* Lista e bllokimeve */}
          <div className="space-y-2">
            {blocks.filter((b) => repFilter === 'all' || b.reason === repFilter).length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">{t('Asnjë mesazh i bllokuar ende.')}</p>
            ) : blocks.filter((b) => repFilter === 'all' || b.reason === repFilter).map((b) => (
              <div key={b.id} className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">
                    <ShieldOff className="w-3 h-3" />{REASON_LABEL[b.reason] ? t(REASON_LABEL[b.reason]) : b.reason}
                  </span>
                  {b.matched && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                      {t('Përputhja')}: {b.matched}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500 ml-auto">{fmtWhen(b.created_at)}</span>
                </div>
                <p className="text-[11px] text-gray-300 whitespace-pre-wrap break-words leading-snug line-clamp-4">{b.text_excerpt}</p>
              </div>
            ))}
          </div>

          {/* Vendimet e AI-së */}
          <div className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.04] p-4 space-y-2">
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-sky-400" />{t('Leximi i urdhrave me AI — vendimet e fundit')}
            </h3>
            {aiRows.length === 0 ? (
              <p className="text-[11px] text-gray-500">{t('AI-ja ende s\'ka pasur nevojë të ndërhyjë — rregullat po i kuptojnë të gjitha.')}</p>
            ) : aiRows.map((a) => (
              <div key={a.id} className="rounded-xl bg-black/25 border border-white/5 p-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.text_out
                    ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-600/30 text-gray-400'}`}>
                    {a.text_out ? `→ ${a.text_out}` : t('Nuk u zbatua')}
                  </span>
                  {a.reason && <span className="text-[10px] text-amber-400/80">{a.reason}</span>}
                  <span className="text-[10px] text-gray-500 ml-auto">{fmtWhen(a.created_at)}</span>
                </div>
                <p className="text-[11px] text-gray-400 whitespace-pre-wrap break-words line-clamp-3">{a.text_in}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ 4) LIDHJET ============ */}
      {tab === 'links' && (
        <div className="space-y-4">
          {/* Lidhja me kanalin (bot + kanal) dhe webhook-u i platformës sate. */}
          <GoldSniperPage ownerId={owner} only="connection" />

          {/* Lidhja me Telegram */}
          <details className="rounded-xl border border-white/10 bg-white/[0.02]" open>
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

          {/* Parametrat e parazgjedhur */}
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

          {/* Robotët e tjerë */}
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
      )}
    </div>
  );
}
