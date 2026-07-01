import { Monitor, Clock } from 'lucide-react';
import MetaApiPanel from '../components/MetaApiPanel';
import { useI18n } from '../i18n/i18n';

// Faqja e integrimit MetaTrader për klientin.
// Përdor vetëm MetaApi.cloud (auto-trade në cloud, punon edhe me celular).
// Metoda e vjetër me Expert Advisor (MT5 desktop) u hoq — nuk nevojitet.
export default function MetaTraderPage() {
  const { t } = useI18n();
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Monitor className="w-6 h-6 text-amber-400" />{t('Lidhja & Konfigurimi')}
        </h2>
        <p className="text-gray-400 text-sm mt-1" dangerouslySetInnerHTML={{ __html: t('Lidh dhe konfiguro llogarinë MT5 (Vantage) + mbrojtjen e rrezikut. Tregtimi bëhet te <strong class="text-amber-400">Tregto Live</strong>.') }} />
      </div>

      {/* Njoftim për orarin e tregut (i zhvendosur nga "Tregto Live" që të mos zërë hapësirë atje). */}
      <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <span>{t('Tregu i arit (Hën–Pre) ka një pauzë ditore rreth orës 23:00–00:00. 1 orë para mbylljes roboti NUK hap trade automatik — sinjalet vijnë vetëm për tregti manuale (klik mbi sinjal për ta hapur formën).')}</span>
      </div>

      {/* Auto-trade në cloud via MetaApi (punon edhe me celular) */}
      <MetaApiPanel />
    </div>
  );
}
