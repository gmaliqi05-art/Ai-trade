import { useState, useEffect, useRef } from 'react';
import { TrendingUp, Loader2, ShieldCheck, LogOut, Mail, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { verifyAccountCode } from '../services/vipCodes';
import { sendVerificationEmail } from '../services/email';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

// Ekrani i VERIFIKIMIT — shfaqet pas regjistrimit derisa përdoruesi të vendosë kodin 6-shifror.
// Kodi i shkon me EMAIL automatikisht sapo hapet ky ekran (dhe mund të ridërgohet me buton).
export default function AccountVerifyGate() {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  // DËRGIMI AUTOMATIK — një herë për çdo hapje të ekranit.
  const [mailState, setMailState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current || !profile || profile.is_verified) return;
    autoSent.current = true;
    setMailState('sending');
    sendVerificationEmail().then((r) => setMailState(r.ok ? 'sent' : 'failed'));
  }, [profile]);

  const resend = async () => {
    setMailState('sending');
    const r = await sendVerificationEmail();
    setMailState(r.ok ? 'sent' : 'failed');
  };

  const submit = async (raw?: string) => {
    const clean = (raw ?? code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) { setErr(true); return; }
    setBusy(true); setErr(false);
    const ok = await verifyAccountCode(clean);
    if (ok) {
      await refreshProfile(); // is_verified → true → hapet aplikacioni
    } else {
      setErr(true); setBusy(false);
    }
  };

  // KODI NGA EMAIL-I — lidhja "#verify=123456" e mbush fushën dhe e konfirmon vetë.
  // Email-i nuk mund të kopjojë asgjë në kujtesë, prandaj kodin e sjell adresa.
  const fromLink = useRef(false);
  useEffect(() => {
    if (fromLink.current || !profile || profile.is_verified) return;
    const m = /[#&]verify=(\d{6})\b/.exec(window.location.hash || '');
    if (!m) return;
    fromLink.current = true;
    // Hiqe kodin nga adresa që të mos mbetet në histori apo t'i dërgohet dikujt me link.
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* injoro */ }
    setCode(m[1]);
    submit(m[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4 z-20"><LanguageSwitcher /></div>
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute top-20 left-10 w-64 h-64 rounded-full bg-amber-400 blur-3xl" />
        <div className="absolute bottom-20 right-10 w-80 h-80 rounded-full bg-amber-500 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-gray-950" />
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-white leading-none">GoldSniper<span className="text-amber-400">FX</span></h1>
            <p className="text-amber-400 text-xs font-semibold tracking-[0.2em] uppercase mt-1">{t('PLATFORMË AI')}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-amber-400 mb-2">
          <ShieldCheck className="w-5 h-5" />
          <h2 className="text-lg font-bold text-white">{t('Verifiko llogarinë')}</h2>
        </div>
        <p className="text-center text-gray-400 text-sm mb-6 leading-relaxed">
          {t('Vendos kodin e verifikimit me 6 shifra për të hapur platformën.')}<br />
          <span className="text-amber-400/90 font-medium inline-flex items-center gap-1.5 mt-1">
            <Mail className="w-3.5 h-3.5" />
            {mailState === 'sending' ? t('Po dërgohet kodi...')
              : mailState === 'failed' ? t('Kodi s\'u dërgua dot — provo "Ridërgo kodin".')
              : t('E dërguam te {email}', { email: user?.email || '' })}
          </span>
        </p>

        <label className="block text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-1.5">{t('Kodi i verifikimit')}</label>
        <input
          value={code}
          autoFocus
          inputMode="numeric"
          maxLength={6}
          onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '')); setErr(false); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="______"
          className={`w-full bg-black/30 border rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-bold text-white focus:outline-none ${err ? 'border-red-500' : 'border-amber-500/40 focus:border-amber-500'}`}
        />
        {err && <p className="text-[12px] text-red-400 mt-2 text-center">{t('Kod i pasaktë. Kontrollo email-in ose ridërgo kodin.')}</p>}

        <button onClick={() => submit()} disabled={busy || code.length !== 6}
          className="mt-5 w-full flex items-center justify-center gap-2 text-sm font-bold px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50 transition-colors">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('Verifiko dhe hyr')}
        </button>

        {/* RIDËRGIMI — nëse email-i vonon ose humbet. */}
        <button onClick={resend} disabled={mailState === 'sending'}
          className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white disabled:opacity-50 transition-colors">
          {mailState === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {t('Ridërgo kodin')}
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-2">
          {t('Kontrollo edhe dosjen Spam. Nëse prapë nuk vjen, shkruaj te support@goldsniper.vip')}
        </p>

        <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between text-xs">
          <span className="text-gray-500 truncate">{profile?.full_name || t('Trader')}</span>
          <button onClick={signOut} className="flex items-center gap-1.5 text-gray-500 hover:text-amber-400 transition-colors">
            <LogOut className="w-3.5 h-3.5" />{t('Dil')}
          </button>
        </div>
      </div>
    </div>
  );
}
