import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, LayoutDashboard,
  Bell, Settings, LogOut, ChevronLeft, Menu, X, User,
  Zap, Monitor, FileText, Activity, Upload
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ClientPage } from '../App';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

interface ClientLayoutProps {
  currentPage: ClientPage;
  onNavigate: (page: ClientPage) => void;
  children: React.ReactNode;
}

const navSections = [
  {
    label: 'Kryesore',
    items: [
      { id: 'market_prices' as ClientPage, label: 'Tregto Live', icon: Activity },
      { id: 'dashboard' as ClientPage, label: 'Paneli', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Analiza AI',
    items: [
      { id: 'signals' as ClientPage, label: 'Sinjalet', icon: Zap },
      { id: 'chart_analysis' as ClientPage, label: 'Analizë grafiku', icon: Upload },
    ],
  },
  {
    label: 'Tregtimi',
    items: [
      { id: 'metatrader' as ClientPage, label: 'Lidhja & Konfigurimi', icon: Monitor },
      { id: 'reports' as ClientPage, label: 'Raporte', icon: FileText },
    ],
  },
  {
    label: 'Llogaria',
    items: [
      { id: 'notifications' as ClientPage, label: 'Njoftimet', icon: Bell },
      { id: 'settings' as ClientPage, label: 'Cilësimet', icon: Settings },
    ],
  },
];

const pageLabels: Record<ClientPage, string> = {
  dashboard: 'Paneli',
  market_prices: 'Tregto Live',
  chart_analysis: 'Analizë grafiku',
  signals: 'Sinjalet',
  metatrader: 'Lidhja & Konfigurimi',
  notifications: 'Njoftimet',
  reports: 'Raporte',
  settings: 'Cilësimet',
};

export default function ClientLayout({ currentPage, onNavigate, children }: ClientLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { profile, user, signOut } = useAuth();
  const { t } = useI18n();

  const fetchUnread = useCallback(async () => {
    if (!user) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact' })
      .or(`user_id.eq.${user.id},is_broadcast.eq.true`)
      .eq('is_read', false);
    setUnreadCount(count || 0);
  }, [user]);

  useEffect(() => { fetchUnread(); }, [fetchUnread, currentPage]);

  const NavItem = ({ item }: { item: { id: ClientPage; label: string; icon: React.ElementType } }) => {
    const active = currentPage === item.id;
    const Icon = item.icon;
    return (
      <button
        onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative ${
          active
            ? 'bg-amber-500 text-gray-950'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {!collapsed && <span className="text-sm font-medium truncate">{t(item.label)}</span>}
        {active && !collapsed && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gray-950 opacity-60" />}
        {item.id === 'notifications' && unreadCount > 0 && (
          <span className={`${collapsed ? 'absolute -top-1 -right-1' : 'ml-auto'} bg-amber-500 text-gray-950 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className={`flex items-center gap-3 p-4 mb-1 flex-shrink-0 border-b border-gray-800 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-5 h-5 text-gray-950" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-white font-bold text-sm leading-none">GOLDTRADE</div>
            <div className="text-amber-400 text-[10px] font-semibold tracking-[0.2em] uppercase mt-0.5">{t('Sinjale AI')}</div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {navSections.map(section => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <div className="px-3 mb-1 text-[10px] text-gray-600 font-semibold tracking-[0.15em] uppercase">{t(section.label)}</div>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => <NavItem key={item.id} item={item} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-2 border-t border-gray-800 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{profile?.full_name || 'Trader'}</div>
              <div className="text-gray-500 text-[10px] capitalize">{t('Plani {tier}', { tier: profile?.subscription_tier || 'free' })}</div>
            </div>
          </div>
        )}
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-all"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">{t('Dil')}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800 z-50 transform transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <SidebarContent />
      </aside>

      <aside className={`hidden lg:flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300 relative ${collapsed ? 'w-16' : 'w-56'}`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-10 bg-gray-800 border border-gray-700 rounded-full p-1 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className={`w-3.5 h-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-gray-900/50 border-b border-gray-800 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden text-gray-400 hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-semibold text-sm text-white">{t(pageLabels[currentPage] || currentPage)}</h1>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button
              onClick={() => onNavigate('notifications')}
              className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-amber-500 text-gray-950 text-[10px] font-black rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
