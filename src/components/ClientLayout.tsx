import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, LayoutDashboard,
  Bell, Settings, LogOut, ChevronLeft, Menu, X, User,
  Zap, Monitor, FileText, Activity, Upload, Sparkles, BookOpen, FlaskConical, Brain, Send, Crown, Loader2, CalendarDays
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { verifyVipCode, requestVip, lockVipAccess } from '../services/vipCodes';
import { supabase } from '../lib/supabase';
import { ClientPage } from '../App';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import { loadReadBroadcasts } from '../lib/broadcastReads';
import AppFooter from './AppFooter';

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
      { id: 'demo_trading' as ClientPage, label: 'Tregto Demo', icon: FlaskConical },
      { id: 'dashboard' as ClientPage, label: 'Paneli', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Analiza AI',
    items: [
      { id: 'protrade' as ClientPage, label: 'ProTrade Intelligence', icon: Sparkles },
      { id: 'signals' as ClientPage, label: 'Sinjalet', icon: Zap },
      { id: 'chart_analysis' as ClientPage, label: 'Analizë grafiku', icon: Upload },
    ],
  },
  {
    label: 'Tregtimi',
    items: [
      { id: 'metatrader' as ClientPage, label: 'Lidhja & Konfigurimi', icon: Monitor },
      { id: 'mmt' as ClientPage, label: 'MMT — Super Roboti', icon: Brain },
      { id: 'telegram_sin' as ClientPage, label: 'Konfigurimi i Sinjaleve', icon: Send },
      { id: 'journal' as ClientPage, label: 'Journal', icon: CalendarDays },
      { id: 'reports' as ClientPage, label: 'Raporte', icon: FileText },
    ],
  },
  {
    label: 'Llogaria',
    items: [
      { id: 'manual' as ClientPage, label: 'Manuali i përdorimit', icon: BookOpen },
      { id: 'notifications' as ClientPage, label: 'Njoftimet', icon: Bell },
      { id: 'settings' as ClientPage, label: 'Cilësimet', icon: Settings },
    ],
  },
];

// Shiriti i navigimit poshtë për celular/tablet (pamje si-app). E 5-ta ("Më shumë") hap menynë e plotë.
const bottomNavItems: { id: ClientPage; label: string; icon: React.ElementType }[] = [
  { id: 'market_prices', label: 'Tregto Live', icon: Activity },
  { id: 'telegram_sin', label: 'Sinjalet', icon: Send },
  { id: 'dashboard', label: 'Paneli', icon: LayoutDashboard },
  { id: 'manual', label: 'Manuali', icon: BookOpen },
];

// FAQET E LIRA (regjistrim normal): shfaqen gjithmonë në meny. Të tjerat (përfshirë Panelin/Dashboard)
// fshihen pas butonit VIP — kërkesa e pronarit (31 korrik 2026): Paneli vetëm për VIP.
const FREE_PAGES: ClientPage[] = ['market_prices', 'telegram_sin', 'journal', 'manual', 'settings'];
// Kodet VIP menaxhohen nga super admini dhe verifikohen NË SERVER (edge function 'vip-verify').
// Këtu ruhet vetëm gjendja e zhbllokimit lokal pas verifikimit të suksesshëm.
const VIP_STORAGE_KEY = 'gt_vip_unlocked';

const pageLabels: Record<ClientPage, string> = {
  dashboard: 'Paneli',
  market_prices: 'Tregto Live',
  demo_trading: 'Tregto Demo',
  chart_analysis: 'Analizë grafiku',
  signals: 'Sinjalet',
  protrade: 'ProTrade Intelligence',
  metatrader: 'Lidhja & Konfigurimi',
  mmt: 'MMT — Super Roboti',
  telegram_sin: 'Konfigurimi i Sinjaleve',
  journal: 'Journal',
  notifications: 'Njoftimet',
  reports: 'Raporte',
  settings: 'Cilësimet',
  manual: 'Manuali i përdorimit',
};

export default function ClientLayout({ currentPage, onNavigate, children }: ClientLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { profile, user, signOut } = useAuth();
  const { t } = useI18n();

  // BUTONI TELEGRAM — linku publik i kanalit GoldSniper|FX, i lexuar nga serveri
  // (funksioni 'goldsniper_channel_link'). Nëse s'ka kanal publik, butoni s'shfaqet fare.
  const [tgLink, setTgLink] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase.rpc('goldsniper_channel_link').then(({ data }) => {
      if (alive && typeof data === 'string' && data.startsWith('https://t.me/')) setTgLink(data);
    });
    return () => { alive = false; };
  }, [user]);

  // VIP: faqet e tjera (jo FREE_PAGES) fshihen derisa të futet kodi i saktë. Gjendja ruhet lokalisht.
  const [vipUnlocked, setVipUnlocked] = useState(() => {
    try { return localStorage.getItem(VIP_STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [vipOpen, setVipOpen] = useState(false);
  const [vipInput, setVipInput] = useState('');
  const [vipErr, setVipErr] = useState(false);
  const [vipBusy, setVipBusy] = useState(false);
  const submitVip = async () => {
    setVipBusy(true); setVipErr(false);
    const ok = await verifyVipCode(vipInput.trim());
    setVipBusy(false);
    if (ok) {
      setVipUnlocked(true); setVipErr(false); setVipOpen(false); setVipInput('');
      try { localStorage.setItem(VIP_STORAGE_KEY, '1'); } catch { /* */ }
    } else { setVipErr(true); }
  };
  const lockVip = () => {
    // Mbyllje REALE: hiqet edhe në server (is_vip=false kur burimi është 'code') — rihyrja
    // kërkon sërish kodin. Pa këtë, refresh-i e rihapte vetë qasjen nga profiles.is_vip.
    lockVipAccess();
    setVipUnlocked(false);
    try { localStorage.removeItem(VIP_STORAGE_KEY); } catch { /* */ }
  };
  // Kërkesa për abonim VIP → i shkon Adminit (vip_requests).
  const [vipReqBusy, setVipReqBusy] = useState(false);
  const [vipReqMsg, setVipReqMsg] = useState('');
  const sendVipRequest = async () => {
    setVipReqBusy(true); setVipReqMsg('');
    const r = await requestVip();
    setVipReqBusy(false);
    if (r.already_vip) setVipReqMsg(t('Je tashmë VIP.'));
    else if (r.ok) setVipReqMsg(r.pending ? t('Kërkesa është dërguar — pritet aprovimi nga Admini.') : t('Kërkesa u dërgua! Admini do ta shqyrtojë.'));
    else setVipReqMsg(t('Dështoi dërgimi. Provo sërish.'));
  };
  // BURIMI I VËRTETË I QASJES VIP është SERVERI (profiles.is_vip + vip_source), jo localStorage:
  //  - admin ose VIP nga admini ('admin') → hapet VETË, pa kod;
  //  - VIP me kod ('code') → mbetet siç e ka lënë përdoruesi në KËTË pajisje (hapur me kodin e vet);
  //  - JO VIP → mbyllet ME FORCË (pastron edhe gjurmën localStorage) — kështu një qasje e vjetër
  //    e marrë me kodin e dikujt tjetër NUK rikthehet më në refresh.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase.from('profiles').select('is_vip, is_admin, vip_source').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const p = data as { is_vip?: boolean; is_admin?: boolean; vip_source?: string | null } | null;
        if (!p) return; // profili s'u lexua dot — mos ndrysho asgjë
        if (p.is_admin || (p.is_vip && p.vip_source === 'admin')) {
          setVipUnlocked(true);
          try { localStorage.setItem(VIP_STORAGE_KEY, '1'); } catch { /* */ }
        } else if (!p.is_vip) {
          setVipUnlocked(false);
          try { localStorage.removeItem(VIP_STORAGE_KEY); } catch { /* */ }
        }
        // is_vip && vip_source==='code' → lëre gjendjen lokale siç është (e hapur me kodin e vet).
      });
    return () => { alive = false; };
  }, [user]);

  const fetchUnread = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, is_broadcast')
      .or(`user_id.eq.${user.id},is_broadcast.eq.true`)
      .eq('is_read', false);
    // Përjashto broadcast-et që përdoruesi i ka lexuar (server-side + cache lokal).
    const readSet = await loadReadBroadcasts(user.id);
    const rows = (data as { id: string; is_broadcast: boolean }[] | null) || [];
    setUnreadCount(rows.filter(r => !(r.is_broadcast && readSet.has(r.id))).length);
  }, [user]);

  useEffect(() => { fetchUnread(); }, [fetchUnread, currentPage]);

  // Mbrojtje: nëse qasja VIP s'është e hapur dhe përdoruesi ndodhet në një faqe VIP, ktheje te Trade Live.
  // Njoftimet lejohen gjithmonë (hapen nga zilja në krye — feature sistemi, jo faqe menuje).
  useEffect(() => {
    if (!vipUnlocked && currentPage !== 'notifications' && !FREE_PAGES.includes(currentPage)) {
      onNavigate('market_prices');
    }
  }, [vipUnlocked, currentPage, onNavigate]);

  // Rifresko numrin sapo njoftimet ndryshojnë (klik "lexuar", "lexo të gjitha", fshirje).
  useEffect(() => {
    const h = () => fetchUnread();
    window.addEventListener('notifications-updated', h);
    return () => window.removeEventListener('notifications-updated', h);
  }, [fetchUnread]);

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
        {/* FAQET E LIRA — gjithmonë të dukshme (Trade Live, Paneli, Telegram Sin, Manual, Cilësimet). */}
        {navSections.map(section => {
          const freeItems = section.items.filter(it => FREE_PAGES.includes(it.id));
          if (freeItems.length === 0) return null;
          return (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <div className="px-3 mb-1 text-[10px] text-gray-600 font-semibold tracking-[0.15em] uppercase">{t(section.label)}</div>
              )}
              <div className="space-y-0.5">
                {freeItems.map(item => <NavItem key={item.id} item={item} />)}
              </div>
            </div>
          );
        })}

        {/* BUTONI TELEGRAM — hap kanalin tonë të sinjaleve në Telegram (t.me). Linku vjen nga
            serveri dhe ndjek vetë kanalin nëse Admini e ndryshon te konsola GoldSniperFX. */}
        {tgLink && (
          <div className="mb-4">
            {!collapsed && <div className="px-3 mb-1 text-[10px] text-sky-600 font-semibold tracking-[0.15em] uppercase">Telegram</div>}
            <a href={tgLink} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}
              title={t('Bashkohu me kanalin tonë të sinjaleve në Telegram')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-500/15 to-sky-600/10 border border-sky-500/30 text-sky-300 hover:from-sky-500/25 transition-all">
              <Send className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-semibold truncate">{t('Kanali në Telegram')}</span>}
            </a>
          </div>
        )}

        {/* BUTONI VIP — hap faqet e tjera me kod. I dukshëm gjithmonë; hapet me kod, pastaj mbahet mend. */}
        <div className="mb-4">
          {!collapsed && <div className="px-3 mb-1 text-[10px] text-amber-600 font-semibold tracking-[0.15em] uppercase">VIP</div>}
          {!vipUnlocked ? (
            <>
              <button onClick={() => { setVipOpen(o => !o); setVipErr(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/15 to-amber-600/10 border border-amber-500/30 text-amber-300 hover:from-amber-500/25 transition-all">
                <Crown className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-semibold truncate">{t('VIP — Fut kodin')}</span>}
              </button>
              {vipOpen && !collapsed && (
                <div className="mt-2 px-1 space-y-2">
                  <input type="password" value={vipInput} autoFocus
                    onChange={e => { setVipInput(e.target.value); setVipErr(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') submitVip(); }}
                    placeholder={t('Kodi VIP')}
                    className={`w-full bg-black/30 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${vipErr ? 'border-red-500' : 'border-amber-500/40 focus:border-amber-500'}`} />
                  {vipErr && <p className="text-[11px] text-red-400 px-1">{t('Kod i pasaktë.')}</p>}
                  <button onClick={submitVip} disabled={vipBusy} className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
                    {vipBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t('Hap qasjen VIP')}
                  </button>
                  {/* Nuk ke kod? Dërgo kërkesë te Admini për abonim VIP. */}
                  <div className="pt-2 border-t border-amber-500/15">
                    <p className="text-[10px] text-gray-500 mb-1.5 px-1">{t('Nuk ke kod? Kërko abonimin VIP nga Admini.')}</p>
                    <button onClick={sendVipRequest} disabled={vipReqBusy}
                      className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
                      {vipReqBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<Crown className="w-3.5 h-3.5" />{t('Dërgo kërkesën për abonim VIP')}
                    </button>
                    {vipReqMsg && <p className="text-[11px] text-emerald-400 mt-1.5 px-1">{vipReqMsg}</p>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {navSections.map(section => {
                const vipItems = section.items.filter(it => !FREE_PAGES.includes(it.id));
                if (vipItems.length === 0) return null;
                return (
                  <div key={section.label} className="mb-2">
                    {!collapsed && (
                      <div className="px-3 mb-1 text-[10px] text-gray-600 font-semibold tracking-[0.15em] uppercase">{t(section.label)}</div>
                    )}
                    <div className="space-y-0.5">
                      {vipItems.map(item => <NavItem key={item.id} item={item} />)}
                    </div>
                  </div>
                );
              })}
              <button onClick={lockVip}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-gray-500 hover:bg-gray-800 hover:text-amber-400 transition-all mt-1">
                <Crown className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="text-xs font-medium truncate">{t('Mbyll qasjen VIP')}</span>}
              </button>
            </>
          )}
        </div>
      </nav>

      <div className="p-2 border-t border-gray-800 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            {/* Foto e profilit (nëse është ngarkuar) — ndryshe ikona. */}
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-amber-500/20 flex items-center justify-center">
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                : <User className="w-4 h-4 text-amber-400" />}
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

      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800 z-50 transform transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 text-gray-400 hover:text-white" style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}>
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
        <header
          className="bg-gray-900/50 border-b border-gray-800 flex items-center justify-between px-4 flex-shrink-0 h-14"
          style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(3.5rem + env(safe-area-inset-top))' }}
        >
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

        {/* Content — hapësirë poshtë në celular që të mos mbulohet nga shiriti i navigimit. */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">{children}<AppFooter /></main>

        {/* Shiriti i navigimit poshtë (vetëm celular/tablet) — pamje si-app. */}
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur border-t border-gray-800 flex items-stretch"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {bottomNavItems.filter(item => vipUnlocked || FREE_PAGES.includes(item.id)).map(item => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${active ? 'text-amber-400' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{t(item.label)}</span>
              </button>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-gray-500 hover:text-gray-300 transition-colors relative"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">{t('Më shumë')}</span>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1/2 translate-x-4 w-1.5 h-1.5 bg-amber-500 rounded-full" />
            )}
          </button>
        </nav>
      </div>
    </div>
  );
}
