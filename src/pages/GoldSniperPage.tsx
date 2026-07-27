import { useState, useEffect, useCallback } from 'react';
import {
  Crosshair, Send, Loader2, Save, Eye, EyeOff, ChevronDown, RefreshCw, TrendingUp, TrendingDown, CheckCircle2, XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import {
  loadGoldSniperConfig, saveGoldSniperConfig, loadGoldSniperPosts, testGoldSniper, postGoldSniperSignal,
  DEFAULT_GS_CONFIG, type GoldSniperConfig, type GoldSniperPost,
} from '../services/goldSniper';

// GoldSniper|FX — faqja e publikimit të sinjaleve te kanali i vetë përdoruesit (bot Telegram).
export default function GoldSniperPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<GoldSniperConfig>(DEFAULT_GS_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [posts, setPosts] = useState<GoldSniperPost[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  // Formulari i sinjalit
  const [dir, setDir] = useState<'buy' | 'sell'>('buy');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp1, setTp1] = useState(''); const [tp2, setTp2] = useState(''); const [tp3, setTp3] = useState(''); const [tp4, setTp4] = useState('');
  const [note, setNote] = useState('');

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const refresh = useCallback(async () => {
    if (!user) return;
    try { setCfg(await loadGoldSniperConfig(user.id)); setLoaded(true); } catch { setLoaded(false); }
    try { setPosts(await loadGoldSniperPosts(user.id)); } catch { /* */ }
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);

  const set = <K extends keyof GoldSniperConfig>(k: K, v: GoldSniperConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  const saveCfg = async (patch?: Partial<GoldSniperConfig>) => {
    if (!user || !loaded) return;
    setBusy('save'); setMsg(null);
    try { await saveGoldSniperConfig(user.id, patch ?? cfg); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
    setBusy(null);
  };

  const doTest = async () => {
    setBusy('test'); setMsg(null);
    await saveGoldSniperConfig(user!.id, cfg).catch(() => {});
    const r = await testGoldSniper();
    if (r.ok) flash('success', t('Mesazhi i provës u dërgua te kanali ✅'));
    else flash('error', r.message || t('Dërgimi dështoi.'));
    setBusy(null);
  };

  const postSignal = async () => {
    setBusy('post'); setMsg(null);
    const tps = [tp1, tp2, tp3, tp4].map(Number).filter(n => Number.isFinite(n) && n > 0);
    const r = await postGoldSniperSignal({
      symbol: symbol.toUpperCase().trim(), direction: dir,
      entry: Number(entry) || undefined, stop_loss: Number(sl) || undefined, tps,
      note: note.trim() || undefined,
    });
    if (r.ok) { flash('success', t('Sinjali u postua te kanali ✅')); setEntry(''); setSl(''); setTp1(''); setTp2(''); setTp3(''); setTp4(''); setNote(''); await refresh(); }
    else flash('error', r.message || t('Postimi dështoi.'));
    setBusy(null);
  };

  const inp = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';
  const configured = !!(cfg.bot_token && cfg.channel_id);

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Crosshair className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">GoldSniper|FX</h1>
          <p className="text-xs text-gray-400">{t('Publiko sinjale te kanali yt në Telegram — automatik, me tekstin tënd.')}</p>
        </div>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>}

      {/* KOMPOZIMI I SINJALIT */}
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03] p-4 space-y-3">
        <div className="text-sm font-semibold text-white flex items-center gap-2"><Send className="w-4 h-4 text-amber-400" />{t('Posto një sinjal')}</div>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 w-fit">
          <button onClick={() => setDir('buy')} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1 ${dir === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400'}`}><TrendingUp className="w-3.5 h-3.5" />BUY</button>
          <button onClick={() => setDir('sell')} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1 ${dir === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400'}`}><TrendingDown className="w-3.5 h-3.5" />SELL</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block"><span className="text-[10px] text-gray-500">{t('Simboli')}</span><input value={symbol} onChange={e => setSymbol(e.target.value)} className={inp} /></label>
          <label className="block"><span className="text-[10px] text-gray-500">{t('Hyrja')}</span><input type="number" step="0.01" value={entry} onChange={e => setEntry(e.target.value)} placeholder="4082" className={inp} /></label>
          <label className="block"><span className="text-[10px] text-red-400">SL</span><input type="number" step="0.01" value={sl} onChange={e => setSl(e.target.value)} placeholder="4076" className={inp} /></label>
          <label className="block"><span className="text-[10px] text-emerald-400">TP1</span><input type="number" step="0.01" value={tp1} onChange={e => setTp1(e.target.value)} className={inp} /></label>
          <label className="block"><span className="text-[10px] text-emerald-400">TP2</span><input type="number" step="0.01" value={tp2} onChange={e => setTp2(e.target.value)} className={inp} /></label>
          <label className="block"><span className="text-[10px] text-emerald-400">TP3</span><input type="number" step="0.01" value={tp3} onChange={e => setTp3(e.target.value)} className={inp} /></label>
          <label className="block"><span className="text-[10px] text-emerald-400">TP4</span><input type="number" step="0.01" value={tp4} onChange={e => setTp4(e.target.value)} className={inp} /></label>
        </div>
        <label className="block"><span className="text-[10px] text-gray-500">{t('Shënim (opsional) — p.sh. "Hyni tani", menaxhoni rrezikun…')}</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={inp} /></label>
        <button onClick={postSignal} disabled={!configured || busy === 'post'} className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
          {busy === 'post' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Posto te GoldSniper|FX')}
        </button>
        {!configured && <p className="text-[11px] text-amber-400/80">{t('Lidh botin dhe kanalin më poshtë para se të postosh.')}</p>}
      </div>

      {/* LIDHJA E KANALIT */}
      <details className="rounded-2xl border border-white/10 bg-white/[0.02]" open={!configured}>
        <summary className="cursor-pointer select-none list-none p-3 sm:p-4 text-sm font-semibold text-white flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Send className="w-4 h-4 text-sky-400" />{t('Lidhja me kanalin')} {configured && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300">{t('I lidhur')}</span>}</span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </summary>
        <div className="px-3 sm:px-4 pb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2"><span className="text-[11px] text-gray-500">{t('Bot Token (nga @BotFather)')}</span>
              <div className="relative">
                <input type={showToken ? 'text' : 'password'} value={cfg.bot_token} onChange={e => set('bot_token', e.target.value)} placeholder="123456:ABC-..." className={`${inp} pr-9`} />
                <button onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </label>
            <label className="block"><span className="text-[11px] text-gray-500">{t('ID/@username i kanalit')}</span><input value={cfg.channel_id} onChange={e => set('channel_id', e.target.value)} placeholder="@GoldSniperFX ose -100…" className={inp} /></label>
            <label className="block"><span className="text-[11px] text-gray-500">{t('Emri i kanalit')}</span><input value={cfg.channel_name} onChange={e => set('channel_name', e.target.value)} className={inp} /></label>
            <label className="block sm:col-span-2"><span className="text-[11px] text-gray-500">{t('Titulli i mesazhit (header)')}</span><input value={cfg.header} onChange={e => set('header', e.target.value)} className={inp} /></label>
            <label className="block sm:col-span-2"><span className="text-[11px] text-gray-500">{t('Fundi i mesazhit (footer, opsional)')}</span><input value={cfg.footer} onChange={e => set('footer', e.target.value)} placeholder="@GoldSniperFX" className={inp} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => saveCfg()} disabled={busy === 'save'} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj')}
            </button>
            <button onClick={doTest} disabled={!cfg.bot_token || !cfg.channel_id || busy === 'test'} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-50">
              {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Testo dërgimin')}
            </button>
          </div>
          <ol className="space-y-1.5 text-[11px] text-gray-400 leading-relaxed bg-black/30 border border-white/10 rounded-xl p-3">
            <li><span className="text-amber-400 font-bold">1.</span> {t('Hap @BotFather në Telegram → /newbot → merr Bot Token.')}</li>
            <li><span className="text-amber-400 font-bold">2.</span> {t('Shto botin si ADMIN te kanali GoldSniper|FX (me të drejtë "Post messages").')}</li>
            <li><span className="text-amber-400 font-bold">3.</span> {t('Vendos @username-in e kanalit (ose id-në -100…) këtu, ruaj dhe testo.')}</li>
          </ol>
        </div>
      </details>

      {/* HISTORIKU */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-white">{t('Postimet e fundit')}</span>
          <button onClick={refresh} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white"><RefreshCw className="w-3.5 h-3.5" />{t('Rifresko')}</button>
        </div>
        {posts.length === 0 ? (
          <p className="text-[11px] text-gray-500 py-3 text-center">{t('Ende s\'ka postime.')}</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {posts.map(p => {
              const d = new Date(p.created_at);
              return (
                <div key={p.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 flex items-start justify-between gap-2">
                  <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-words font-sans flex-1">{(p.message || '').replace(/<\/?b>/g, '')}</pre>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[9px] text-gray-500 whitespace-nowrap">{d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {p.status === 'sent'
                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('Dërguar')}</span>
                      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 inline-flex items-center gap-1" title={p.error || ''}><XCircle className="w-3 h-3" />{t('Dështoi')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
