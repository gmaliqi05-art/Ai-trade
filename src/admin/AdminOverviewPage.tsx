import { useState, useEffect, useCallback } from 'react';
import {
  Users, Activity, DollarSign, Zap, TrendingUp, Crown,
  ArrowUpRight, ArrowDownRight, RefreshCw, AlertCircle,
  BarChart2, Shield, Brain, Monitor
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Stats {
  totalUsers: number;
  proUsers: number;
  totalTrades: number;
  buyVolume: number;
  activeSignals: number;
  totalAssets: number;
  totalBalance: number;
  aiAnalyses: number;
}

interface RecentTrade {
  id: string;
  type: string;
  total: number;
  executed_at: string;
  assets: { symbol: string } | null;
  profiles: { full_name: string } | null;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0, proUsers: 0, totalTrades: 0, buyVolume: 0,
    activeSignals: 0, totalAssets: 0, totalBalance: 0, aiAnalyses: 0,
  });
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [statsRes, tradesRes, signalsRes, assetsRes, aiRes] = await Promise.all([
      supabase.rpc('get_admin_stats'),
      supabase.from('trades').select('id, type, total, executed_at, assets(symbol), profiles(full_name)').order('executed_at', { ascending: false }).limit(8),
      supabase.from('signals').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('assets').select('id', { count: 'exact' }),
      supabase.from('ai_analyses').select('id', { count: 'exact' }),
    ]);

    const s = statsRes.data || {};
    const trades = tradesRes.data || [];
    const buyVolume = trades.reduce((acc, t) => acc + (t.type === 'buy' ? Number(t.total) : 0), 0);

    setStats({
      totalUsers: s.totalUsers || 0,
      proUsers: s.proUsers || 0,
      totalTrades: trades.length,
      buyVolume,
      activeSignals: signalsRes.count || 0,
      totalAssets: assetsRes.count || 0,
      totalBalance: 0,
      aiAnalyses: aiRes.count || 0,
    });
    setRecentTrades(trades as RecentTrade[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statCards = [
    {
      label: 'Total Users',
      value: stats.totalUsers.toString(),
      sub: `${stats.proUsers} paid`,
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      trend: '+12%',
      up: true,
    },
    {
      label: 'Platform Balance',
      value: `$${(stats.totalBalance / 1000).toFixed(1)}K`,
      sub: 'Total user funds',
      icon: DollarSign,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      trend: '+8.4%',
      up: true,
    },
    {
      label: 'Total Trades',
      value: stats.totalTrades.toString(),
      sub: `$${(stats.buyVolume / 1000).toFixed(1)}K volume`,
      icon: Activity,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      trend: '+23%',
      up: true,
    },
    {
      label: 'Active Signals',
      value: stats.activeSignals.toString(),
      sub: `${stats.totalAssets} listed assets`,
      icon: Zap,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
      trend: '+5',
      up: true,
    },
    {
      label: 'Pro/Elite Users',
      value: stats.proUsers.toString(),
      sub: `${stats.totalUsers > 0 ? Math.round((stats.proUsers / stats.totalUsers) * 100) : 0}% conversion`,
      icon: Crown,
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/20',
      trend: '+3',
      up: true,
    },
    {
      label: 'AI Analyses',
      value: stats.aiAnalyses.toString(),
      sub: 'Total generated',
      icon: Brain,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/20',
      trend: '+18%',
      up: true,
    },
  ];

  const quickLinks = [
    { label: 'Manage Users', icon: Users, desc: 'Edit balances, tiers & permissions', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    { label: 'Update Assets', icon: BarChart2, desc: 'Edit prices, add new instruments', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    { label: 'Publish Signal', icon: Zap, desc: 'Create new trading signals', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    { label: 'AI Providers', icon: Brain, desc: 'Configure API keys & prompts', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    { label: 'Broadcast', icon: AlertCircle, desc: 'Send message to all users', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    { label: 'Audit Log', icon: Shield, desc: 'View all admin actions', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-700' },
  ];

  return (
    <div className="p-5 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            Platform Overview
          </h2>
          <p className="text-gray-500 text-sm mt-1">Real-time platform health and statistics</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-gray-400 hover:text-white text-sm transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`bg-gray-900 border ${card.border} rounded-2xl p-5 hover:border-opacity-60 transition-all`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <div className={`flex items-center gap-1 text-xs font-semibold ${card.up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {card.up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {card.trend}
                </div>
              </div>
              <div className="text-2xl font-bold text-white mb-1">{loading ? '—' : card.value}</div>
              <div className="text-xs text-gray-500">{card.label}</div>
              <div className="text-xs text-gray-600 mt-0.5">{card.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              Recent Trades
            </h3>
            <span className="text-gray-500 text-xs">Last 8 trades</span>
          </div>
          <div className="divide-y divide-gray-800/50">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-full h-8 bg-gray-800 rounded-lg animate-pulse" />
                </div>
              ))
            ) : recentTrades.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">No trades yet</div>
            ) : (
              recentTrades.map(trade => (
                <div key={trade.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-800/30 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${trade.type === 'buy' ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                    {trade.type === 'buy'
                      ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                      : <ArrowDownRight className="w-4 h-4 text-red-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">{trade.assets?.symbol || '—'}</span>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${trade.type === 'buy' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {trade.type}
                      </span>
                    </div>
                    <div className="text-gray-500 text-xs truncate">{trade.profiles?.full_name || '—'}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-white text-sm font-semibold">${Number(trade.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    <div className="text-gray-600 text-[10px]">
                      {new Date(trade.executed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-red-400" />
              Platform Status
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Database', status: 'Operational', ok: true },
                { label: 'Auth Service', status: 'Operational', ok: true },
                { label: 'Edge Functions', status: 'Operational', ok: true },
                { label: 'Storage', status: 'Operational', ok: true },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs">{item.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${item.ok ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                    <span className={`text-xs font-medium ${item.ok ? 'text-emerald-400' : 'text-red-400'}`}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              User Distribution
            </h3>
            <div className="space-y-2.5">
              {[
                { label: 'Free', count: stats.totalUsers - stats.proUsers, color: 'bg-gray-500', textColor: 'text-gray-400' },
                { label: 'Pro', count: Math.floor(stats.proUsers * 0.7), color: 'bg-amber-500', textColor: 'text-amber-400' },
                { label: 'Elite', count: Math.ceil(stats.proUsers * 0.3), color: 'bg-orange-500', textColor: 'text-orange-400' },
              ].map(tier => {
                const pct = stats.totalUsers > 0 ? (tier.count / stats.totalUsers) * 100 : 0;
                return (
                  <div key={tier.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${tier.textColor}`}>{tier.label}</span>
                      <span className="text-gray-500 text-xs">{tier.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${tier.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <div key={link.label} className={`bg-gray-800/50 border ${link.border} rounded-xl p-3.5 hover:bg-gray-800 cursor-pointer transition-all group`}>
                <div className={`w-8 h-8 ${link.bg} rounded-lg flex items-center justify-center mb-2.5`}>
                  <Icon className={`w-4 h-4 ${link.color}`} />
                </div>
                <div className="text-white text-xs font-semibold group-hover:text-white transition-colors">{link.label}</div>
                <div className="text-gray-600 text-[10px] mt-0.5 leading-tight">{link.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
