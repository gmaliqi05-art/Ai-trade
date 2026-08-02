import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Bitcoin, KeyRound, Copy, Loader2, Save, Plus, Trash2, CheckCircle2,
  ShieldCheck, ShieldAlert, UserCheck, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';
import type { CryptoWallet } from '../services/subscription';

// PAGESAT (Admin) — lidhja me Stripe + kripto-pagesat + aktivizimi manual i abonimeve.
// Çelësat e Stripe ruhen te billing_secrets (RLS pa politika → i lexon vetëm serveri);
// admini i VENDOS me RPC dhe sheh vetëm statusin + 4 shenjat e fundit, kurrë çelësin e plotë.
// Kripto-portofolat ruhen te billing_config → shfaqen vetë te tabela e planeve e klientit.
const WEBHOOK_URL = 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/stripe-webhook';

interface StripeStatus { has_secret: boolean; secret_hint: string | null; has_webhook: boolean; updated_at: string | null }
interface UserOpt { id: string; full_name: string | null; username: string | null; subscription_tier?: string | null }

export default function AdminPaymentsPage() {
  const { t } = useI18n();

  // ---- Stripe ----
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [secretKey, setSecretKey] = useState('');
  const [webhookKey, setWebhookKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [savingStripe, setSavingStripe] = useState(false);

  // ---- Kripto ----
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [cryptoNote, setCryptoNote] = useState('');
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [savingCrypto, setSavingCrypto] = useState(false);

  // ---- Aktivizim manual (pas kripto-pagesës) ----
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [actUser, setActUser] = useState('');
  const [actTier, setActTier] = useState<'monthly' | 'yearly'>('monthly');
  const [actMonths, setActMonths] = useState(1);
  const [activating, setActivating] = useState(false);

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const refresh = useCallback(async () => {
    const [{ data: st }, { data: bc }, { data: us }] = await Promise.all([
      supabase.rpc('admin_stripe_status'),
      supabase.from('billing_config').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('get_all_profiles'),
    ]);
    if (st) setStatus(st as StripeStatus);
    if (bc) {
      const b = bc as { crypto_enabled: boolean; crypto_note: string; crypto_wallets: CryptoWallet[] | null };
      setCryptoEnabled(!!b.crypto_enabled);
      setCryptoNote(b.crypto_note || '');
      setWallets(Array.isArray(b.crypto_wallets) ? b.crypto_wallets : []);
    }
    if (Array.isArray(us)) setUsers(us as UserOpt[]);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const saveStripe = async () => {
    if (!secretKey.trim() && !webhookKey.trim()) return;
    setSavingStripe(true);
    const { error } = await supabase.rpc('admin_set_stripe_keys', {
      p_secret: secretKey.trim() || null, p_webhook: webhookKey.trim() || null,
    });
    setSavingStripe(false);
    if (error) flash('error', error.message);
    else { setSecretKey(''); setWebhookKey(''); flash('success', t('Çelësat u ruajtën — pagesat me kartë janë gati.')); refresh(); }
  };

  const saveCrypto = async () => {
    setSavingCrypto(true);
    const clean = wallets.filter(w => w.coin.trim() && w.address.trim());
    const { error } = await supabase.from('billing_config').update({
      crypto_enabled: cryptoEnabled, crypto_note: cryptoNote.trim(),
      crypto_wallets: clean, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSavingCrypto(false);
    if (error) flash('error', error.message);
    else { setWallets(clean); flash('success', t('Kripto-pagesat u ruajtën — shfaqen menjëherë te tabela e planeve.')); }
  };

  const activate = async () => {
    if (!actUser) return;
    setActivating(true);
    const expires = new Date();
    expires.setMonth(expires.getMonth() + (actTier === 'yearly' ? 12 * actMonths : actMonths));
    const { data, error } = await supabase.from('profiles').update({
      subscription_tier: actTier, subscription_status: 'active',
      subscription_expires_at: expires.toISOString(), subscription_started_at: new Date().toISOString(),
    }).eq('id', actUser).select('id');
    setActivating(false);
    if (error || !data?.length) flash('error', error?.message || t('Aktivizimi dështoi.'));
    else { flash('success', t('Abonimi u aktivizua deri më {d}.', { d: expires.toLocaleDateString('en-GB') })); refresh(); }
  };

  const setW = (i: number, patch: Partial<CryptoWallet>) =>
    setWallets(ws => ws.map((w, j) => j === i ? { ...w, ...patch } : w));

  const inp = 'w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500';

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">{t('Pagesat — Stripe & Kripto')}</h2>
          <p className="text-gray-500 text-xs">{t('Lidhjet e pagesave; çmimet e planeve menaxhohen te "Planet e Abonimit".')}</p>
        </div>
      </div>

      {msg && <div className={`text-sm rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>}

      {/* ============ STRIPE ============ */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-violet-400" />{t('Lidhja me Stripe (kartat Debit/Kredit)')}
        </h3>

        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold ${status?.has_secret ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {status?.has_secret ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {status?.has_secret ? t('Çelësi sekret: i vendosur') + (status.secret_hint ? ` (${status.secret_hint})` : '') : t('Çelësi sekret: mungon')}
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold ${status?.has_webhook ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {status?.has_webhook ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {status?.has_webhook ? t('Webhook: i vendosur') : t('Webhook: mungon')}
          </span>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] text-gray-500">{t('Çelësi sekret (sk_live_… ose sk_test_…) — nga dashboard.stripe.com → Developers → API keys')}</span>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'} value={secretKey} onChange={e => setSecretKey(e.target.value)}
                placeholder="sk_live_…" className={`${inp} pr-10 font-mono`} />
              <button onClick={() => setShowSecret(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500">{t('Webhook signing secret (whsec_…) — krijohet kur regjistron webhook-un më poshtë te Stripe')}</span>
            <input type="password" value={webhookKey} onChange={e => setWebhookKey(e.target.value)}
              placeholder="whsec_…" className={`${inp} font-mono`} />
          </label>
          <div className="rounded-xl bg-gray-950 border border-gray-800 p-3">
            <div className="text-[10px] text-gray-500 mb-1">{t('Adresa e webhook-ut për te Stripe (Developers → Webhooks → Add endpoint):')}</div>
            <div className="flex items-center gap-2">
              <code className="text-[11px] text-violet-300 truncate flex-1">{WEBHOOK_URL}</code>
              <button onClick={() => { navigator.clipboard?.writeText(WEBHOOK_URL); flash('success', t('U kopjua.')); }}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white"><Copy className="w-3 h-3" />{t('Kopjo')}</button>
            </div>
            <div className="text-[10px] text-gray-600 mt-1.5">{t('Ngjarjet: checkout.session.completed · invoice.paid · customer.subscription.updated · customer.subscription.deleted · invoice.payment_failed')}</div>
          </div>
          <button onClick={saveStripe} disabled={savingStripe || (!secretKey.trim() && !webhookKey.trim())}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50">
            {savingStripe ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj çelësat')}
          </button>
          <p className="text-[10px] text-gray-600">{t('Çelësat ruhen të mbrojtur në server dhe nuk lexohen kurrë nga shfletuesi — këtu shfaqet vetëm statusi. Fusha bosh = çelësi ekzistues nuk preket.')}</p>
        </div>
      </section>

      {/* ============ KRIPTO ============ */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-orange-400" />{t('Kripto-pagesat')}
          </h3>
          <button onClick={() => setCryptoEnabled(v => !v)}
            className="flex items-center gap-2" title={cryptoEnabled ? 'ON' : 'OFF'}>
            <span className={`text-[10px] font-bold ${cryptoEnabled ? 'text-emerald-400' : 'text-gray-500'}`}>{cryptoEnabled ? 'ON' : 'OFF'}</span>
            <span className={`w-10 h-5 rounded-full relative transition-all ${cryptoEnabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${cryptoEnabled ? 'left-5' : 'left-0.5'}`} />
            </span>
          </button>
        </div>
        <p className="text-[11px] text-gray-500">{t('Kur është ON, klientët shohin te tabela e planeve seksionin "Paguaj me kriptovalutë" me adresat më poshtë. Pas pagesës, klienti dërgon dëshminë dhe ti e aktivizon abonimin manualisht (seksioni i fundit).')}</p>

        <div className="space-y-2">
          {wallets.map((w, i) => (
            <div key={i} className="grid grid-cols-[90px_110px_1fr_auto] gap-2 items-center">
              <input value={w.coin} onChange={e => setW(i, { coin: e.target.value.toUpperCase() })} placeholder="BTC" className={inp} />
              <input value={w.network} onChange={e => setW(i, { network: e.target.value })} placeholder={t('Rrjeti')} className={inp} />
              <input value={w.address} onChange={e => setW(i, { address: e.target.value.trim() })} placeholder={t('Adresa e portofolit')} className={`${inp} font-mono text-[12px]`} />
              <button onClick={() => setWallets(ws => ws.filter((_, j) => j !== i))}
                className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setWallets(ws => [...ws, { coin: '', network: '', address: '' }])}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white">
            <Plus className="w-3.5 h-3.5" />{t('Shto portofol')}
          </button>
        </div>

        <label className="block">
          <span className="text-[11px] text-gray-500">{t('Shënim për klientët (opsional — p.sh. shuma minimale, konfirmimet)')}</span>
          <textarea value={cryptoNote} onChange={e => setCryptoNote(e.target.value)} rows={2} className={`${inp} resize-none`} />
        </label>

        <button onClick={saveCrypto} disabled={savingCrypto}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-gray-950 disabled:opacity-50">
          {savingCrypto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj kripto-pagesat')}
        </button>
      </section>

      {/* ============ AKTIVIZIM MANUAL ============ */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-emerald-400" />{t('Aktivizo abonim manualisht (pas kripto-pagesës)')}
        </h3>
        <div className="grid sm:grid-cols-[1fr_130px_90px_auto] gap-2 items-end">
          <label className="block">
            <span className="text-[11px] text-gray-500">{t('Përdoruesi')}</span>
            <select value={actUser} onChange={e => setActUser(e.target.value)} className={inp}>
              <option value="">{t('Zgjidh…')}</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.username || u.id.slice(0, 8)}{u.subscription_tier ? ` — ${u.subscription_tier}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500">{t('Plani')}</span>
            <select value={actTier} onChange={e => setActTier(e.target.value as 'monthly' | 'yearly')} className={inp}>
              <option value="monthly">{t('Mujor')}</option>
              <option value="yearly">{t('Vjetor')}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500">{actTier === 'yearly' ? t('Vite') : t('Muaj')}</span>
            <input type="number" min={1} max={36} value={actMonths} onChange={e => setActMonths(Math.max(1, Number(e.target.value) || 1))} className={inp} />
          </label>
          <button onClick={activate} disabled={activating || !actUser}
            className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 disabled:opacity-50">
            {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('Aktivizo')}
          </button>
        </div>
        <p className="text-[10px] text-gray-600">{t('Vendos statusin "active" me skadim sipas kohëzgjatjes — përdoruesi e sheh menjëherë te Cilësimet → Abonimi.')}</p>
      </section>
    </div>
  );
}
