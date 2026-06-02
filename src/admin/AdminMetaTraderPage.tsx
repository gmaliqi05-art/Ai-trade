import { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, Wifi, WifiOff, User, Clock, Activity, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface MTConnection {
  id: string;
  platform: string;
  server: string;
  login: string;
  symbol: string;
  interval_minutes: number;
  is_active: boolean;
  last_ping_at: string | null;
  last_data_at: string | null;
  created_at: string;
  profiles: { full_name: string; subscription_tier: string } | null;
}

export default function AdminMetaTraderPage() {
  const [connections, setConnections] = useState<MTConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('metatrader_connections')
      .select('*, profiles(full_name, subscription_tier)')
      .order('created_at', { ascending: false });
    if (data) setConnections(data as MTConnection[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const isOnline = (conn: MTConnection) => {
    if (!conn.last_ping_at || !conn.is_active) return false;
    const diff = Date.now() - new Date(conn.last_ping_at).getTime();
    return diff < 5 * 60 * 1000;
  };

  const filtered = connections.filter(c =>
    c.profiles?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.symbol?.toLowerCase().includes(search.toLowerCase()) ||
    c.server?.toLowerCase().includes(search.toLowerCase())
  );

  const online = connections.filter(c => isOnline(c)).length;
  const active = connections.filter(c => c.is_active).length;

  return (
    <div className="p-5 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Monitor className="w-5 h-5 text-red-400" />
            Lidhjet MetaTrader
          </h2>
          <p className="text-gray-500 text-sm mt-1">Monitoro të gjitha lidhjet MT4/MT5 të përdoruesve</p>
        </div>
        <button
          onClick={fetchConnections}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-gray-400 hover:text-white text-sm transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Rifresko
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Lidhje gjithsej', value: connections.length, icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Online tani', value: online, icon: Wifi, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Aktive', value: active, icon: Activity, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-gray-500 text-xs">{stat.label}</span>
                <div className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko sipas përdoruesit, simbolit, serverit..."
            className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500/50 placeholder-gray-600"
          />
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 font-medium px-5 py-3">Përdoruesi</th>
                  <th className="text-left text-gray-500 font-medium px-5 py-3">Platforma</th>
                  <th className="text-left text-gray-500 font-medium px-5 py-3">Serveri</th>
                  <th className="text-left text-gray-500 font-medium px-5 py-3">Simboli</th>
                  <th className="text-center text-gray-500 font-medium px-5 py-3">Statusi</th>
                  <th className="text-right text-gray-500 font-medium px-5 py-3">Ping i fundit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map(conn => {
                  const online = isOnline(conn);
                  return (
                    <tr key={conn.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-amber-500/20 rounded-full flex items-center justify-center">
                            <User className="w-3.5 h-3.5 text-amber-400" />
                          </div>
                          <div>
                            <div className="text-white text-xs font-medium">{conn.profiles?.full_name || '—'}</div>
                            <div className="text-gray-500 text-[10px] capitalize">{conn.profiles?.subscription_tier || 'free'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs font-bold uppercase text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">{conn.platform}</span>
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{conn.server}</td>
                      <td className="px-5 py-3 text-white text-xs font-semibold">{conn.symbol}</td>
                      <td className="px-5 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          {online
                            ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                            : <WifiOff className="w-3.5 h-3.5 text-gray-600" />
                          }
                          <span className={`text-xs font-medium ${online ? 'text-emerald-400' : 'text-gray-500'}`}>
                            {online ? 'Online' : conn.is_active ? 'Në pritje' : 'Joaktiv'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {conn.last_ping_at ? (
                          <div className="flex items-center justify-end gap-1.5 text-gray-500 text-xs">
                            <Clock className="w-3 h-3" />
                            {new Date(conn.last_ping_at).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs">Asnjëherë</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">Asnjë lidhje MetaTrader e gjetur</div>
          )}
        </div>
      </div>
    </div>
  );
}
