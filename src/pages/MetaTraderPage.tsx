import { Monitor } from 'lucide-react';
import MetaApiPanel from '../components/MetaApiPanel';

// Faqja e integrimit MetaTrader për klientin.
// Përdor vetëm MetaApi.cloud (auto-trade në cloud, punon edhe me celular).
// Metoda e vjetër me Expert Advisor (MT5 desktop) u hoq — nuk nevojitet.
export default function MetaTraderPage() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Monitor className="w-6 h-6 text-amber-400" />MetaTrader / Auto-Trade
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Lidh llogarinë tënde MT5 (Vantage) përmes MetaApi për ekzekutim automatik me mbrojtje rreziku.
        </p>
      </div>

      {/* Auto-trade në cloud via MetaApi (punon edhe me celular) */}
      <MetaApiPanel />
    </div>
  );
}
