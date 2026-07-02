import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './i18n/i18n';
import AuthPage from './pages/AuthPage';
import AdminLayout from './components/AdminLayout';
import ClientLayout from './components/ClientLayout';

import DashboardPage from './pages/DashboardPage';
import MarketTerminalPage from './pages/MarketTerminalPage';
import DemoTradingPage from './pages/DemoTradingPage';
import ChartAnalysisPage from './pages/ChartAnalysisPage';
import SignalsPage from './pages/SignalsPage';
import MetaTraderPage from './pages/MetaTraderPage';
import NotificationsPage from './pages/NotificationsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import ProTradePage from './pages/ProTradePage';
import ClientManualPage from './pages/ClientManualPage';
import MmtPage from './pages/MmtPage';

import AdminOverviewPage from './admin/AdminOverviewPage';
import AdminSettingsPage from './admin/AdminSettingsPage';
import AdminMetaTraderPage from './admin/AdminMetaTraderPage';
import AdminCostPage from './admin/AdminCostPage';
import AdminHowItWorksPage from './admin/AdminHowItWorksPage';
import AdminProTradeLabPage from './admin/AdminProTradeLabPage';
import AdminExpertRoomPage from './admin/AdminExpertRoomPage';
import AdminPage from './pages/AdminPage';

export type ClientPage =
  | 'dashboard' | 'market_prices' | 'demo_trading' | 'chart_analysis'
  | 'signals' | 'protrade' | 'metatrader' | 'mmt' | 'notifications' | 'reports' | 'settings' | 'manual';

export type AdminPage =
  | 'admin_overview' | 'admin_users' | 'admin_assets' | 'admin_signals'
  | 'admin_trades' | 'admin_ai' | 'admin_cost' | 'admin_broadcast' | 'admin_metatrader'
  | 'admin_howitworks' | 'admin_protrade_lab' | 'admin_expert_room' | 'admin_settings';

export type Page = ClientPage | AdminPage;

const CLIENT_PAGES: ClientPage[] = ['dashboard', 'market_prices', 'demo_trading', 'chart_analysis', 'signals', 'protrade', 'metatrader', 'mmt', 'notifications', 'reports', 'settings', 'manual'];
const ADMIN_PAGES: AdminPage[] = ['admin_overview', 'admin_users', 'admin_assets', 'admin_signals', 'admin_trades', 'admin_ai', 'admin_cost', 'admin_broadcast', 'admin_metatrader', 'admin_howitworks', 'admin_protrade_lab', 'admin_expert_room', 'admin_settings'];

// Mban faqen aktuale edhe pas rifreskimit të shfletuesit (ruhet në localStorage).
function usePersistedPage<T extends string>(storageKey: string, valid: T[], fallback: T): [T, (p: T) => void] {
  const [page, setPage] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey) as T | null;
      if (saved && valid.includes(saved)) return saved;
    } catch { /* injoro */ }
    return fallback;
  });
  const update = (p: T) => {
    try { localStorage.setItem(storageKey, p); } catch { /* injoro */ }
    setPage(p);
  };
  return [page, update];
}

function AdminApp() {
  const [currentPage, setCurrentPage] = usePersistedPage<AdminPage>('admin_current_page', ADMIN_PAGES, 'admin_overview');

  return (
    <AdminLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'admin_overview' && <AdminOverviewPage onNavigate={setCurrentPage} />}
      {currentPage === 'admin_users' && <AdminPageTab tab="users" />}
      {currentPage === 'admin_assets' && <AdminPageTab tab="assets" />}
      {currentPage === 'admin_signals' && <AdminPageTab tab="signals" />}
      {currentPage === 'admin_trades' && <AdminPageTab tab="trades" />}
      {currentPage === 'admin_ai' && <AdminPageTab tab="ai_providers" />}
      {currentPage === 'admin_cost' && <AdminCostPage />}
      {currentPage === 'admin_broadcast' && <AdminPageTab tab="notifications" />}
      {currentPage === 'admin_metatrader' && <AdminMetaTraderPage />}
      {currentPage === 'admin_howitworks' && <AdminHowItWorksPage />}
      {currentPage === 'admin_protrade_lab' && <AdminProTradeLabPage />}
      {currentPage === 'admin_expert_room' && <AdminExpertRoomPage />}
      {currentPage === 'admin_settings' && <AdminSettingsPage />}
    </AdminLayout>
  );
}

function AdminPageTab({ tab }: { tab: string }) {
  return <AdminPage forcedTab={tab} />;
}

function ClientApp() {
  const [currentPage, setCurrentPage] = usePersistedPage<ClientPage>('client_current_page', CLIENT_PAGES, 'market_prices');

  return (
    <ClientLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'dashboard' && <DashboardPage onNavigate={setCurrentPage} />}
      {currentPage === 'market_prices' && <MarketTerminalPage onNavigate={setCurrentPage} />}
      {currentPage === 'demo_trading' && <DemoTradingPage />}
      {currentPage === 'chart_analysis' && <ChartAnalysisPage />}
      {currentPage === 'signals' && <SignalsPage />}
      {currentPage === 'protrade' && <ProTradePage onNavigate={setCurrentPage} />}
      {currentPage === 'metatrader' && <MetaTraderPage />}
      {currentPage === 'mmt' && <MmtPage />}
      {currentPage === 'notifications' && <NotificationsPage />}
      {currentPage === 'reports' && <ReportsPage />}
      {currentPage === 'settings' && <SettingsPage />}
      {currentPage === 'manual' && <ClientManualPage onNavigate={setCurrentPage} />}
    </ClientLayout>
  );
}

function AppContent() {
  const { user, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center animate-pulse">
            <svg className="w-7 h-7 text-gray-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="text-gray-400 text-sm">Loading GOLDTRADE AI...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (profile?.is_admin) {
    return <AdminApp />;
  }

  return <ClientApp />;
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
