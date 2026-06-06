import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, LayoutDashboard, Users, BarChart2, Zap, Activity,
  Brain, Megaphone, Shield, LogOut, ChevronLeft, Menu, X,
  Bell, Settings, Monitor, ChevronDown, Coins, BookOpen
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { AdminPage } from '../App';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import AppFooter from './AppFooter';

interface AdminLayoutProps {
  currentPage: AdminPage;
  onNavigate: (page: AdminPage) => void;
  children: React.ReactNode;
}

const navItems: { id: AdminPage; label: string; icon: React.ElementType; section: string }[] = [
  { id: 'admin_overview', label: 'Përmbledhje', icon: LayoutDashboard, section: 'Paneli' },
  { id: 'admin_users', label: 'Përdoruesit', icon: Users, section: 'Menaxhimi' },
  { id: 'admin_assets', label: 'Aktivet & tregjet', icon: BarChart2, section: 'Menaxhimi' },
  { id: 'admin_signals', label: 'Sinjalet', icon: Zap, section: 'Menaxhimi' },
  { id: 'admin_trades', label: 'Tregtitë', icon: Activity, section: 'Menaxhimi' },
  { id: 'admin_ai', label: 'AI Providers', icon: Brain, section: 'Platforma' },
  { id: 'admin_cost', label: 'Kostot & API', icon: Coins, section: 'Platforma' },
  { id: 'admin_broadcast', label: 'Broadcast', icon: Megaphone, section: 'Platforma' },
  { id: 'admin_metatrader', label: 'MetaTrader', icon: Monitor, section: 'Platforma' },
  { id: 'admin_audit', label: 'Regjistri i auditit', icon: Shield, section: 'Siguria' },
  { id: 'admin_howitworks', label: 'Si funksionon', icon: BookOpen, section: 'Siguria' },
  { id: 'admin_settings', label: 'Cilësimet', icon: Settings, section: 'Siguria' },
];

const pageLabels: Record<AdminPage, string> = {
  admin_overview: 'Përmbledhja e platformës',
  admin_users: 'Menaxhimi i përdoruesve',
  admin_assets: 'Aktivet & tregjet',
  admin_signals: 'Menaxhimi i sinjaleve',
  admin_trades: 'Monitorimi i tregtive',
  admin_ai: 'AI Providers',
  admin_cost: 'Kostot & përdorimi (API)',
  admin_broadcast: 'Broadcast',
  admin_metatrader: 'Lidhjet MetaTrader',
  admin_audit: 'Regjistri i auditit',
  admin_howitworks: 'Si funksionon sistemi',
  admin_settings: 'Cilësimet e platformës',
};

export default function AdminLayout({ currentPage, onNavigate, children }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
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

  const sections = ['Paneli', 'Menaxhimi', 'Platforma', 'Siguria'];

  const NavItem = ({ item }: { item: typeof navItems[0] }) => {
    const active = currentPage === item.id;
    const Icon = item.icon;
    return (
      <button
        onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
          active
            ? 'bg-gradient-to-r from-red-500/20 to-orange-500/10 text-red-300 border border-red-500/30'
            : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${active ? 'text-red-400' : 'text-gray-600 group-hover:text-gray-400'}`} />
        {!collapsed && <span className="text-sm font-medium truncate">{t(item.label)}</span>}
        {active && !collapsed && <div className="ml-auto w-1 h-1 rounded-full bg-red-400" />}
      </button>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className={`flex items-center gap-3 p-4 mb-1 flex-shrink-0 border-b border-gray-800/50 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-red-500/20">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-white font-bold text-sm leading-none tracking-wide">GOLDTRADE</div>
            <div className="text-red-400 text-[10px] font-semibold tracking-[0.2em] uppercase mt-0.5">Super Admin</div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-4">
        {sections.map(section => {
          const items = navItems.filter(n => n.section === section);
          return (
            <div key={section}>
              {!collapsed && (
                <div className="px-3 mb-1 text-[10px] text-gray-600 font-semibold tracking-[0.15em] uppercase">{t(section)}</div>
              )}
              <div className="space-y-0.5">
                {items.map(item => <NavItem key={item.id} item={item} />)}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-2 border-t border-gray-800/50 flex-shrink-0">
        <div className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/60 transition-all group"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-red-500/30 to-orange-500/20 rounded-full flex items-center justify-center flex-shrink-0 border border-red-500/30">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-white text-xs font-semibold truncate">{profile?.full_name || 'Admin'}</div>
                  <div className="text-red-400 text-[10px] font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                    Super Admin
                  </div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-600 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
          {profileOpen && !collapsed && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-all text-sm"
              >
                <LogOut className="w-4 h-4" />
                {t('Dil')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#0a0a0f] overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/70 z-40 lg:hidden backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800/50 z-50 transform transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 text-gray-400 hover:text-white p-1">
          <X className="w-5 h-5" />
        </button>
        <SidebarContent />
      </aside>

      <aside className={`hidden lg:flex flex-col bg-gray-900 border-r border-gray-800/50 transition-all duration-300 relative ${collapsed ? 'w-16' : 'w-60'}`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-10 bg-gray-800 border border-gray-700 rounded-full p-1 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className={`w-3.5 h-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-gray-900/80 border-b border-gray-800/50 backdrop-blur-sm flex items-center justify-between px-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden text-gray-400 hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-gradient-to-b from-red-500 to-orange-500 rounded-full" />
              <h1 className="font-semibold text-sm text-white">
                {t(pageLabels[currentPage])}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <div className="hidden sm:flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
              <Shield className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400 text-xs font-semibold">{t('Administrator')}</span>{/* badge */}
            </div>
            <button className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#0a0a0f]">
          {children}
          <AppFooter />
        </main>
      </div>
    </div>
  );
}
