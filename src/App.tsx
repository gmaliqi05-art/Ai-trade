import { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import ScreenshotShield from './components/ScreenshotShield';
import { LanguageProvider } from './i18n/i18n';
import AuthPage from './pages/AuthPage';
import AccountVerifyGate from './pages/AccountVerifyGate';
import SubscriptionGate from './pages/SubscriptionGate';
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
import TelegramSinPage from './pages/TelegramSinPage';
import JournalPage from './pages/JournalPage';
import SupportPage from './pages/SupportPage';
import LegalPage from './pages/LegalPage';
import OperatorGoldSniperPage from './pages/OperatorGoldSniperPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { supabase } from './lib/supabase';

import AdminOverviewPage from './admin/AdminOverviewPage';
import AdminSettingsPage from './admin/AdminSettingsPage';
import AdminMetaTraderPage from './admin/AdminMetaTraderPage';
import AdminCostPage from './admin/AdminCostPage';
import AdminHowItWorksPage from './admin/AdminHowItWorksPage';
import AdminProTradeLabPage from './admin/AdminProTradeLabPage';
import AdminExpertRoomPage from './admin/AdminExpertRoomPage';
import AdminVipCodesPage from './admin/AdminVipCodesPage';
import AdminGoldSniperPage from './admin/AdminGoldSniperPage';
import AdminSupportPage from './admin/AdminSupportPage';
import AdminPaymentsPage from './admin/AdminPaymentsPage';
import AdminPlansPage from './admin/AdminPlansPage';
import AdminEmailPage from './admin/AdminEmailPage';
import AdminPage from './pages/AdminPage';

export type ClientPage =
  | 'dashboard' | 'market_prices' | 'demo_trading' | 'chart_analysis'
  | 'signals' | 'protrade' | 'metatrader' | 'mmt' | 'telegram_sin' | 'journal' | 'support' | 'notifications' | 'reports' | 'settings' | 'manual' | 'gsfx';

export type AdminPage =
  | 'admin_overview' | 'admin_users' | 'admin_signals'
  | 'admin_trades' | 'admin_ai' | 'admin_cost' | 'admin_broadcast' | 'admin_metatrader'
  | 'admin_howitworks' | 'admin_protrade_lab' | 'admin_expert_room' | 'admin_vip_codes' | 'admin_goldsniper' | 'admin_support' | 'admin_payments' | 'admin_plans' | 'admin_email' | 'admin_audit' | 'admin_settings';

export type Page = ClientPage | AdminPage;

const CLIENT_PAGES: ClientPage[] = ['dashboard', 'market_prices', 'demo_trading', 'chart_analysis', 'signals', 'protrade', 'metatrader', 'mmt', 'telegram_sin', 'journal', 'support', 'notifications', 'reports', 'settings', 'manual', 'gsfx'];
const ADMIN_PAGES: AdminPage[] = ['admin_overview', 'admin_users', 'admin_signals', 'admin_trades', 'admin_ai', 'admin_cost', 'admin_broadcast', 'admin_metatrader', 'admin_howitworks', 'admin_protrade_lab', 'admin_expert_room', 'admin_vip_codes', 'admin_goldsniper', 'admin_support', 'admin_payments', 'admin_plans', 'admin_email', 'admin_audit', 'admin_settings'];

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
      {currentPage === 'admin_signals' && <AdminPageTab tab="signals" />}
      {currentPage === 'admin_audit' && <AdminPageTab tab="audit" />}
      {currentPage === 'admin_trades' && <AdminPageTab tab="trades" />}
      {currentPage === 'admin_ai' && <AdminPageTab tab="ai_providers" />}
      {currentPage === 'admin_cost' && <AdminCostPage />}
      {currentPage === 'admin_broadcast' && <AdminPageTab tab="notifications" />}
      {currentPage === 'admin_metatrader' && <AdminMetaTraderPage />}
      {currentPage === 'admin_howitworks' && <AdminHowItWorksPage />}
      {currentPage === 'admin_protrade_lab' && <AdminProTradeLabPage />}
      {currentPage === 'admin_expert_room' && <AdminExpertRoomPage />}
      {currentPage === 'admin_vip_codes' && <AdminVipCodesPage />}
      {currentPage === 'admin_goldsniper' && <AdminGoldSniperPage />}
      {currentPage === 'admin_support' && <AdminSupportPage />}
      {currentPage === 'admin_payments' && <AdminPaymentsPage />}
      {currentPage === 'admin_plans' && <AdminPlansPage />}
      {currentPage === 'admin_email' && <AdminEmailPage />}
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
      {currentPage === 'telegram_sin' && <TelegramSinPage onNavigate={setCurrentPage} />}
      {currentPage === 'journal' && <JournalPage />}
      {currentPage === 'support' && <SupportPage />}
      {currentPage === 'notifications' && <NotificationsPage />}
      {currentPage === 'reports' && <ReportsPage />}
      {currentPage === 'settings' && <SettingsPage />}
      {currentPage === 'manual' && <ClientManualPage onNavigate={setCurrentPage} />}
      {/* Konsola GoldSniperFX për operatorin (partneri teknik) — hapet me kod, roli vjen nga serveri. */}
      {currentPage === 'gsfx' && <OperatorGoldSniperPage />}
    </ClientLayout>
  );
}

function AppContent() {
  const { user, loading, profile } = useAuth();

  // POLITIKAT LIGJORE — hapen me #legal nga kudo (footer, regjistrimi), edhe pa llogari.
  const [showLegal, setShowLegal] = useState(() => window.location.hash === '#legal');
  useEffect(() => {
    const f = () => setShowLegal(window.location.hash === '#legal');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  if (showLegal) return <LegalPage />;

  // RIVENDOSJA E FJALËKALIMIT — përdoruesi vjen nga lidhja e email-it. Supabase e njeh vetë
  // tokenin te adresa dhe lëshon ngjarjen PASSWORD_RECOVERY; kontrollojmë edhe hash-in, sepse
  // ngjarja mund të ketë kaluar para se ky komponent të montohej.
  const [recovery, setRecovery] = useState(() => {
    const h = window.location.hash || '';
    return h.includes('type=recovery') || h === '#reset';
  });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (recovery) {
    return <ResetPasswordPage onDone={() => {
      // Pastro adresën dhe dil nga sesioni i rikuperimit → ekrani i hyrjes.
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* injoro */ }
      setRecovery(false);
      supabase.auth.signOut();
    }} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center animate-pulse">
            <svg className="w-7 h-7 text-gray-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="text-gray-400 text-sm">Loading GoldSniperFX…</div>
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

  // ABONIMI: pas "Krijo llogari" (ose kur abonimi skadon/anulohet) → tabela e planeve me Stripe.
  // Përdoruesit e vjetër janë 'active' (grandfathered) → s'preken.
  if (profile && ['none', 'expired', 'canceled'].includes(profile.subscription_status ?? '')) {
    return <SubscriptionGate />;
  }

  // VERIFIKIM: përdoruesi i kyçur por i PAVERIFIKUAR (regjistrim i ri) → ekrani i kodit 6-shifror.
  // Vetëm kur profili u ngarkua dhe is_verified është SHPREHIMISHT false (mos blloko nëse s'lexohet dot profili).
  if (profile && profile.is_verified === false) {
    return <AccountVerifyGate />;
  }

  return <ClientApp />;
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        {/* Mburoja kundër screenshot-eve — aktive për çdo përdorues të kyçur, përveç të përjashtuarve. */}
        <ScreenshotShield />
        <AppContent />
        <Analytics />
      </AuthProvider>
    </LanguageProvider>
  );
}
