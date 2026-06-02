import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Users, TrendingUp, Zap, BarChart2, Search, Edit2, Check, X,
  Trash2, Plus, RefreshCw, ChevronUp, Activity, DollarSign,
  AlertTriangle, Crown, Loader2, Eye, EyeOff, Brain, Megaphone, Monitor, Key, TestTube
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type AdminTab = 'overview' | 'users' | 'assets' | 'signals' | 'trades' | 'ai_providers' | 'notifications' | 'audit';

interface AdminPageProps {
  forcedTab?: string;
}

interface UserRow {
  id: string;
  full_name: string;
  username: string | null;
  email?: string;
  balance: number;
  subscription_tier: string;
  is_admin: boolean;
  created_at: string;
}

interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  type: string;
  category: string;
  current_price: number;
  price_change_pct: number;
  price_change_pct_24h: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
}

interface SignalRow {
  id: string;
  type: string;
  symbol: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  timeframe: string;
  analysis: string;
  status: string;
  source: string;
  created_at: string;
  expires_at: string | null;
}

interface TradeRow {
  id: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  fee: number;
  status: string;
  executed_at: string;
  created_at: string;
  assets: { symbol: string } | null;
  profiles: { full_name: string } | null;
}

interface AuditRow {
  id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface AIProviderRow {
  id: string;
  name: string;
  slug: string;
  model: string;
  endpoint: string;
  api_key_encrypted: string | null;
  system_prompt: string;
  is_active: boolean;
  is_default: boolean;
  priority: number;
}

interface Stats {
  totalUsers: number;
  totalTrades: number;
  totalVolume: number;
  activeSignals: number;
  totalAssets: number;
  proUsers: number;
}

export default function AdminPage({ forcedTab }: AdminPageProps = {}) {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<AdminTab>((forcedTab as AdminTab) || 'overview');
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalTrades: 0, totalVolume: 0, activeSignals: 0, totalAssets: 0, proUsers: 0 });
  const [users, setUsers] = useState<UserRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [aiProviders, setAIProviders] = useState<AIProviderRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<{ api_key: string; system_prompt: string; is_active: boolean; is_default: boolean }>({ api_key: '', system_prompt: '', is_active: false, is_default: false });
  const [showProviderKey, setShowProviderKey] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ slug: string; ok: boolean; msg: string } | null>(null);

  const [broadcastForm, setBroadcastForm] = useState({ title: '', body: '', type: 'broadcast' });
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState<{ balance: string; subscription_tier: string; is_admin: boolean }>({ balance: '', subscription_tier: 'free', is_admin: false });

  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [editAssetForm, setEditAssetForm] = useState<Partial<AssetRow>>({});

  const [showNewSignal, setShowNewSignal] = useState(false);
  const [newSignal, setNewSignal] = useState({ asset_id: '', signal_type: 'buy', strength: 'medium', entry_price: '', target_price: '', stop_loss: '', confidence: '75', timeframe: '1D', description: '', expires_at: '' });

  const [showNewAsset, setShowNewAsset] = useState(false);
  const [newAsset, setNewAsset] = useState({ symbol: '', name: '', category: 'commodity', current_price: '', price_change_pct: '0', volume_24h: '0', high_24h: '0', low_24h: '0' });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const logAction = useCallback(async (action: string, targetTable: string, targetId?: string, details?: Record<string, unknown>) => {
    if (!user) return;
    await supabase.from('admin_audit_log').insert({ admin_id: user.id, action, target_table: targetTable, target_id: targetId || null, details: details || null });
  }, [user]);

  const fetchOverview = useCallback(async () => {
    const [statsRes, tr, sr, ar] = await Promise.all([
      supabase.rpc('get_admin_stats'),
      supabase.from('trades').select('total, type', { count: 'exact' }),
      supabase.from('signals').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('assets').select('id', { count: 'exact' }),
    ]);
    const vol = (tr.data || []).reduce((s: number, t: { total: number; type: string }) => s + (t.type === 'buy' ? t.total : 0), 0);
    const s = statsRes.data || {};
    setStats({
      totalUsers: s.totalUsers || 0,
      totalTrades: tr.count || 0,
      totalVolume: vol,
      activeSignals: sr.count || 0,
      totalAssets: ar.count || 0,
      proUsers: s.proUsers || 0,
    });
  }, []);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.rpc('get_all_profiles');
    if (data) setUsers(data as UserRow[]);
  }, []);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase.from('assets').select('*').order('category');
    if (data) setAssets(data as AssetRow[]);
  }, []);

  const fetchSignals = useCallback(async () => {
    const { data } = await supabase.from('signals').select('*').order('created_at', { ascending: false });
    if (data) setSignals(data as SignalRow[]);
  }, []);

  const fetchTrades = useCallback(async () => {
    const { data } = await supabase.from('trades').select('*, assets(symbol), profiles(full_name)').order('created_at', { ascending: false }).limit(100);
    if (data) setTrades(data as TradeRow[]);
  }, []);

  const fetchAudit = useCallback(async () => {
    const { data } = await supabase.from('admin_audit_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(50);
    if (data) setAuditLog(data as AuditRow[]);
  }, []);

  const fetchAIProviders = useCallback(async () => {
    const { data } = await supabase.from('ai_providers').select('*').order('priority');
    if (data) setAIProviders(data as AIProviderRow[]);
  }, []);

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      await fetchOverview();
      if (tab === 'users') await fetchUsers();
      else if (tab === 'assets') await fetchAssets();
      else if (tab === 'signals') { await fetchSignals(); await fetchAssets(); }
      else if (tab === 'trades') await fetchTrades();
      else if (tab === 'ai_providers') await fetchAIProviders();
      else if (tab === 'audit') await fetchAudit();
      setLoading(false);
    };
    load();
  }, [tab, fetchOverview, fetchUsers, fetchAssets, fetchSignals, fetchTrades, fetchAudit, fetchAIProviders]);

  const saveProvider = async (p: AIProviderRow) => {
    setSaving(true);
    const updates: Record<string, unknown> = {
      system_prompt: providerForm.system_prompt,
      is_active: providerForm.is_active,
      is_default: providerForm.is_default,
    };
    if (providerForm.api_key) updates.api_key_encrypted = providerForm.api_key;
    if (providerForm.is_default) {
      await supabase.from('ai_providers').update({ is_default: false }).neq('id', p.id);
    }
    const { error } = await supabase.from('ai_providers').update(updates).eq('id', p.id);
    if (!error) {
      await logAction('UPDATE_AI_PROVIDER', 'ai_providers', p.id, { slug: p.slug, is_active: providerForm.is_active });
      await fetchAIProviders();
      setEditingProvider(null);
      flash('success', `${p.name} updated.`);
    } else {
      flash('error', 'Update failed: ' + error.message);
    }
    setSaving(false);
  };

  const testProvider = async (p: AIProviderRow) => {
    setTestingProvider(p.id);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-chart', {
        body: { provider: p.slug, testMode: true },
      });
      if (error || !data) throw new Error(error?.message || 'No response');
      setTestResult({ slug: p.slug, ok: true, msg: 'Provider responding correctly.' });
    } catch (e) {
      setTestResult({ slug: p.slug, ok: false, msg: (e as Error).message || 'Provider test failed.' });
    } finally {
      setTestingProvider(null);
    }
  };

  const sendBroadcast = async () => {
    if (!user || !broadcastForm.title || !broadcastForm.body) return;
    setSendingBroadcast(true);
    const { error } = await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'broadcast',
      title: broadcastForm.title,
      body: broadcastForm.body,
      is_broadcast: true,
    });
    if (!error) {
      await logAction('BROADCAST_NOTIFICATION', 'notifications', undefined, { title: broadcastForm.title });
      setBroadcastForm({ title: '', body: '', type: 'broadcast' });
      flash('success', 'Broadcast sent to all users.');
    } else {
      flash('error', 'Failed to send broadcast.');
    }
    setSendingBroadcast(false);
  };

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const saveUser = async (u: UserRow) => {
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      balance: parseFloat(editUserForm.balance),
      subscription_tier: editUserForm.subscription_tier,
      is_admin: editUserForm.is_admin,
    }).eq('id', u.id);
    if (!error) {
      await logAction('UPDATE_USER', 'profiles', u.id, { subscription_tier: editUserForm.subscription_tier, balance: editUserForm.balance });
      await fetchUsers();
      setEditingUser(null);
      flash('success', `User ${u.full_name} updated.`);
    } else {
      flash('error', 'Update failed: ' + error.message);
    }
    setSaving(false);
  };

  const saveAsset = async (a: AssetRow) => {
    setSaving(true);
    const { error } = await supabase.from('assets').update(editAssetForm).eq('id', a.id);
    if (!error) {
      await logAction('UPDATE_ASSET', 'assets', a.id, { symbol: a.symbol });
      await fetchAssets();
      setEditingAsset(null);
      flash('success', `Asset ${a.symbol} updated.`);
    } else {
      flash('error', 'Update failed: ' + error.message);
    }
    setSaving(false);
  };

  const createAsset = async () => {
    setSaving(true);
    const payload = {
      symbol: newAsset.symbol.toUpperCase(),
      name: newAsset.name,
      type: newAsset.category,
      current_price: parseFloat(newAsset.current_price),
      price_change_pct_24h: parseFloat(newAsset.price_change_pct),
      volume_24h: parseFloat(newAsset.volume_24h),
      high_24h: parseFloat(newAsset.high_24h),
      low_24h: parseFloat(newAsset.low_24h),
      price_change_24h: 0,
    };
    const { error } = await supabase.from('assets').insert(payload);
    if (!error) {
      await logAction('CREATE_ASSET', 'assets', undefined, { symbol: payload.symbol });
      await fetchAssets();
      setShowNewAsset(false);
      setNewAsset({ symbol: '', name: '', category: 'commodity', current_price: '', price_change_pct: '0', volume_24h: '0', high_24h: '0', low_24h: '0' });
      flash('success', `Asset ${payload.symbol} created.`);
    } else {
      flash('error', 'Create failed: ' + error.message);
    }
    setSaving(false);
  };

  const deleteAsset = async (a: AssetRow) => {
    if (!window.confirm(`Delete ${a.symbol}? This cannot be undone.`)) return;
    const { error } = await supabase.from('assets').delete().eq('id', a.id);
    if (!error) {
      await logAction('DELETE_ASSET', 'assets', a.id, { symbol: a.symbol });
      await fetchAssets();
      flash('success', `Asset ${a.symbol} deleted.`);
    } else {
      flash('error', 'Delete failed: ' + error.message);
    }
  };

  const createSignal = async () => {
    setSaving(true);
    const payload = {
      asset_id: newSignal.asset_id,
      type: newSignal.signal_type,
      entry_price: parseFloat(newSignal.entry_price),
      target_price: parseFloat(newSignal.target_price),
      stop_loss: parseFloat(newSignal.stop_loss),
      confidence: parseFloat(newSignal.confidence),
      timeframe: newSignal.timeframe,
      analysis: newSignal.description,
      status: 'active',
      source: 'admin',
      expires_at: newSignal.expires_at || null,
    };
    const { error } = await supabase.from('signals').insert(payload);
    if (!error) {
      await logAction('CREATE_SIGNAL', 'signals', undefined, { asset_id: payload.asset_id, type: payload.type });
      await fetchSignals();
      setShowNewSignal(false);
      setNewSignal({ asset_id: '', signal_type: 'buy', strength: 'medium', entry_price: '', target_price: '', stop_loss: '', confidence: '75', timeframe: '1D', description: '', expires_at: '' });
      flash('success', 'Signal created.');
    } else {
      flash('error', 'Create failed: ' + error.message);
    }
    setSaving(false);
  };

  const toggleSignal = async (s: SignalRow) => {
    const newStatus = s.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('signals').update({ status: newStatus }).eq('id', s.id);
    if (!error) {
      await logAction(s.status === 'active' ? 'DEACTIVATE_SIGNAL' : 'ACTIVATE_SIGNAL', 'signals', s.id);
      await fetchSignals();
    }
  };

  const deleteSignal = async (s: SignalRow) => {
    if (!window.confirm('Delete this signal?')) return;
    const { error } = await supabase.from('signals').delete().eq('id', s.id);
    if (!error) {
      await logAction('DELETE_SIGNAL', 'signals', s.id);
      await fetchSignals();
      flash('success', 'Signal deleted.');
    }
  };

  const filteredUsers = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.username?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAssets = assets.filter(a =>
    a.symbol.toLowerCase().includes(search.toLowerCase()) ||
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const tierColor = (t: string) => ({
    free: 'text-gray-400 bg-gray-700/50',
    pro: 'text-amber-400 bg-amber-500/10',
    elite: 'text-blue-400 bg-blue-500/10',
  }[t] || 'text-gray-400 bg-gray-700/50');

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'assets', label: 'Assets', icon: TrendingUp },
    { id: 'signals', label: 'Signals', icon: Zap },
    { id: 'trades', label: 'Trades', icon: Activity },
    { id: 'ai_providers', label: 'AI Providers', icon: Brain },
    { id: 'notifications', label: 'Broadcast', icon: Megaphone },
    { id: 'audit', label: 'Audit Log', icon: Shield },
  ];

  if (!forcedTab && !(profile as unknown as { is_admin?: boolean })?.is_admin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-96 gap-4">
        <AlertTriangle className="w-12 h-12 text-red-400" />
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="text-gray-400 text-sm">You do not have administrator privileges.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-amber-400" />Super Admin
          </h2>
          <p className="text-gray-400 text-sm mt-1">Platform management and oversight</p>
        </div>
        {msg && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${msg.type === 'success' ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
            {msg.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {msg.text}
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-2xl p-1 overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${tab === t.id ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: 'Total Users', value: stats.totalUsers.toString(), icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { label: 'Pro/Elite Users', value: stats.proUsers.toString(), icon: Crown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Total Trades', value: stats.totalTrades.toString(), icon: Activity, color: 'text-green-400', bg: 'bg-green-500/10' },
              { label: 'Buy Volume', value: `$${stats.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Active Signals', value: stats.activeSignals.toString(), icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Listed Assets', value: stats.totalAssets.toString(), icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-400 text-xs font-medium">{s.label}</span>
                    <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                  </div>
                  <div className="text-2xl font-bold text-white">{s.value}</div>
                </div>
              );
            })}
          </div>
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5">
            <h3 className="text-amber-400 font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Quick Actions</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Manage Users', tab: 'users' as AdminTab },
                { label: 'Update Prices', tab: 'assets' as AdminTab },
                { label: 'Publish Signal', tab: 'signals' as AdminTab },
                { label: 'View Activity', tab: 'trades' as AdminTab },
              ].map(a => (
                <button key={a.label} onClick={() => setTab(a.tab)} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-amber-500/30 text-white text-sm font-medium px-4 py-3 rounded-xl transition-all text-center">
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <button onClick={fetchUsers} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white hover:border-gray-600 transition-all">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 font-medium px-4 py-3">User</th>
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Tier</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Balance</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Admin</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredUsers.map(u => (
                      <>
                        <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-400 text-xs font-bold flex-shrink-0">
                                {u.full_name?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div>
                                <div className="text-white font-medium text-sm">{u.full_name || 'No name'}</div>
                                <div className="text-gray-500 text-xs">@{u.username || 'no-username'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-lg capitalize ${tierColor(u.subscription_tier)}`}>{u.subscription_tier}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-white font-medium">
                            ${u.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {u.is_admin ? <Shield className="w-4 h-4 text-amber-400 mx-auto" /> : <span className="text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => {
                              setEditingUser(editingUser === u.id ? null : u.id);
                              setEditUserForm({ balance: u.balance.toString(), subscription_tier: u.subscription_tier, is_admin: u.is_admin });
                            }} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all">
                              {editingUser === u.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                        {editingUser === u.id && (
                          <tr key={u.id + '-edit'} className="bg-gray-800/40">
                            <td colSpan={5} className="px-4 py-4">
                              <div className="flex flex-wrap gap-3 items-end">
                                <div>
                                  <label className="text-xs text-gray-400 block mb-1">Balance ($)</label>
                                  <input type="number" value={editUserForm.balance} onChange={e => setEditUserForm(f => ({ ...f, balance: e.target.value }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm w-36 focus:outline-none focus:border-amber-500" />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-400 block mb-1">Subscription</label>
                                  <select value={editUserForm.subscription_tier} onChange={e => setEditUserForm(f => ({ ...f, subscription_tier: e.target.value }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500">
                                    <option value="free">Free</option>
                                    <option value="pro">Pro</option>
                                    <option value="elite">Elite</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-400">Is Admin</label>
                                  <button onClick={() => setEditUserForm(f => ({ ...f, is_admin: !f.is_admin }))} className={`w-10 h-5 rounded-full transition-all relative ${editUserForm.is_admin ? 'bg-amber-500' : 'bg-gray-600'}`}>
                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editUserForm.is_admin ? 'left-5' : 'left-0.5'}`} />
                                  </button>
                                </div>
                                <button onClick={() => saveUser(u)} disabled={saving} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-4 py-1.5 rounded-lg text-sm transition-all">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
                                </button>
                                <button onClick={() => setEditingUser(null)} className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded-lg text-sm transition-all">
                                  <X className="w-3 h-3" />Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">No users found</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'assets' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets..." className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <button onClick={() => { setShowNewAsset(!showNewAsset); setSearch(''); }} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              <Plus className="w-4 h-4" />Add Asset
            </button>
          </div>

          {showNewAsset && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400" />New Asset</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'symbol', label: 'Symbol', placeholder: 'XAUUSD' },
                  { key: 'name', label: 'Name', placeholder: 'Gold / USD' },
                  { key: 'current_price', label: 'Price', placeholder: '2340.00' },
                  { key: 'high_24h', label: '24H High', placeholder: '2360.00' },
                  { key: 'low_24h', label: '24H Low', placeholder: '2310.00' },
                  { key: 'price_change_pct', label: 'Change %', placeholder: '1.25' },
                  { key: 'volume_24h', label: 'Volume 24H', placeholder: '100000' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                    <input placeholder={f.placeholder} value={(newAsset as Record<string, string>)[f.key] || ''} onChange={e => setNewAsset(a => ({ ...a, [f.key]: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Category</label>
                  <select value={newAsset.category} onChange={e => setNewAsset(a => ({ ...a, category: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="commodity">Commodity</option>
                    <option value="forex">Forex</option>
                    <option value="crypto">Crypto</option>
                    <option value="stock">Stock</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={createAsset} disabled={saving || !newAsset.symbol || !newAsset.current_price} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Create Asset
                </button>
                <button onClick={() => setShowNewAsset(false)} className="px-5 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-900 rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Asset</th>
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Category</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Price</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">24H %</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Volume</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredAssets.map(a => (
                      <>
                        <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{a.symbol}</div>
                            <div className="text-gray-500 text-xs">{a.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs capitalize text-gray-400">{a.category}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-white font-medium">
                            {a.category === 'forex' ? a.current_price.toFixed(4) : a.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${a.price_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right text-gray-400">
                            {a.volume_24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => {
                                setEditingAsset(editingAsset === a.id ? null : a.id);
                                setEditAssetForm({ current_price: a.current_price, price_change_pct_24h: a.price_change_pct_24h ?? a.price_change_pct, high_24h: a.high_24h, low_24h: a.low_24h, volume_24h: a.volume_24h });
                              }} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all">
                                {editingAsset === a.id ? <ChevronUp className="w-3 h-3" /> : <Edit2 className="w-3 h-3" />}
                              </button>
                              <button onClick={() => deleteAsset(a)} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingAsset === a.id && (
                          <tr key={a.id + '-edit'} className="bg-gray-800/40">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="flex flex-wrap gap-3 items-end">
                                {[
                                  { key: 'current_price', label: 'Price' },
                                  { key: 'price_change_pct_24h', label: 'Change %' },
                                  { key: 'high_24h', label: '24H High' },
                                  { key: 'low_24h', label: '24H Low' },
                                  { key: 'volume_24h', label: 'Volume' },
                                ].map(f => (
                                  <div key={f.key}>
                                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                                    <input type="number" value={(editAssetForm as Record<string, number>)[f.key] || ''} onChange={e => setEditAssetForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm w-28 focus:outline-none focus:border-amber-500" />
                                  </div>
                                ))}
                                <button onClick={() => saveAsset(a)} disabled={saving} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-4 py-1.5 rounded-lg text-sm transition-all">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
                                </button>
                                <button onClick={() => setEditingAsset(null)} className="px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-all">Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                {filteredAssets.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">No assets found</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'signals' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowNewSignal(!showNewSignal)} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              <Plus className="w-4 h-4" />Publish Signal
            </button>
          </div>

          {showNewSignal && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />New Signal</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Asset</label>
                  <select value={newSignal.asset_id} onChange={e => setNewSignal(s => ({ ...s, asset_id: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="">Select asset</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Signal Type</label>
                  <select value={newSignal.signal_type} onChange={e => setNewSignal(s => ({ ...s, signal_type: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Strength</label>
                  <select value={newSignal.strength} onChange={e => setNewSignal(s => ({ ...s, strength: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="strong">Strong</option>
                    <option value="medium">Medium</option>
                    <option value="weak">Weak</option>
                  </select>
                </div>
                {[
                  { key: 'entry_price', label: 'Entry Price' },
                  { key: 'target_price', label: 'Target Price' },
                  { key: 'stop_loss', label: 'Stop Loss' },
                  { key: 'confidence', label: 'Confidence (0-100)' },
                  { key: 'timeframe', label: 'Timeframe (e.g. 1D)' },
                  { key: 'expires_at', label: 'Expires At (optional)' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                    <input type={f.key === 'expires_at' ? 'datetime-local' : 'number'} value={(newSignal as Record<string, string>)[f.key]} onChange={e => setNewSignal(s => ({ ...s, [f.key]: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                ))}
                <div className="col-span-2 md:col-span-3">
                  <label className="text-xs text-gray-400 block mb-1">Description</label>
                  <textarea value={newSignal.description} onChange={e => setNewSignal(s => ({ ...s, description: e.target.value }))} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 resize-none" placeholder="Signal analysis and rationale..." />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={createSignal} disabled={saving || !newSignal.asset_id || !newSignal.entry_price} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}Publish Signal
                </button>
                <button onClick={() => setShowNewSignal(false)} className="px-5 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-900 rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="space-y-3">
              {signals.map(s => (
                <div key={s.id} className={`bg-gray-900 border rounded-2xl p-4 ${s.status === 'active' ? 'border-gray-800' : 'border-gray-800/40 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-white font-semibold">{s.symbol || '—'}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${s.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{s.type}</span>
                      <span className="text-amber-400 font-semibold text-sm">{s.confidence}%</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{s.status === 'active' ? 'Active' : 'Inactive'}</span>
                      {s.source && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">{s.source}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => toggleSignal(s)} className={`p-1.5 rounded-lg transition-all ${s.status === 'active' ? 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'}`} title={s.status === 'active' ? 'Deactivate' : 'Activate'}>
                        {s.status === 'active' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => deleteSignal(s)} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-400">
                    <span>Entry: <span className="text-white">{s.entry_price}</span></span>
                    <span>Target: <span className="text-green-400">{s.target_price}</span></span>
                    <span>Stop: <span className="text-red-400">{s.stop_loss}</span></span>
                  </div>
                  {s.analysis && <p className="mt-2 text-xs text-gray-500 line-clamp-2">{s.analysis}</p>}
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center py-12 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-2xl">No signals found</div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'trades' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 font-medium px-4 py-3">User</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Asset</th>
                    <th className="text-center text-gray-500 font-medium px-4 py-3">Type</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Qty</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Price</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Total</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {trades.map(t => (
                    <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-gray-300 text-sm">{t.profiles?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-white font-medium">{t.assets?.symbol || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${t.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{t.type}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{Number(t.quantity).toFixed(4)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">${Number(t.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">${Number(t.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs whitespace-nowrap">
                        {new Date(t.executed_at || t.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loading && trades.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">No trades found</div>
            )}
          </div>
        </div>
      )}

      {tab === 'ai_providers' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
              <Brain className="w-4 h-4 text-amber-400" />AI Provider Setup
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Configure at least one AI provider to enable real analysis for your clients.
              All analysis uses <strong className="text-white">live market data</strong> — never fake or hardcoded values.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                {
                  name: 'Groq',
                  badge: 'FREE',
                  badgeColor: 'bg-green-500/20 text-green-400',
                  desc: 'Best option — completely free. Fast LLaMA 4 model. Get key at console.groq.com',
                  url: 'console.groq.com',
                  slug: 'groq',
                },
                {
                  name: 'OpenAI',
                  badge: 'PAID',
                  badgeColor: 'bg-blue-500/20 text-blue-400',
                  desc: 'GPT-4o — most accurate. Paid per use. Get key at platform.openai.com',
                  url: 'platform.openai.com',
                  slug: 'openai',
                },
                {
                  name: 'Anthropic',
                  badge: 'PAID',
                  badgeColor: 'bg-orange-500/20 text-orange-400',
                  desc: 'Claude — excellent reasoning. Get key at console.anthropic.com',
                  url: 'console.anthropic.com',
                  slug: 'anthropic',
                },
                {
                  name: 'Google Gemini',
                  badge: 'FREE TIER',
                  badgeColor: 'bg-sky-500/20 text-sky-400',
                  desc: 'Gemini 1.5 Flash — free tier available. Get key at aistudio.google.com',
                  url: 'aistudio.google.com',
                  slug: 'gemini',
                },
              ].map(info => {
                const provider = aiProviders.find(p => p.slug === info.slug);
                return (
                  <div key={info.slug} className={`rounded-xl p-3 border ${provider?.is_active ? 'bg-green-500/5 border-green-500/20' : 'bg-gray-800/50 border-gray-700/50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-semibold text-sm">{info.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${info.badgeColor}`}>{info.badge}</span>
                      {provider?.is_active && <span className="text-xs text-green-400 ml-auto flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-400" />Active</span>}
                    </div>
                    <p className="text-gray-400 text-xs">{info.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-900 rounded-2xl animate-pulse" />)}</div>
          ) : (
            <div className="space-y-4">
              {aiProviders.map(p => (
                <div key={p.id} className={`bg-gray-900 border rounded-2xl p-5 ${p.is_active ? 'border-green-500/20' : 'border-gray-800/60'}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.is_active ? 'bg-green-500/15' : 'bg-gray-700/50'}`}>
                        <Brain className={`w-5 h-5 ${p.is_active ? 'text-green-400' : 'text-gray-500'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold">{p.name}</span>
                          {p.is_default && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg">Default</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                            {p.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          Model: <span className="text-gray-400">{p.model}</span> | Priority: {p.priority}
                          {p.api_key_encrypted ? <span className="ml-2 text-green-500">· API key set</span> : <span className="ml-2 text-amber-500">· No API key</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testProvider(p)}
                        disabled={testingProvider === p.id || !p.is_active}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 text-xs font-medium transition-all"
                      >
                        {testingProvider === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}Test
                      </button>
                      <button
                        onClick={() => {
                          setEditingProvider(editingProvider === p.id ? null : p.id);
                          setProviderForm({ api_key: '', system_prompt: p.system_prompt, is_active: p.is_active, is_default: p.is_default });
                          setTestResult(null);
                        }}
                        className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all"
                      >
                        {editingProvider === p.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {testResult?.slug === p.slug && (
                    <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${testResult.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {testResult.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}{testResult.msg}
                    </div>
                  )}

                  {!p.api_key_encrypted && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                      <Key className="w-3.5 h-3.5" />
                      No API key configured. Click Edit to add a key and enable this provider.
                      {p.slug === 'groq' && <span className="ml-1 font-semibold">Groq is FREE — get key at console.groq.com</span>}
                    </div>
                  )}

                  {editingProvider === p.id && (
                    <div className="mt-4 space-y-4 border-t border-gray-800 pt-4">
                      {p.slug === 'groq' && (
                        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 text-xs text-green-300">
                          <strong>Groq is FREE.</strong> Steps: 1) Go to console.groq.com → 2) Create free account → 3) Click "API Keys" → 4) Create new key → 5) Paste below
                        </div>
                      )}
                      {p.slug === 'openai' && (
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
                          Go to platform.openai.com → API Keys → Create new secret key. Starts with "sk-..."
                        </div>
                      )}
                      {p.slug === 'gemini' && (
                        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3 text-xs text-sky-300">
                          Go to aistudio.google.com → Get API Key → Create API key. Free tier available.
                        </div>
                      )}
                      {p.slug === 'anthropic' && (
                        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 text-xs text-orange-300">
                          Go to console.anthropic.com → API Keys → Create Key. Starts with "sk-ant-..."
                        </div>
                      )}
                      <div>
                        <label className="text-xs text-gray-400 flex items-center gap-1 mb-1.5">
                          <Key className="w-3 h-3" />API Key {p.api_key_encrypted ? '(leave blank to keep current)' : '(required to activate)'}
                        </label>
                        <div className="relative">
                          <input
                            type={showProviderKey === p.id ? 'text' : 'password'}
                            value={providerForm.api_key}
                            onChange={e => setProviderForm(f => ({ ...f, api_key: e.target.value }))}
                            placeholder={p.slug === 'groq' ? 'gsk_...' : p.slug === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 pr-10 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowProviderKey(showProviderKey === p.id ? null : p.id)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                          >
                            {showProviderKey === p.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1.5">System Prompt (optional — leave blank for default)</label>
                        <textarea
                          value={providerForm.system_prompt}
                          onChange={e => setProviderForm(f => ({ ...f, system_prompt: e.target.value }))}
                          rows={3}
                          placeholder="Leave blank to use the default trading analysis prompt..."
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-6">
                        {[{ key: 'is_active', label: 'Active (clients can use)' }, { key: 'is_default', label: 'Default Provider' }].map(f => (
                          <div key={f.key} className="flex items-center gap-2">
                            <button
                              onClick={() => setProviderForm(prev => ({ ...prev, [f.key]: !prev[f.key as keyof typeof prev] }))}
                              className={`w-10 h-5 rounded-full transition-all relative flex-shrink-0 ${providerForm[f.key as keyof typeof providerForm] ? 'bg-amber-500' : 'bg-gray-600'}`}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${providerForm[f.key as keyof typeof providerForm] ? 'left-5' : 'left-0.5'}`} />
                            </button>
                            <label className="text-xs text-gray-400">{f.label}</label>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => saveProvider(p)}
                          disabled={saving}
                          className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2 rounded-xl text-sm transition-all"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Save & Activate
                        </button>
                        <button onClick={() => setEditingProvider(null)} className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {aiProviders.length === 0 && (
                <div className="text-center py-12 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-2xl">No AI providers found in database</div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-400" />Send Broadcast Notification</h3>
            <p className="text-gray-400 text-sm mb-4">This message will be visible to ALL users in their notifications.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Title</label>
                <input value={broadcastForm.title} onChange={e => setBroadcastForm(f => ({ ...f, title: e.target.value }))} placeholder="Important announcement..." className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Message</label>
                <textarea value={broadcastForm.body} onChange={e => setBroadcastForm(f => ({ ...f, body: e.target.value }))} rows={3} placeholder="Your message to all users..." className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 resize-none" />
              </div>
              <button onClick={sendBroadcast} disabled={sendingBroadcast || !broadcastForm.title || !broadcastForm.body} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all">
                {sendingBroadcast ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                {sendingBroadcast ? 'Sending...' : 'Send to All Users'}
              </button>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Monitor className="w-4 h-4 text-amber-400" />MetaTrader Connections</h3>
            <p className="text-gray-400 text-sm">Monitor active MT4/MT5 connections across all users.</p>
            <button onClick={async () => {
              const { data } = await supabase.from('metatrader_connections').select('*, profiles(full_name)').order('created_at', { ascending: false });
              if (data) flash('success', `Found ${data.length} MT connections across all users.`);
            }} className="mt-3 flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl transition-all">
              <RefreshCw className="w-4 h-4" />Check All Connections
            </button>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Admin</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Action</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Table</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Details</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {auditLog.map(a => (
                    <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-gray-300 text-sm">{a.profiles?.full_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-lg ${
                          a.action.includes('DELETE') ? 'bg-red-500/10 text-red-400' :
                          a.action.includes('CREATE') ? 'bg-green-500/10 text-green-400' :
                          'bg-amber-500/10 text-amber-400'
                        }`}>{a.action}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{a.target_table}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono truncate max-w-xs">
                        {a.details ? JSON.stringify(a.details) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs whitespace-nowrap">
                        {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loading && auditLog.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">No audit entries yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
