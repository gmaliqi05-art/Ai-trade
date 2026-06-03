import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import AdminLayout from './components/AdminLayout';
import ClientLayout from './components/ClientLayout';

import DashboardPage from './pages/DashboardPage';
import MarketTerminalPage from './pages/MarketTerminalPage';
import AIAnalysisPage from './pages/AIAnalysisPage';
import ChartAnalysisPage from './pages/ChartAnalysisPage';
import SignalsPage from './pages/SignalsPage';
import MetaTraderPage from './pages/MetaTraderPage';
import LiveMarketPage from './pages/LiveMarketPage';
import NotificationsPage from './pages/NotificationsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

import AdminOverviewPage from './admin/AdminOverviewPage';
import AdminSettingsPage from './admin/AdminSettingsPage';
import AdminMetaTraderPage from './admin/AdminMetaTraderPage';
import AdminPage from './pages/AdminPage';

export type ClientPage =
  | 'dashboard' | 'market_prices' | 'ai' | 'chart_analysis'
  | 'signals' | 'trading' | 'metatrader' | 'live_market' | 'notifications' | 'reports' | 'settings';

export type AdminPage =
  | 'admin_overview' | 'admin_users' | 'admin_assets' | 'admin_signals'
  | 'admin_trades' | 'admin_ai' | 'admin_broadcast' | 'admin_metatrader'
  | 'admin_audit' | 'admin_settings';

export type Page = ClientPage | AdminPage;

function AdminApp() {
  const [currentPage, setCurrentPage] = useState<AdminPage>('admin_overview');

  return (
    <AdminLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'admin_overview' && <AdminOverviewPage onNavigate={setCurrentPage} />}
      {currentPage === 'admin_users' && <AdminPageTab tab="users" />}
      {currentPage === 'admin_assets' && <AdminPageTab tab="assets" />}
      {currentPage === 'admin_signals' && <AdminPageTab tab="signals" />}
      {currentPage === 'admin_trades' && <AdminPageTab tab="trades" />}
      {currentPage === 'admin_ai' && <AdminPageTab tab="ai_providers" />}
      {currentPage === 'admin_broadcast' && <AdminPageTab tab="notifications" />}
      {currentPage === 'admin_metatrader' && <AdminMetaTraderPage />}
      {currentPage === 'admin_audit' && <AdminPageTab tab="audit" />}
      {currentPage === 'admin_settings' && <AdminSettingsPage />}
    </AdminLayout>
  );
}

function AdminPageTab({ tab }: { tab: string }) {
  return <AdminPage forcedTab={tab} />;
}

function ClientApp() {
  const [currentPage, setCurrentPage] = useState<ClientPage>('dashboard');

  return (
    <ClientLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'dashboard' && <DashboardPage onNavigate={setCurrentPage} />}
      {(currentPage === 'market_prices' || currentPage === 'trading') && <MarketTerminalPage onNavigate={setCurrentPage} />}
      {currentPage === 'ai' && <AIAnalysisPage />}
      {currentPage === 'chart_analysis' && <ChartAnalysisPage />}
      {currentPage === 'signals' && <SignalsPage />}
      {currentPage === 'metatrader' && <MetaTraderPage />}
      {currentPage === 'live_market' && <LiveMarketPage />}
      {currentPage === 'notifications' && <NotificationsPage />}
      {currentPage === 'reports' && <ReportsPage />}
      {currentPage === 'settings' && <SettingsPage />}
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
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
