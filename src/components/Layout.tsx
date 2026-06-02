import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, LayoutDashboard, BarChart3, Briefcase, Brain, Bell, Settings, LogOut, ChevronLeft, Menu, X, User, Zap, Shield, Monitor, FileText, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Page } from '../App';

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: React.ReactNode;
  isAdmin?: boolean;
}

const mainNavItems = [
  { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trading' as Page, label: 'Markets', icon: BarChart3 },
  { id: 'portfolio' as Page, label: 'Portfolio', icon: Briefcase },
];

const analysisNavItems = [
  { id: 'chart_analysis' as Page, label: 'Chart Analysis', icon: Upload },
  { id: 'ai' as Page, label: 'AI Analysis', icon: Brain },
  { id: 'signals' as Page, label: 'Signals', icon: Zap },
  { id: 'metatrader' as Page, label: 'MetaTrader', icon: Monitor },
];

const accountNavItems = [
  { id: 'notifications' as Page, label: 'Notifications', icon: Bell },
  { id: 'reports' as Page, label: 'Reports', icon: FileText },
  { id: 'settings' as Page, label: 'Settings', icon: Settings },
];

const adminNavItem = { id: 'admin' as Page, label: 'Super Admin', icon: Shield };

const allLabels: Record<Page, string> = {
  dashboard: 'Dashboard',
  trading: 'Markets',
  portfolio: 'Portfolio',
  ai: 'AI Analysis',
  chart_analysis: 'Chart Analysis',
  signals: 'Signals',
  metatrader: 'MetaTrader',
  notifications: 'Notifications',
  reports: 'Reports',
  settings: 'Settings',
  admin: 'Super Admin',
};

export default function Layout({ currentPage, onNavigate, children, isAdmin }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { profile, user, signOut } = useAuth();

  const fetchUnread = useCallback(async () => {
    if (!user) return;
    const { count } = await supabase.from('notifications')
      .select('id', { count: 'exact' })
      .or(`user_id.eq.${user.id},is_broadcast.eq.true`)
      .eq('is_read', false);
    setUnreadCount(count || 0);
  }, [user]);

  useEffect(() => { fetchUnread(); }, [fetchUnread, currentPage]);

  const NavItem = ({ item }: { item: { id: Page; label: string; icon: React.ElementType } }) => {
    const active = currentPage === item.id;
    const Icon = item.icon;
    const isAdminItem = item.id === 'admin';
    return (
      <button onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative ${
          active
            ? isAdminItem ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500 text-gray-950'
            : isAdminItem ? 'text-red-400/60 hover:bg-red-900/20 hover:text-red-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}>
        <Icon className="w-5 h-5 flex-shrink-0" />
        {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
        {active && !collapsed && !isAdminItem && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gray-950" />}
        {item.id === 'notifications' && unreadCount > 0 && (
          <span className={`${collapsed ? 'absolute -top-1 -right-1' : 'ml-auto'} bg-amber-500 text-gray-950 text-xs font-black w-4 h-4 rounded-full flex items-center justify-center text-[10px]`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  };

  const NavSection = ({ label, items }: { label: string; items: { id: Page; label: string; icon: React.ElementType }[] }) => (
    <div className="mb-2">
      {!collapsed && <div className="px-3 py-1 text-xs text-gray-600 font-medium tracking-wider uppercase mb-1">{label}</div>}
      <div className="space-y-0.5">
        {items.map(item => <NavItem key={item.id} item={item} />)}
      </div>
    </div>
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className={`flex items-center gap-3 p-4 mb-2 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-5 h-5 text-gray-950" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-white font-bold text-sm leading-none">GOLDTRADE</div>
            <div className="text-amber-400 text-xs font-medium tracking-widest">AI PLATFORM</div>
          </div>
        )}
      </div>
      <nav className="flex-1 px-2 overflow-y-auto">
        <NavSection label="Trading" items={mainNavItems} />
        <NavSection label="Analysis" items={analysisNavItems} />
        <NavSection label="Account" items={accountNavItems} />
        {isAdmin && (
          <div className="mt-2 pt-2 border-t border-gray-800">
            {!collapsed && <div className="px-3 py-1 text-xs text-gray-600 font-medium tracking-wider uppercase mb-1">Admin</div>}
            <NavItem item={adminNavItem} />
          </div>
        )}
      </nav>
      <div className="p-2 mt-2 border-t border-gray-800 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              {isAdmin ? <Shield className="w-4 h-4 text-amber-400" /> : <User className="w-4 h-4 text-amber-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{profile?.full_name || 'Trader'}</div>
              <div className="text-gray-500 text-xs capitalize flex items-center gap-1">
                {isAdmin && <Shield className="w-2.5 h-2.5 text-amber-400" />}
                {isAdmin ? 'Administrator' : (profile?.subscription_tier || 'free')}
              </div>
            </div>
          </div>
        )}
        <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-all">
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {mobileOpen && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside className={`fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800 z-50 transform transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        <SidebarContent />
      </aside>

      <aside className={`hidden lg:flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300 relative ${collapsed ? 'w-16' : 'w-56'}`}>
        <button onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-10 bg-gray-800 border border-gray-700 rounded-full p-1 text-gray-400 hover:text-white transition-colors">
          <ChevronLeft className={`w-3.5 h-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className={`h-14 border-b border-gray-800 flex items-center justify-between px-4 flex-shrink-0 ${currentPage === 'admin' ? 'bg-red-950/20' : 'bg-gray-900/50'}`}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden text-gray-400 hover:text-white"><Menu className="w-5 h-5" /></button>
            <h1 className={`font-semibold text-sm flex items-center gap-2 ${currentPage === 'admin' ? 'text-red-400' : 'text-white'}`}>
              {currentPage === 'admin' && <Shield className="w-4 h-4" />}
              {allLabels[currentPage] || 'Dashboard'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {profile?.balance !== undefined && currentPage !== 'admin' && (
              <div className="hidden sm:flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
                <span className="text-gray-400 text-xs">Balance:</span>
                <span className="text-amber-400 text-sm font-semibold">${profile.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <button onClick={() => onNavigate('notifications')} className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
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
