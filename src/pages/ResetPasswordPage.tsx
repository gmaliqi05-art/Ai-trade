import { useState } from 'react';
import { TrendingUp, Loader2, KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

// EKRANI I FJALËKALIMIT TË RI — hapet kur përdoruesi vjen nga lidhja e email-it.
// Supabase e ka vendosur tashmë një sesion rikuperimi, prandaj mjafton updateUser().
export default function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 6) { setErr(t('Fjalëkalimi duhet të ketë të paktën 6 shenja.')); return; }
    if (pw !== pw2) { setErr(t('Fjalëkalimet nuk përputhen.')); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4 z-20"><LanguageSwitcher /></div>
      <div className="relative z-10 w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center">
            <TrendingUp className="w-7 h-7 text-gray-950" />
          </div>
          <div className="text-left">
            <h1 className="text-xl font-bold text-white leading-none">GOLDSNIPER</h1>
            <p className="text-amber-400 text-[10px] font-semibold tracking-[0.2em] uppercase mt-1">{t('PLATFORMË AI')}</p>
          </div>
        </div>

        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold text-white">{t('Fjalëkalimi u ndryshua')}</h2>
            <p className="text-sm text-gray-400">{t('Tani mund të hysh me fjalëkalimin e ri.')}</p>
            <button onClick={onDone}
              className="w-full bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold py-3 rounded-xl transition-colors">
              {t('Vazhdo')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-amber-400 mb-1">
              <KeyRound className="w-5 h-5" />
              <h2 className="text-lg font-bold text-white">{t('Vendos fjalëkalim të ri')}</h2>
            </div>

            <div className="relative">
              <input type={show ? 'text' : 'password'} value={pw} autoFocus
                onChange={(e) => { setPw(e.target.value); setErr(''); }}
                placeholder={t('Fjalëkalimi i ri')}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-white text-sm focus:outline-none focus:border-amber-500" />
              <button type="button" onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <input type={show ? 'text' : 'password'} value={pw2}
              onChange={(e) => { setPw2(e.target.value); setErr(''); }}
              placeholder={t('Përsërit fjalëkalimin')}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500" />

            {err && <div className="bg-red-900/30 border border-red-800/50 rounded-xl px-4 py-2.5 text-red-400 text-sm">{err}</div>}

            <button type="submit" disabled={busy || !pw || !pw2}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-gray-950 font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('Ruaj fjalëkalimin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
