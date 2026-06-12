import { useEffect, useState, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Wallet, Activity, FlaskConical, Power } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

// Faqja Demo — pasqyron terminalin live, por tregton VIRTUALISHT (demo_trades + demo_balance),
// me çmimet reale të arit. E pavarur nga MetaApi: punon edhe kur MetaApi është poshtë.
// Konfigurimet (preset/rrezik) janë të njëjta si live (te "Lidhja & Konfigurimi").

type DemoTrade = {
  id: string; symbol: string; side: string; volume: number;
  entry_price: number; sl: number | null; tp: number | null;
  status: string; exit_price: number | null; exit_reason: string | null;
  profit: number | null; opened_at: string; closed_at: string | null;
};

const normSym = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function valuePerPrice(symbol: string): number {
  const s = normSym(symbol);
  if (s.includes('XAU') || s.includes('GOLD')) return 100;
  if (s.includes('OIL') || s.includes('WTI') || s.includes('BRENT')) return 1000;
  return 100000;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DemoTradingPage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(100);
  const [startBalance, setStartBalance] = useState<number>(100);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [trades, setTrades] = useState<DemoTrade[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: prof }, { data: tr }, { data: assets }] = await Promise.all([
      supabase.from('profiles').select('demo_balance, demo_start_balance, demo_enabled').eq('id', user.id).maybeSingle(),
      supabase.from('demo_trades').select('*').eq('user_id', user.id).order('opened_at', { ascending: false }).limit(200),
      supabase.from('assets').select('symbol, current_price'),
    ]);
    if (prof) {
      setBalance(Number(prof.demo_balance ?? 100));
      setStartBalance(Number(prof.demo_start_balance ?? 100));
      setEnabled(!!prof.demo_enabled);
    }
    if (tr) setTrades(tr as DemoTrade[]);
    if (assets) {
      const m: Record<string, number> = {};
      for (const a of assets as { symbol: string; current_price: number | null }[]) {
        if (a.current_price != null) m[normSym(a.symbol)] = Number(a.current_price);
      }
      setPrices(m);
    }
    setLoading(false);
    setNow(Date.now());
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const open = useMemo(() => trades.filter((t) => t.status === 'open'), [trades]);
  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);

  const unrealizedOf = useCallback((t: DemoTrade): number => {
    const px = prices[normSym(t.symbol)];
    if (px == null) return 0;
    const dir = (t.side || '').toLowerCase() === 'buy' ? 1 : -1;
    return (px - Number(t.entry_price)) * dir * Number(t.volume) * valuePerPrice(t.symbol);
  }, [prices]);

  const floating = useMemo(() => open.reduce((s, t) => s + unrealizedOf(t), 0), [open, unrealizedOf]);
  const equity = balance + floating;

  const realizedPnl = useMemo(() => closed.reduce((s, t) => s + (Number(t.profit) || 0), 0), [closed]);
  const wins = closed.filter((t) => (Number(t.profit) || 0) > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;

  async function toggleEnabled() {
    if (!user) return;
    const next = !enabled;
    setEnabled(next);
    await supabase.from('profiles').update({ demo_enabled: next }).eq('id', user.id);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              Tregto Demo
              <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded">Virtual</span>
            </h1>
            <p className="text-xs text-gray-400">Roboti tregton virtualisht me çmimet reale të arit — pa para reale, pa MetaApi.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleEnabled}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${enabled ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
            <Power className="w-3.5 h-3.5" /> {enabled ? 'Demo ON' : 'Demo OFF'}
          </button>
          <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Balanca demo" value={`€${fmt(balance)}`} icon={<Wallet className="w-4 h-4 text-amber-400" />} />
        <Card label="Equity" value={`€${fmt(equity)}`} icon={<Activity className="w-4 h-4 text-blue-400" />} />
        <Card label="Fitim/Humbje (hapur)" value={`${floating >= 0 ? '+' : ''}€${fmt(floating)}`}
          tone={floating >= 0 ? 'pos' : 'neg'} icon={floating >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />} />
        <Card label="Pozicione të hapura" value={`${open.length}`} sub={`nga starti €${fmt(startBalance)}`} icon={<Activity className="w-4 h-4 text-violet-400" />} />
      </div>

      {/* Performance strip */}
      <div className="grid grid-cols-3 gap-3">
        <Mini label="P&L i realizuar" value={`${realizedPnl >= 0 ? '+' : ''}€${fmt(realizedPnl)}`} tone={realizedPnl >= 0 ? 'pos' : 'neg'} />
        <Mini label="Trade të mbyllura" value={`${closed.length}`} />
        <Mini label="Win rate" value={`${winRate}%`} tone={winRate >= 50 ? 'pos' : undefined} />
      </div>

      {/* Open positions */}
      <Section title={`Pozicione të hapura (${open.length})`}>
        {loading ? <Empty text="Po ngarkohet…" /> : open.length === 0 ? (
          <Empty text="Asnjë pozicion i hapur. Roboti hap trade virtuale kur dalin sinjale të reja." />
        ) : (
          <Table head={['Lloji', 'Simboli', 'Vol', 'Hyrja', 'SL', 'TP', 'P&L tani']}>
            {open.map((t) => {
              const pnl = unrealizedOf(t);
              const buy = (t.side || '').toLowerCase() === 'buy';
              return (
                <tr key={t.id} className="border-t border-gray-800">
                  <Td><span className={`inline-flex items-center gap-1 font-medium ${buy ? 'text-emerald-400' : 'text-rose-400'}`}>{buy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{buy ? 'BLEJ' : 'SHIT'}</span></Td>
                  <Td>{t.symbol}</Td>
                  <Td>{fmt(Number(t.volume), 2)}</Td>
                  <Td>{fmt(Number(t.entry_price))}</Td>
                  <Td>{t.sl != null ? fmt(Number(t.sl)) : '—'}</Td>
                  <Td>{t.tp != null ? fmt(Number(t.tp)) : '—'}</Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {/* History */}
      <Section title={`Historiku (${closed.length})`}>
        {closed.length === 0 ? <Empty text="Ende s'ka trade të mbyllura." /> : (
          <Table head={['Lloji', 'Simboli', 'Vol', 'Hyrja', 'Dalja', 'Arsyeja', 'P&L', 'Mbyllur']}>
            {closed.slice(0, 50).map((t) => {
              const buy = (t.side || '').toLowerCase() === 'buy';
              const pnl = Number(t.profit) || 0;
              return (
                <tr key={t.id} className="border-t border-gray-800">
                  <Td><span className={buy ? 'text-emerald-400' : 'text-rose-400'}>{buy ? 'BLEJ' : 'SHIT'}</span></Td>
                  <Td>{t.symbol}</Td>
                  <Td>{fmt(Number(t.volume), 2)}</Td>
                  <Td>{fmt(Number(t.entry_price))}</Td>
                  <Td>{t.exit_price != null ? fmt(Number(t.exit_price)) : '—'}</Td>
                  <Td><span className={`text-[11px] uppercase ${t.exit_reason === 'tp' ? 'text-emerald-400' : t.exit_reason === 'sl' ? 'text-rose-400' : 'text-gray-400'}`}>{t.exit_reason || '—'}</span></Td>
                  <Td><span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pnl >= 0 ? '+' : ''}€{fmt(pnl)}</span></Td>
                  <Td className="text-gray-500">{t.closed_at ? new Date(t.closed_at).toLocaleString() : '—'}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <p className="text-[11px] text-gray-500 text-center">
        Përditësuar: {new Date(now).toLocaleTimeString()} · Modul demo i pavarur — punon edhe kur lidhja live (MetaApi) është jashtë shërbimit.
      </p>
    </div>
  );
}

function Card({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">{label}</span>{icon}
      </div>
      <div className={`text-lg font-semibold mt-1 ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-white">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-gray-500">{head.map((h) => <th key={h} className="text-left font-normal px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
function Empty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-xs text-gray-500">{text}</div>;
}
