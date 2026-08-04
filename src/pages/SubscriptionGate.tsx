import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import SubscriptionPlans from '../components/SubscriptionPlans';
import { loadSubscription, type SubState } from '../services/subscription';

// EKRANI I PLANEVE — shfaqet MENJËHERË pas "Krijo llogari" (dhe kur abonimi ka skaduar).
// Përdoruesi zgjedh: provë falas 15 ditë · mujor 69€ · vjetor 699€ (pagesa me Stripe).
export default function SubscriptionGate() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const { t } = useI18n();
  const [sub, setSub] = useState<SubState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setSub(await loadSubscription(user.id));
    setLoading(false);
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);

  // Kthimi nga Stripe (?checkout=success): webhook-u e aktivizon abonimin brenda pak sekondash —
  // rifresko disa herë derisa statusi të bëhet aktiv.
  useEffect(() => {
    if (!user || !/checkout=success/.test(window.location.search)) return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      const s = await loadSubscription(user.id);
      setSub(s);
      if ((s && ['active', 'trialing'].includes(s.status)) || tries >= 10) {
        clearInterval(id);
        await refreshProfile();
        if (s && ['active', 'trialing'].includes(s.status)) window.history.replaceState({}, '', window.location.pathname);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [user, refreshProfile]);

  const expired = sub && ['expired', 'canceled', 'past_due'].includes(sub.status);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-gray-950" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-none">GoldSniper<span className="text-amber-400">FX</span></div>
            <div className="text-amber-400 text-[10px] font-semibold tracking-[0.2em] uppercase mt-0.5">{t('PLATFORMË AI')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button onClick={signOut} title={t('Dil')}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-6 py-8">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
            {expired ? t('Abonimi yt ka skaduar') : t('Zgjidh planin tënd')}
          </h1>
          <p className="text-gray-400 mb-6">
            {expired
              ? t('Rinovo abonimin për të vazhduar me sinjalet dhe robotin auto-trade.')
              : t('Mirë se erdhe, {name}! Nis me provën falas ose zgjidh një abonim për të hapur sinjalet dhe robotin.', { name: profile?.first_name || profile?.full_name || '' })}
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />{t('Po ngarkohet…')}</div>
          ) : (
            <SubscriptionPlans sub={sub} onDone={async () => { await refresh(); await refreshProfile(); }} />
          )}
        </div>
      </div>
    </div>
  );
}
