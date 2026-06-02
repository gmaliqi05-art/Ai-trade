import { useEffect, useState } from 'react';
import { Briefcase, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCw, Clock, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface Position {
  id: string; asset_id: string; symbol: string; quantity: number; entry_price: number;
  current_price: number; unrealized_pnl: number; status: string;
  assets: { symbol: string; name: string; category: string; current_price: number; price_change_pct: number } | null;
}

interface Trade {
  id: string; type: string; quantity: number; price: number;
  total: number; fee: number; status: string; executed_at: string; created_at: string;
  assets: { symbol: string; name: string } | null;
}

export default function PortfolioPage() {
  const { user, profile } = useAuth();
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    const [pr, tr] = await Promise.all([
      supabase.from('portfolio_positions').select('*, assets(symbol, name, category, current_price, price_change_pct)').eq('user_id', user.id).eq('status', 'open'),
      supabase.from('trades').select('*, assets(symbol, name)').eq('user_id', user.id).order('executed_at', { ascending: false }).limit(50),
    ]);
    if (pr.data) setPositions(pr.data as Position[]);
    if (tr.data) setTrades(tr.data as Trade[]);
    setLoading(false);
  };

  const totalValue = positions.reduce((s, p) => s + (p.assets?.current_price || p.current_price || 0) * p.quantity, 0);
  const totalPnl = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
  const totalCost = positions.reduce((s, p) => s + p.entry_price * p.quantity, 0);
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const cc: Record<string, string> = { commodity: 'text-amber-400 bg-amber-500/10', forex: 'text-blue-400 bg-blue-500/10', crypto: 'text-orange-400 bg-orange-500/10', stock: 'text-green-400 bg-green-500/10' };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Briefcase className="w-6 h-6 text-amber-400" />Portfolio</h2>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Cash Balance', value: `$${(profile?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Invested Value', value: `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, icon: Briefcase, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, icon: totalPnl >= 0 ? TrendingUp : TrendingDown, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400', bg: totalPnl >= 0 ? 'bg-green-500/10' : 'bg-red-500/10' },
          { label: 'P&L %', value: `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`, icon: totalPnlPct >= 0 ? ArrowUpRight : ArrowDownRight, color: totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400', bg: totalPnlPct >= 0 ? 'bg-green-500/10' : 'bg-red-500/10' },
        ].map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2"><span className="text-gray-400 text-xs">{s.label}</span><div className={`w-8 h-8 ${s.bg} rounded-lg flex items-center justify-center`}><Icon className={`w-4 h-4 ${s.color}`} /></div></div>
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ); })}
      </div>

      <div className="flex gap-2">
        {['positions', 'history'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab as 'positions' | 'history')}
            className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all ${activeTab === tab ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {tab === 'positions' ? 'Open Positions' : 'Trade History'}
          </button>
        ))}
      </div>

      {loading ? <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}</div>
      : activeTab === 'positions' ? (
        positions.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <Briefcase className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">No open positions</p>
            <p className="text-gray-600 text-sm mt-1">Start trading to build your portfolio</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-800">
                  {['Asset', 'Quantity', 'Avg Price', 'Current', 'Value', 'P&L'].map(h => <th key={h} className={`text-xs font-medium text-gray-400 px-5 py-3 ${h === 'Asset' ? 'text-left' : 'text-right'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {positions.map((p) => {
                    const cp = p.assets?.current_price || p.current_price || 0;
                    const cv = p.quantity * cp;
                    const cb = p.quantity * p.entry_price;
                    const pnl = p.unrealized_pnl ?? (cv - cb);
                    const pp = cb > 0 ? (pnl / cb) * 100 : 0;
                    return (
                      <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-5 py-4"><div className="flex items-center gap-2"><span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${cc[p.assets?.category || ''] || 'text-gray-400 bg-gray-700'}`}>{p.assets?.symbol || p.symbol}</span><span className="text-gray-400 text-xs hidden sm:block truncate max-w-[120px]">{p.assets?.name}</span></div></td>
                        <td className="px-5 py-4 text-right text-white text-sm">{p.quantity.toFixed(p.quantity < 1 ? 6 : 4)}</td>
                        <td className="px-5 py-4 text-right text-gray-400 text-sm">${p.entry_price.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right text-white text-sm"><div>{cp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div><div className={`text-xs ${(p.assets?.price_change_pct || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(p.assets?.price_change_pct || 0) >= 0 ? '+' : ''}{(p.assets?.price_change_pct || 0).toFixed(2)}%</div></td>
                        <td className="px-5 py-4 text-right text-white text-sm font-medium">${cv.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right"><div className={`text-sm font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div><div className={`text-xs ${pp >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pp >= 0 ? '+' : ''}{pp.toFixed(2)}%</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        trades.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <Clock className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">No trade history</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-800">{['Asset', 'Type', 'Quantity', 'Price', 'Total', 'Date'].map(h => <th key={h} className={`text-xs font-medium text-gray-400 px-5 py-3 ${h === 'Asset' || h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-4 text-white text-sm font-medium">{t.assets?.symbol}</td>
                      <td className="px-5 py-4"><span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${t.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{t.type}</span></td>
                      <td className="px-5 py-4 text-right text-gray-300 text-sm">{t.quantity.toFixed(t.quantity < 1 ? 6 : 4)}</td>
                      <td className="px-5 py-4 text-right text-gray-300 text-sm">${t.price.toFixed(2)}</td>
                      <td className="px-5 py-4 text-right text-white text-sm font-medium">${t.total.toFixed(2)}</td>
                      <td className="px-5 py-4 text-right text-gray-500 text-xs">{new Date(t.executed_at || t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
