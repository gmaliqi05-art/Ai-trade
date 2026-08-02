import { useState } from 'react';
import { ShieldCheck, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import { supabase } from '../lib/supabase';
import AdminGoldSniperPage from '../admin/AdminGoldSniperPage';

// QASJA E OPERATORIT — konsola GoldSniperFX për partnerin teknik / bashkëpronarin.
//
// DY KYÇE, JO NJË:
//  1) SERVERI — 'profiles.is_gs_operator'. Ky është kufiri i vërtetë: pa të, asnjë
//     tabelë e GoldSniperFX nuk lexohet e nuk shkruhet dot (RLS + RPC me 'is_gs_staff()').
//  2) KODI SEKRET — kyç i dytë në ndërfaqe, që faqja të mos hapet nga një pajisje e lënë
//     hapur. Kodi RUHET NË SERVER (tabela 'gs_operator_access') dhe verifikohet me RPC-në
//     'gs_operator_unlock' — kështu nuk gjendet i shkruar brenda kodit të faqes dhe mund
//     të ndërrohet pa e rilëshuar aplikacionin.
//
// Zhbllokimi mbahet mend vetëm për sesionin e skedës (sessionStorage): mbyllja e skedës
// e kërkon sërish kodin.
const UNLOCK_KEY = 'gs_operator_unlocked';

export default function OperatorGoldSniperPage() {
  const { t } = useI18n();
  const { profile } = useAuth();

  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const allowed = !!profile && (profile.is_admin || profile.is_gs_operator === true);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(false);
    const { data, error } = await supabase.rpc('gs_operator_unlock', { in_code: code.trim() });
    setBusy(false);
    if (error || data !== true) { setErr(true); return; }
    setUnlocked(true); setCode('');
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch { /* injoro */ }
  };

  const lock = () => {
    setUnlocked(false);
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* injoro */ }
  };

  if (!profile) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>;
  }

  // Llogari pa rolin e operatorit — asgjë nuk hapet (as me kod të saktë: serveri e ndalon).
  if (!allowed) {
    return (
      <div className="max-w-md mx-auto p-4">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center space-y-2">
          <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
          <h2 className="text-white font-bold">{t('Kjo faqe është e rezervuar')}</h2>
          <p className="text-[12px] text-gray-400">
            {t('Konsola GoldSniperFX hapet vetëm nga llogaritë me rol operatori. Kontakto pronarin e platformës.')}
          </p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto p-4">
        <div className="rounded-2xl border border-amber-500/30 bg-gray-900 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <Lock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm leading-tight">{t('Konsola GoldSniperFX')}</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">{t('Fut kodin sekret për të hapur konsolën.')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value); setErr(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={t('Kodi sekret')}
              className={`w-full bg-black/30 border rounded-xl px-3 py-2.5 text-sm text-white tracking-[0.3em] text-center focus:outline-none ${
                err ? 'border-red-500' : 'border-amber-500/40 focus:border-amber-500'}`}
            />
            {err && <p className="text-[11px] text-red-400 text-center">{t('Kod i pasaktë.')}</p>}
            <button
              onClick={submit}
              disabled={busy || !code.trim()}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              <ShieldCheck className="w-4 h-4" />{t('Hap konsolën')}
            </button>
          </div>

          <p className="text-[10px] text-gray-600 leading-relaxed">
            {t('Kjo qasje mbulon vetëm GoldSniperFX — mesazhet, sinjalet, bllokimet, raportin dhe lidhjet. Pjesa tjetër e panelit të administrimit mbetet e mbyllur.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2">
          <span className="inline-flex items-center gap-2 text-[11px] text-emerald-300 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />{t('Konsola u hap — qasje operatori')}
          </span>
          <button onClick={lock} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
            <Lock className="w-3 h-3" />{t('Mbyll konsolën')}
          </button>
        </div>
      </div>
      <AdminGoldSniperPage />
    </div>
  );
}
