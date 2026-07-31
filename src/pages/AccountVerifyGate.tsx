import { useState } from 'react';
import { TrendingUp, Loader2, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { verifyAccountCode } from '../services/vipCodes';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

// Ekrani i VERIFIKIMIT — shfaqet pas regjistrimit derisa përdoruesi të vendosë kodin 6-shifror
// që ia jep Admini. Pa këtë kod, s'ka qasje në asnjë faqe të platformës.
export default function AccountVerifyGate() {
  const { profile, refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const submit = async () => {
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) { setErr(true); return; }
    setBusy(true); setErr(false);
    const ok = await verifyAccountCode(clean);
    if (ok) {
      await refreshProfile(); // is_verified → true → hapet aplikacioni
    } else {
      setErr(true); setBusy(false);
    }
  };

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
            <h1 className="text-2xl font-bold text-white leading-none">GOLDTRADE</h1>
            <p className="text-amber-400 text-xs font-semibold tracking-[0.2em] uppercase mt-1">{t('PLATFORMË AI')}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-amber-400 mb-2">
          <ShieldCheck className="w-5 h-5" />
          <h2 className="text-lg font-bold text-white">{t('Verifiko llogarinë')}</h2>
        </div>
        <p className="text-center text-gray-400 text-sm mb-6 leading-relaxed">
          {t('Vendos kodin e verifikimit me 6 shifra për të hapur platformën.')}<br />
          <span className="text-amber-400/90 font-medium">{t('Këtë kod do ta marrësh nga Admini.')}</span>
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
        {err && <p className="text-[12px] text-red-400 mt-2 text-center">{t('Kod i pasaktë. Kontrollo me Adminin.')}</p>}

        <button onClick={submit} disabled={busy || code.length !== 6}
          className="mt-5 w-full flex items-center justify-center gap-2 text-sm font-bold px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50 transition-colors">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('Verifiko dhe hyr')}
        </button>

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
