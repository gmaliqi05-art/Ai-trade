import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Users, TrendingUp, Zap, BarChart2, Search, Edit2, Check, X,
  Trash2, Plus, RefreshCw, ChevronUp, Activity, DollarSign,
  AlertTriangle, Crown, Loader2, Eye, EyeOff, Brain, Megaphone, Monitor, Key, TestTube, ExternalLink
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
  const [providerForm, setProviderForm] = useState<{ api_key: string; model: string; system_prompt: string; is_active: boolean; is_default: boolean }>({ api_key: '', model: '', system_prompt: '', is_active: false, is_default: false });
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
    if (providerForm.model) updates.model = providerForm.model.trim();
    if (providerForm.is_default) {
      await supabase.from('ai_providers').update({ is_default: false }).neq('id', p.id);
    }
    const { error } = await supabase.from('ai_providers').update(updates).eq('id', p.id);
    if (!error) {
      await logAction('UPDATE_AI_PROVIDER', 'ai_providers', p.id, { slug: p.slug, is_active: providerForm.is_active });
      await fetchAIProviders();
      setEditingProvider(null);
      flash('success', `${p.name} u përditësua.`);
    } else {
      flash('error', 'Përditësimi dështoi: ' + error.message);
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
      if (error || !data) throw new Error(error?.message || 'Pa përgjigje');
      setTestResult({ slug: p.slug, ok: true, msg: 'Provideri po përgjigjet saktë.' });
    } catch (e) {
      setTestResult({ slug: p.slug, ok: false, msg: (e as Error).message || 'Testi i providerit dështoi.' });
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
      flash('success', 'Mesazhi u dërgua te të gjithë përdoruesit.');
    } else {
      flash('error', 'Dërgimi i mesazhit dështoi.');
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
      flash('success', `Përdoruesi ${u.full_name} u përditësua.`);
    } else {
      flash('error', 'Përditësimi dështoi: ' + error.message);
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
      flash('success', `Aktivi ${a.symbol} u përditësua.`);
    } else {
      flash('error', 'Përditësimi dështoi: ' + error.message);
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
      flash('success', `Aktivi ${payload.symbol} u krijua.`);
    } else {
      flash('error', 'Krijimi dështoi: ' + error.message);
    }
    setSaving(false);
  };

  const deleteAsset = async (a: AssetRow) => {
    if (!window.confirm(`Ta fshij ${a.symbol}? Ky veprim s'kthehet mbrapsht.`)) return;
    const { error } = await supabase.from('assets').delete().eq('id', a.id);
    if (!error) {
      await logAction('DELETE_ASSET', 'assets', a.id, { symbol: a.symbol });
      await fetchAssets();
      flash('success', `Aktivi ${a.symbol} u fshi.`);
    } else {
      flash('error', 'Fshirja dështoi: ' + error.message);
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
      flash('success', 'Sinjali u krijua.');
    } else {
      flash('error', 'Krijimi dështoi: ' + error.message);
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
    if (!window.confirm('Ta fshij këtë sinjal?')) return;
    const { error } = await supabase.from('signals').delete().eq('id', s.id);
    if (!error) {
      await logAction('DELETE_SIGNAL', 'signals', s.id);
      await fetchSignals();
      flash('success', 'Sinjali u fshi.');
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
    { id: 'overview', label: 'Përmbledhje', icon: BarChart2 },
    { id: 'users', label: 'Përdorues', icon: Users },
    { id: 'assets', label: 'Aktive', icon: TrendingUp },
    { id: 'signals', label: 'Sinjale', icon: Zap },
    { id: 'trades', label: 'Tregti', icon: Activity },
    { id: 'ai_providers', label: 'AI Providers', icon: Brain },
    { id: 'notifications', label: 'Broadcast', icon: Megaphone },
    { id: 'audit', label: 'Audit', icon: Shield },
  ];

  if (!forcedTab && !(profile as unknown as { is_admin?: boolean })?.is_admin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-96 gap-4">
        <AlertTriangle className="w-12 h-12 text-red-400" />
        <h2 className="text-xl font-bold text-white">Qasje e ndaluar</h2>
        <p className="text-gray-400 text-sm">Nuk ke privilegje administratori.</p>
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
          <p className="text-gray-400 text-sm mt-1">Menaxhimi dhe mbikëqyrja e platformës</p>
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
              { label: 'Përdorues gjithsej', value: stats.totalUsers.toString(), icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { label: 'Përdorues me pagesë', value: stats.proUsers.toString(), icon: Crown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Tregti gjithsej', value: stats.totalTrades.toString(), icon: Activity, color: 'text-green-400', bg: 'bg-green-500/10' },
              { label: 'Vëllim blerjeje', value: `$${stats.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Sinjale aktive', value: stats.activeSignals.toString(), icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Aktive të listuara', value: stats.totalAssets.toString(), icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
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
            <h3 className="text-amber-400 font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Veprime të shpejta</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Menaxho përdoruesit', tab: 'users' as AdminTab },
                { label: 'Përditëso çmimet', tab: 'assets' as AdminTab },
                { label: 'Publiko sinjal', tab: 'signals' as AdminTab },
                { label: 'Shiko aktivitetin', tab: 'trades' as AdminTab },
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
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko përdorues..." className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
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
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Përdoruesi</th>
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Plani</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Balanca</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Admin</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Veprime</th>
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
                                <div className="text-white font-medium text-sm">{u.full_name || 'Pa emër'}</div>
                                <div className="text-gray-500 text-xs">@{u.username || 'pa-username'}</div>
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
                                  <label className="text-xs text-gray-400 block mb-1">Balanca ($)</label>
                                  <input type="number" value={editUserForm.balance} onChange={e => setEditUserForm(f => ({ ...f, balance: e.target.value }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm w-36 focus:outline-none focus:border-amber-500" />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-400 block mb-1">Abonimi</label>
                                  <select value={editUserForm.subscription_tier} onChange={e => setEditUserForm(f => ({ ...f, subscription_tier: e.target.value }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500">
                                    <option value="free">Free</option>
                                    <option value="pro">Pro</option>
                                    <option value="elite">Elite</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-400">Admin</label>
                                  <button onClick={() => setEditUserForm(f => ({ ...f, is_admin: !f.is_admin }))} className={`w-10 h-5 rounded-full transition-all relative ${editUserForm.is_admin ? 'bg-amber-500' : 'bg-gray-600'}`}>
                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editUserForm.is_admin ? 'left-5' : 'left-0.5'}`} />
                                  </button>
                                </div>
                                <button onClick={() => saveUser(u)} disabled={saving} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-4 py-1.5 rounded-lg text-sm transition-all">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Ruaj
                                </button>
                                <button onClick={() => setEditingUser(null)} className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded-lg text-sm transition-all">
                                  <X className="w-3 h-3" />Anulo
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
                  <div className="text-center py-12 text-gray-500 text-sm">Asnjë përdorues i gjetur</div>
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
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko aktive..." className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <button onClick={() => { setShowNewAsset(!showNewAsset); setSearch(''); }} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              <Plus className="w-4 h-4" />Shto aktiv
            </button>
          </div>

          {showNewAsset && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400" />Aktiv i ri</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'symbol', label: 'Simboli', placeholder: 'XAUUSD' },
                  { key: 'name', label: 'Emri', placeholder: 'Ari / USD' },
                  { key: 'current_price', label: 'Çmimi', placeholder: '2340.00' },
                  { key: 'high_24h', label: 'Maks 24h', placeholder: '2360.00' },
                  { key: 'low_24h', label: 'Min 24h', placeholder: '2310.00' },
                  { key: 'price_change_pct', label: 'Ndryshim %', placeholder: '1.25' },
                  { key: 'volume_24h', label: 'Vëllimi 24h', placeholder: '100000' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                    <input placeholder={f.placeholder} value={(newAsset as Record<string, string>)[f.key] || ''} onChange={e => setNewAsset(a => ({ ...a, [f.key]: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Kategoria</label>
                  <select value={newAsset.category} onChange={e => setNewAsset(a => ({ ...a, category: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="commodity">Mallra / Ar</option>
                    <option value="forex">Forex</option>
                    <option value="crypto">Crypto</option>
                    <option value="stock">Indekse / Aksione</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={createAsset} disabled={saving || !newAsset.symbol || !newAsset.current_price} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Krijo aktiv
                </button>
                <button onClick={() => setShowNewAsset(false)} className="px-5 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Anulo</button>
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
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Aktivi</th>
                      <th className="text-left text-gray-500 font-medium px-4 py-3">Kategoria</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Çmimi</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">24h %</th>
                      <th className="text-right text-gray-500 font-medium px-4 py-3">Vëllimi</th>
                      <th className="text-center text-gray-500 font-medium px-4 py-3">Veprime</th>
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
                                  { key: 'current_price', label: 'Çmimi' },
                                  { key: 'price_change_pct_24h', label: 'Ndryshim %' },
                                  { key: 'high_24h', label: 'Maks 24h' },
                                  { key: 'low_24h', label: 'Min 24h' },
                                  { key: 'volume_24h', label: 'Vëllimi' },
                                ].map(f => (
                                  <div key={f.key}>
                                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                                    <input type="number" value={(editAssetForm as Record<string, number>)[f.key] || ''} onChange={e => setEditAssetForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) }))} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm w-28 focus:outline-none focus:border-amber-500" />
                                  </div>
                                ))}
                                <button onClick={() => saveAsset(a)} disabled={saving} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-4 py-1.5 rounded-lg text-sm transition-all">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Ruaj
                                </button>
                                <button onClick={() => setEditingAsset(null)} className="px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-all">Anulo</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                {filteredAssets.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">Asnjë aktiv i gjetur</div>
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
              <Plus className="w-4 h-4" />Publiko sinjal
            </button>
          </div>

          {showNewSignal && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Sinjal i ri</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Aktivi</label>
                  <select value={newSignal.asset_id} onChange={e => setNewSignal(s => ({ ...s, asset_id: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="">Zgjidh aktivin</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Lloji i sinjalit</label>
                  <select value={newSignal.signal_type} onChange={e => setNewSignal(s => ({ ...s, signal_type: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="buy">Blej</option>
                    <option value="sell">Shit</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Fuqia</label>
                  <select value={newSignal.strength} onChange={e => setNewSignal(s => ({ ...s, strength: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                    <option value="strong">E fortë</option>
                    <option value="medium">Mesatare</option>
                    <option value="weak">E dobët</option>
                  </select>
                </div>
                {[
                  { key: 'entry_price', label: 'Çmimi i hyrjes' },
                  { key: 'target_price', label: 'Çmimi objektiv' },
                  { key: 'stop_loss', label: 'Stop Loss' },
                  { key: 'confidence', label: 'Besueshmëria (0-100)' },
                  { key: 'timeframe', label: 'Periudha (p.sh. 1D)' },
                  { key: 'expires_at', label: 'Skadon më (opsionale)' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                    <input type={f.key === 'expires_at' ? 'datetime-local' : 'number'} value={(newSignal as Record<string, string>)[f.key]} onChange={e => setNewSignal(s => ({ ...s, [f.key]: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                ))}
                <div className="col-span-2 md:col-span-3">
                  <label className="text-xs text-gray-400 block mb-1">Përshkrimi</label>
                  <textarea value={newSignal.description} onChange={e => setNewSignal(s => ({ ...s, description: e.target.value }))} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 resize-none" placeholder="Analiza dhe arsyetimi i sinjalit..." />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={createSignal} disabled={saving || !newSignal.asset_id || !newSignal.entry_price} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}Publiko sinjal
                </button>
                <button onClick={() => setShowNewSignal(false)} className="px-5 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Anulo</button>
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
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{s.status === 'active' ? 'Aktiv' : 'Joaktiv'}</span>
                      {s.source && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">{s.source}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => toggleSignal(s)} className={`p-1.5 rounded-lg transition-all ${s.status === 'active' ? 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'}`} title={s.status === 'active' ? 'Çaktivizo' : 'Aktivizo'}>
                        {s.status === 'active' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => deleteSignal(s)} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-400">
                    <span>Hyrje: <span className="text-white">{s.entry_price}</span></span>
                    <span>Objektiv: <span className="text-green-400">{s.target_price}</span></span>
                    <span>Stop: <span className="text-red-400">{s.stop_loss}</span></span>
                  </div>
                  {s.analysis && <p className="mt-2 text-xs text-gray-500 line-clamp-2">{s.analysis}</p>}
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center py-12 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-2xl">Asnjë sinjal i gjetur</div>
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
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Përdoruesi</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Aktivi</th>
                    <th className="text-center text-gray-500 font-medium px-4 py-3">Lloji</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Sasia</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Çmimi</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Totali</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Data</th>
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
              <div className="text-center py-12 text-gray-500 text-sm">Asnjë tregti e gjetur</div>
            )}
          </div>
        </div>
      )}

      {tab === 'ai_providers' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
              <Brain className="w-4 h-4 text-amber-400" />Konfigurimi i AI Providers
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Konfiguro të paktën një provider AI për të aktivizuar analizën reale.
              Provider-i AI është <strong className="text-white">truri që arsyeton</strong>: motori llogarit indikatorët nga të dhëna reale tregu,
              dhe AI-ja shpjegon e konfirmon sinjalin (BLEJ/SHIT/PRIT). Kurrë vlera fake apo të fiksuara.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                {
                  name: 'Groq',
                  badge: 'FALAS',
                  badgeColor: 'bg-green-500/20 text-green-400',
                  desc: 'Opsioni më i mirë për të nisur — plotësisht falas dhe i shpejtë (LLaMA). Çelësi te console.groq.com',
                  url: 'console.groq.com',
                  slug: 'groq',
                },
                {
                  name: 'OpenAI',
                  badge: 'ME PAGESË',
                  badgeColor: 'bg-blue-500/20 text-blue-400',
                  desc: 'GPT-4o — shumë i saktë. Pagesë sipas përdorimit. Çelësi te platform.openai.com',
                  url: 'platform.openai.com',
                  slug: 'openai',
                },
                {
                  name: 'Anthropic',
                  badge: 'ME PAGESË',
                  badgeColor: 'bg-orange-500/20 text-orange-400',
                  desc: 'Claude (Opus) — arsyetim i shkëlqyer, i rekomanduar për sinjale. Çelësi te console.anthropic.com',
                  url: 'console.anthropic.com',
                  slug: 'anthropic',
                },
                {
                  name: 'Google Gemini',
                  badge: 'PLAN FALAS',
                  badgeColor: 'bg-sky-500/20 text-sky-400',
                  desc: 'Gemini Flash — ka plan falas. Çelësi te aistudio.google.com',
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
                      {provider?.is_active && <span className="text-xs text-green-400 ml-auto flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-400" />Aktiv</span>}
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
                          {p.is_default && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg">Parazgjedhur</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                            {p.is_active ? 'Aktiv' : 'Joaktiv'}
                          </span>
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          Modeli: <span className="text-gray-400">{p.model}</span> | Prioriteti: {p.priority}
                          {p.api_key_encrypted ? <span className="ml-2 text-green-500">· çelësi i vendosur</span> : <span className="ml-2 text-amber-500">· pa çelës</span>}
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
                          setProviderForm({ api_key: '', model: p.model, system_prompt: p.system_prompt, is_active: p.is_active, is_default: p.is_default });
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
                      Pa çelës API. Kliko Edito për të shtuar një çelës dhe aktivizuar këtë provider.
                      {p.slug === 'anthropic' && <span className="ml-1 font-semibold">Çelësin e Anthropic e merr te console.anthropic.com</span>}
                    </div>
                  )}

                  {editingProvider === p.id && (
                    <div className="mt-4 space-y-4 border-t border-gray-800 pt-4">
                      {p.slug === 'groq' && (
                        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 text-xs text-green-300 leading-relaxed">
                          <strong>Groq është FALAS.</strong> Hapat: 1) Hap <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline font-semibold">console.groq.com/keys</a> → 2) Krijo llogari falas → 3) Krijo një çelës → 4) Ngjite poshtë.<br />Model i sugjeruar: <code className="text-white">llama-3.3-70b-versatile</code>
                        </div>
                      )}
                      {p.slug === 'openai' && (
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300 leading-relaxed">
                          Hap <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline font-semibold">platform.openai.com/api-keys</a> → krijo çelës (fillon me <code className="text-white">sk-...</code>). Kërkon kredite. Model: <code className="text-white">gpt-4o</code>
                        </div>
                      )}
                      {p.slug === 'gemini' && (
                        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3 text-xs text-sky-300 leading-relaxed">
                          Hap <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline font-semibold">aistudio.google.com/app/apikey</a> → krijo çelës (ka plan falas). Model: <code className="text-white">gemini-1.5-flash</code>
                        </div>
                      )}
                      {p.slug === 'anthropic' && (
                        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 text-xs text-orange-300 leading-relaxed">
                          Hap <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="underline font-semibold">console.anthropic.com/settings/keys</a> → krijo çelës (fillon me <code className="text-white">sk-ant-...</code>) dhe sigurohu që ke <strong>kredite/billing</strong> aktiv te <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Billing</a>.<br />Modele aktuale: <code className="text-white">claude-opus-4-8</code> (Opus, më i fuqishëm) · <code className="text-white">claude-sonnet-4-6</code> (më i lirë/shpejtë).
                        </div>
                      )}
                      <div>
                        <label className="text-xs text-gray-400 flex items-center gap-1 mb-1.5">
                          <Key className="w-3 h-3" />Çelësi API {p.api_key_encrypted ? '(lëre bosh për të mbajtur aktualin)' : '(i nevojshëm për aktivizim)'}
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
                        <label className="text-xs text-gray-400 block mb-1.5">Modeli AI</label>
                        <input
                          value={providerForm.model}
                          onChange={e => setProviderForm(f => ({ ...f, model: e.target.value }))}
                          placeholder={p.slug === 'anthropic' ? 'claude-opus-4-8' : p.model}
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 font-mono"
                        />
                        <p className="text-[10px] text-gray-600 mt-1">Shkruaj emrin e saktë të modelit (p.sh. claude-opus-4-8). Aktual: <span className="text-gray-400">{p.model}</span></p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1.5">System Prompt (opsional — lëre bosh për parazgjedhjen)</label>
                        <textarea
                          value={providerForm.system_prompt}
                          onChange={e => setProviderForm(f => ({ ...f, system_prompt: e.target.value }))}
                          rows={3}
                          placeholder="Lëre bosh për të përdorur prompt-in e parazgjedhur të analizës..."
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-6">
                        {[{ key: 'is_active', label: 'Aktiv (klientët mund ta përdorin)' }, { key: 'is_default', label: 'Provider i parazgjedhur' }].map(f => (
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
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Ruaj & aktivizo
                        </button>
                        <button onClick={() => setEditingProvider(null)} className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-all">Anulo</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {aiProviders.length === 0 && (
                <div className="text-center py-12 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-2xl">Asnjë provider AI në databazë</div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-400" />Dërgo njoftim të përgjithshëm</h3>
            <p className="text-gray-400 text-sm mb-4">Ky mesazh do të shihet nga TË GJITHË përdoruesit te njoftimet e tyre.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Titulli</label>
                <input value={broadcastForm.title} onChange={e => setBroadcastForm(f => ({ ...f, title: e.target.value }))} placeholder="Njoftim i rëndësishëm..." className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Mesazhi</label>
                <textarea value={broadcastForm.body} onChange={e => setBroadcastForm(f => ({ ...f, body: e.target.value }))} rows={3} placeholder="Mesazhi yt për të gjithë përdoruesit..." className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 resize-none" />
              </div>
              <button onClick={sendBroadcast} disabled={sendingBroadcast || !broadcastForm.title || !broadcastForm.body} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all">
                {sendingBroadcast ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                {sendingBroadcast ? 'Po dërgohet...' : 'Dërgo te të gjithë'}
              </button>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Monitor className="w-4 h-4 text-amber-400" />Integrimi MetaTrader / Auto-Trade</h3>

            {/* Si funksionon — arkitektura */}
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-white mb-2">Si funksionon lidhja (arkitektura)</p>
              <div className="flex items-center gap-2 text-[11px] text-gray-300 flex-wrap mb-2">
                <span className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">Roboti AI (sinjale)</span>
                <span className="text-amber-400">→</span>
                <span className="bg-gray-900 border border-amber-500/30 rounded-lg px-2 py-1 text-amber-400">MetaApi.cloud (urë)</span>
                <span className="text-amber-400">→</span>
                <span className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">MT5 / Vantage (ekzekutim)</span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Klienti nuk lidh drejtpërdrejt MT5 me aplikacionin. Ai regjistron llogarinë e tij MT5 (Vantage) te <strong className="text-white">MetaApi.cloud</strong>,
                merr një <strong className="text-white">Account ID + Token</strong>, dhe i fut te paneli i tij (Tregtimi → MetaTrader). Roboti dërgon urdhrat përmes MetaApi-t.
                <strong className="text-white"> TradingView</strong> përdoret vetëm për grafikët (pamje), jo për tregtim.
              </p>
            </div>

            {/* Lidhjet korrekte për konfigurim */}
            <p className="text-xs font-semibold text-white mb-2">Lidhjet zyrtare (kliko për t'u lidhur)</p>
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              {[
                { name: 'MetaApi — Llogaritë (Add account)', url: 'https://app.metaapi.cloud/accounts', desc: 'Regjistro MT5-në e Vantage → merr Account ID' },
                { name: 'MetaApi — Token', url: 'https://app.metaapi.cloud/token', desc: 'Krijo API Token për lidhjen' },
                { name: 'MetaApi — Dokumentacioni', url: 'https://metaapi.cloud/docs/client/', desc: 'Udhëzues teknik i plotë' },
                { name: 'Vantage Markets', url: 'https://www.vantagemarkets.com/', desc: 'Broker-i — krijo/menaxho llogarinë MT5' },
                { name: 'MetaTrader 5 — Shkarko', url: 'https://www.metatrader5.com/en/download', desc: 'Platforma MT5 për desktop/mobile' },
                { name: 'TradingView', url: 'https://www.tradingview.com/', desc: 'Grafikët (vetëm pamje në dashboard)' },
              ].map(l => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-start gap-2 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-amber-500/40 rounded-xl px-3 py-2.5 transition-all">
                  <ExternalLink className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <span className="block text-xs text-white font-medium">{l.name}</span>
                    <span className="block text-[10px] text-gray-500">{l.desc}</span>
                  </span>
                </a>
              ))}
            </div>

            <p className="text-gray-400 text-xs mb-2">Monitoro lidhjet aktive MT4/MT5 të të gjithë përdoruesve.</p>
            <button onClick={async () => {
              const { data } = await supabase.from('metatrader_connections').select('*, profiles(full_name)').order('created_at', { ascending: false });
              if (data) flash('success', `U gjetën ${data.length} lidhje MT te të gjithë përdoruesit.`);
            }} className="flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl transition-all">
              <RefreshCw className="w-4 h-4" />Kontrollo të gjitha lidhjet
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
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Veprimi</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Tabela</th>
                    <th className="text-left text-gray-500 font-medium px-4 py-3">Detaje</th>
                    <th className="text-right text-gray-500 font-medium px-4 py-3">Data</th>
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
              <div className="text-center py-12 text-gray-500 text-sm">Ende pa veprime në regjistër</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
