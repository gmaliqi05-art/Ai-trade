import { useState, useEffect, useCallback } from 'react';
import {
  Users, Activity, Zap, TrendingUp,
  ArrowUpRight, ArrowDownRight, RefreshCw,
  BarChart2, Shield, Brain, Cloud, Megaphone
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AdminPage } from '../App';
import { useI18n } from '../i18n/i18n';

interface RecentTrade {
  id: string; type: string; volume: number; status: string; executed_at: string;
  symbol: string | null; full_name: string | null;
}
interface Stats {
  totalUsers: number; proUsers: number; freeUsers: number; totalBalance: number;
  executions: number; executionsToday: number; activeSignals: number; totalAssets: number;
  autoTradeUsers: number; aiCostMonth: number; aiCallsMonth: number; metaCallsMonth: number;
  recentTrades: RecentTrade[];
}

const EMPTY: Stats = {
  totalUsers: 0, proUsers: 0, freeUsers: 0, totalBalance: 0, executions: 0, executionsToday: 0,
  activeSignals: 0, totalAssets: 0, autoTradeUsers: 0, aiCostMonth: 0, aiCallsMonth: 0, metaCallsMonth: 0, recentTrades: [],
};

export default function AdminOverviewPage({ onNavigate }: { onNavigate?: (p: AdminPage) => void }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_admin_stats');
    const s = (data as Partial<Stats>) || {};
    setStats({ ...EMPTY, ...s, recentTrades: (s.recentTrades as RecentTrade[]) || [] });
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');
  const fmtUsd = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: (n || 0) < 1 ? 4 : 2, maximumFractionDigits: 4 })}`;

  const statCards = [
    { label: t('Përdorues gjithsej'), value: fmt(stats.totalUsers), sub: t('të regjistruar'), icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    { label: t('Ekzekutime (MT5)'), value: fmt(stats.executions), sub: t('{n} sot', { n: stats.executionsToday }), icon: Activity, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    { label: t('Sinjale aktive'), value: fmt(stats.activeSignals), sub: t('{n} aktive të listuara', { n: stats.totalAssets }), icon: Zap, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    { label: t('Auto-Trade aktiv'), value: fmt(stats.autoTradeUsers), sub: t('Përdorues me MetaApi'), icon: Cloud, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    { label: t('Kosto AI (muaji)'), value: fmtUsd(stats.aiCostMonth), sub: t('{calls} thirrje sot', { calls: stats.aiCallsMonth }), icon: Brain, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
    { label: t('MetaApi (muaji)'), value: fmt(stats.metaCallsMonth), sub: t('thirrje gjithsej'), icon: Cloud, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  ];

  const quickLinks: { label: string; icon: React.ElementType; desc: string; page: AdminPage; color: string; bg: string; border: string }[] = [
    { label: t('Menaxho përdoruesit'), icon: Users, desc: t('Lejet & roli admin'), page: 'admin_users', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    { label: t('Aktivet & tregjet'), icon: BarChart2, desc: t('Çmime (vetëm pamje)'), page: 'admin_assets', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    { label: t('Sinjalet'), icon: Zap, desc: t('Krijo/menaxho sinjale'), page: 'admin_signals', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    { label: 'AI Providers', icon: Brain, desc: t('Çelësa API & prompt'), page: 'admin_ai', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    { label: 'Broadcast', icon: Megaphone, desc: t('Mesazh për të gjithë'), page: 'admin_broadcast', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    { label: 'Audit Log', icon: Shield, desc: t('Veprimet e adminit'), page: 'admin_audit', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-700' },
  ];

  return (
    <div className="p-5 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center"><TrendingUp className="w-4 h-4 text-white" /></div>
            {t('Përmbledhja e platformës')}
          </h2>
          <p className="text-gray-500 text-sm mt-1">{t('Shëndeti dhe statistikat reale të platformës')}</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-gray-400 hover:text-white text-sm transition-all disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{t('Rifresko')}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`bg-gray-900 border ${card.border} rounded-2xl p-5 transition-all`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center`}><Icon className={`w-5 h-5 ${card.color}`} /></div>
              </div>
              <div className="text-2xl font-bold text-white mb-1">{loading ? '—' : card.value}</div>
              <div className="text-xs text-gray-500">{card.label}</div>
              <div className="text-xs text-gray-600 mt-0.5">{card.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Tregtitë e fundit */}
        <div className="lg:col-span-5 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" />{t('Tregtitë e fundit')}</h3>
            <span className="text-gray-500 text-xs">{t('8 të fundit')}</span>
          </div>
          <div className="divide-y divide-gray-800/50">
            {loading ? (
              [...Array(5)].map((_, i) => <div key={i} className="px-5 py-3"><div className="w-full h-8 bg-gray-800 rounded-lg animate-pulse" /></div>)
            ) : stats.recentTrades.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">{t('Ende pa tregti')}</div>
            ) : (
              stats.recentTrades.map(trade => (
                <div key={trade.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-800/30 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${trade.type === 'buy' ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                    {trade.type === 'buy' ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">{trade.symbol || '—'}</span>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${trade.type === 'buy' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{trade.type === 'buy' ? t('BLEJ') : t('SHIT')}</span>
                    </div>
                    <div className="text-gray-500 text-xs truncate">{trade.full_name || '—'}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-white text-sm font-semibold">{Number(trade.volume || 0)} {t('lot')}</div>
                    <div className="text-gray-600 text-[10px]">{trade.executed_at ? new Date(trade.executed_at).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Veprime të shpejta (funksionale) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">{t('Veprime të shpejta')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <button key={link.label} onClick={() => onNavigate?.(link.page)} className={`bg-gray-800/50 border ${link.border} rounded-xl p-3.5 hover:bg-gray-800 cursor-pointer transition-all group text-left`}>
                <div className={`w-8 h-8 ${link.bg} rounded-lg flex items-center justify-center mb-2.5`}><Icon className={`w-4 h-4 ${link.color}`} /></div>
                <div className="text-white text-xs font-semibold">{link.label}</div>
                <div className="text-gray-600 text-[10px] mt-0.5 leading-tight">{link.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
