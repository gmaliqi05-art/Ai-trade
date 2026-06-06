// Matësi i përdorimit të planit: sa analiza AI ke përdorur këtë muaj nga limiti i planit.
import { useEffect, useState } from 'react';
import { Brain, Crown } from 'lucide-react';
import { getMyUsage, type UsageInfo } from '../services/usage';
import { useI18n } from '../i18n/i18n';

export default function UsageMeter() {
  const { t } = useI18n();
  const [u, setU] = useState<UsageInfo | null>(null);

  useEffect(() => {
    getMyUsage().then(setU);
    const h = () => getMyUsage().then(setU);
    window.addEventListener('usage-updated', h);
    return () => window.removeEventListener('usage-updated', h);
  }, []);

  if (!u) return null;
  const unlimited = u.ai_limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((u.ai_used / Math.max(1, u.ai_limit)) * 100));
  const atLimit = !unlimited && u.ai_used >= u.ai_limit;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white text-sm font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" />{t('Analiza AI këtë muaj')}</span>
        <span className="text-[11px] text-gray-400 flex items-center gap-1"><Crown className="w-3.5 h-3.5 text-amber-400" />{t('Plani')}: <span className="text-amber-400 font-semibold capitalize">{u.plan}</span></span>
      </div>
      {unlimited ? (
        <div className="text-sm text-green-400 font-semibold">{t('{used} analiza · pa limit', { used: u.ai_used })}</div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className={atLimit ? 'text-red-400 font-semibold' : 'text-gray-300'}>{t('{used} nga {limit}', { used: u.ai_used, limit: u.ai_limit })}</span>
            {atLimit && <span className="text-red-400">{t('Limiti u arrit — përmirëso planin')}</span>}
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${atLimit ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-purple-500'}`} style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
