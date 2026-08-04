import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, TrendingUp, RefreshCw, Shield, Brain, Megaphone, Crosshair,
  CreditCard, Activity, LineChart, Cloud, Hand, Bot, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AdminPage } from '../App';
import { useI18n } from '../i18n/i18n';

/* BALLINA E ADMINIT — vetëm numra që kanë kuptim.
 *
 * Çfarë ishte këtu më parë: gjashtë karta të mëdha, pesë prej tyre me "0". Shkaku nuk ishte pamja
 * por burimi — RPC-ja e vjetër lexonte tabelat 'trades' (0 rreshta), 'assets' (19 rreshta që dilnin
 * si "19 sinjale aktive të listuara") dhe 'signals.status = active' (kolonë që sot s'përdoret), dhe
 * as nuk i kthente fare çelësat e kostos. Pra kartat nuk ishin bosh — ishin të pavërteta.
 *
 * Tani çdo shifër vjen nga tabelat ku rri puna e vërtetë: 'position_closes', 'telegram_trades',
 * 'trade_executions', 'profiles', 'metaapi_config'. Kur diçka është zero, është zero e vërtetë.
 *
 * Rendi është ai i pyetjeve që bën një pronar kur hap panelin në mëngjes:
 *   1) A po rritet? (përdoruesit)  2) A po paguhet? (abonimet)
 *   3) A po fitojnë? (rezultati)   4) A po punon? (ekzekutimi)
 * dhe pastaj tabela për përdorues, ku secili ka vijën e vet — sepse mesatarja e fsheh individin. */

type Series = { d: string; n: number; net: number }[];

interface Overview {
  days: number;
  users: { total: number; connected: number; auto_trade: number; new_7d: number };
  subs: { active: number; trial: number; expiring_7d: number; expired: number };
  trading: { closed: number; net: number; wins: number; lots: number; traders: number };
  sources: { label: string; manual: boolean; n: number; wins: number; net: number }[];
  signals: { sent: number; tp: number; sl: number; manual: number; open: number };
  exec: { d7_ok: number; d7_rejected: number; d7_error: number; h24_ok: number; h24_bad: number };
  series: Series;
}

interface UserRow {
  user_id: string; email: string | null; full_name: string | null; registered_at: string | null;
  subscription_tier: string | null; subscription_status: string | null;
  subscription_expires_at: string | null; days_left: number | null;
  is_vip: boolean; is_admin: boolean;
  mt_connected: boolean; mt_mode: string | null; auto_trade: boolean;
  trades: number; wins: number; net: number; lots: number; last_trade_at: string | null;
  sig_trades: number; sig_net: number; bot_trades: number; bot_net: number;
  man_trades: number; man_net: number;
  series: number[] | null;
}

const money = (n: number) =>
  `${n >= 0 ? '+' : ''}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}$`;
const netCls = (n: number) => (n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-gray-400');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : '—');

/** Vija e vogël pranë emrit: neto kumulative e dritares. Tregon DREJTIMIN, jo zhurmën e një dite. */
function Spark({ data, w = 84, h = 26 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length === 0) return <span className="text-gray-700 text-[10px]">—</span>;
  const last = data[data.length - 1];
  const lo = Math.min(0, ...data), hi = Math.max(0, ...data);
  const span = hi - lo || 1;
  const x = (i: number) => (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - ((v - lo) / span) * h;
  const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const col = last > 0 ? '#34d399' : last < 0 ? '#f87171' : '#6b7280';
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      className="w-[52px] sm:w-[84px] h-[26px] overflow-visible">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#374151" strokeWidth="1" strokeDasharray="2 2" />
      <path d={`${path} L${x(data.length - 1)},${zeroY} L${x(0)},${zeroY} Z`} fill={col} opacity="0.12" />
      <path d={data.length === 1 ? `M0,${y(last)} L${w},${y(last)}` : path}
        fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function AdminOverviewPage({ onNavigate }: { onNavigate?: (p: AdminPage) => void }) {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setErr(null);
    const [a, b] = await Promise.all([
      supabase.rpc('admin_overview_v2', { p_days: days }),
      supabase.rpc('admin_user_performance', { p_days: days }),
    ]);
    setLoading(false);
    if (a.error) { setErr(a.error.message); return; }
    setOv(a.data as Overview);
    setRows(((b.data ?? []) as UserRow[]).map(r => ({
      ...r, trades: Number(r.trades) || 0, wins: Number(r.wins) || 0,
      net: Number(r.net) || 0, lots: Number(r.lots) || 0,
      sig_trades: Number(r.sig_trades) || 0, sig_net: Number(r.sig_net) || 0,
      bot_trades: Number(r.bot_trades) || 0, bot_net: Number(r.bot_net) || 0,
      man_trades: Number(r.man_trades) || 0, man_net: Number(r.man_net) || 0,
      series: (r.series ?? []).map(Number),
    })));
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const quickLinks: { label: string; icon: React.ElementType; desc: string; page: AdminPage; color: string; bg: string; border: string }[] = [
    { label: t('Auditimi i përdoruesve'), icon: Users, desc: t('Abonimet & raportet'), page: 'admin_user_audit', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    { label: 'GoldSniperFX', icon: Crosshair, desc: t('Feed-i & kanali'), page: 'admin_goldsniper', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    { label: t('Brokerët'), icon: CreditCard, desc: t('Partneritetet IB/CPA'), page: 'admin_brokers', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    { label: 'AI Providers', icon: Brain, desc: t('Çelësa API & prompt'), page: 'admin_ai', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    { label: 'Broadcast', icon: Megaphone, desc: t('Mesazh për të gjithë'), page: 'admin_broadcast', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    { label: 'Audit Log', icon: Shield, desc: t('Veprimet e adminit'), page: 'admin_audit', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-700' },
  ];

  // Grafiku kryesor: shtylla = neto e ditës, vija = neto kumulative. Të dyja nga e njëjta seri.
  const chart = useMemo(() => {
    const s = ov?.series ?? [];
    if (s.length === 0) return null;
    let run = 0;
    const cum = s.map(p => (run += Number(p.net) || 0));
    return { s, cum };
  }, [ov]);

  return (
    <div className="p-3 sm:p-5 space-y-4 max-w-7xl mx-auto">
      {/* Ballina + dritarja kohore */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            {t('Përmbledhja e platformës')}
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">{t('Numra realë nga tregtia, abonimet dhe ekzekutimi.')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                days === d ? 'bg-white/10 text-white border-white/20' : 'bg-transparent text-gray-500 border-gray-800 hover:text-gray-300'}`}>
              {d}{t('d')}
            </button>
          ))}
          <button onClick={fetchData} disabled={loading} title={t('Rifresko')}
            className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {err && (
        <div className="text-xs rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-300">{err}</div>
      )}

      {/* KATËR PYETJET. Çdo kartë: numri që vendos, dhe poshtë tij dy fakte që e shpjegojnë. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-blue-500/20 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-[11px] text-gray-400 font-semibold">{t('Përdoruesit')}</span>
          </div>
          <div className="text-2xl font-bold text-white leading-none">{loading ? '—' : ov?.users.total ?? 0}</div>
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div className="text-emerald-400">+{ov?.users.new_7d ?? 0} {t('të rinj (7d)')}</div>
            <div className="text-gray-500">{ov?.users.connected ?? 0} {t('të lidhur')} · {ov?.users.auto_trade ?? 0} {t('auto')}</div>
          </div>
        </div>

        <div className="bg-gray-900 border border-emerald-500/20 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-emerald-400" />
            <span className="text-[11px] text-gray-400 font-semibold">{t('Abonime aktive')}</span>
          </div>
          <div className="text-2xl font-bold text-white leading-none">{loading ? '—' : ov?.subs.active ?? 0}</div>
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div className="text-sky-300">{ov?.subs.trial ?? 0} {t('në provë falas')}</div>
            <div className={ov && ov.subs.expiring_7d > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500'}>
              {ov?.subs.expiring_7d ?? 0} {t('skadojnë ≤7 ditë')}
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] text-gray-400 font-semibold">{t('Rezultati')} ({days}{t('d')})</span>
          </div>
          <div className={`text-2xl font-bold leading-none ${netCls(ov?.trading.net ?? 0)}`}>
            {loading ? '—' : money(ov?.trading.net ?? 0)}
          </div>
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div className="text-gray-500">{ov?.trading.closed ?? 0} {t('tregti')} · {pct(ov?.trading.wins ?? 0, ov?.trading.closed ?? 0)} {t('fitore')}</div>
            <div className="text-gray-500">{ov?.trading.lots ?? 0} {t('lot')} · {ov?.trading.traders ?? 0} {t('tregtarë')}</div>
          </div>
        </div>

        <div className="bg-gray-900 border border-cyan-500/20 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <Cloud className="w-4 h-4 text-cyan-400" />
            <span className="text-[11px] text-gray-400 font-semibold">{t('Ekzekutimi (7d)')}</span>
          </div>
          <div className="text-2xl font-bold text-white leading-none">{loading ? '—' : ov?.exec.d7_ok ?? 0}</div>
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div className={ov && ov.exec.d7_rejected > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500'}>
              {ov?.exec.d7_rejected ?? 0} {t('të refuzuara nga brokeri')}
            </div>
            <div className={ov && ov.exec.d7_error > 0 ? 'text-red-400' : 'text-gray-500'}>
              {ov?.exec.d7_error ?? 0} {t('gabime')} · {ov?.exec.h24_ok ?? 0} {t('sot')}
            </div>
          </div>
        </div>
      </div>

      {/* GRAFIKU: shtyllat janë ditët, vija është bilanci kumulativ i platformës. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <LineChart className="w-4 h-4 text-emerald-400" />{t('Rezultati ditor i të gjithë përdoruesve')}
          </h3>
          <span className="text-[11px] text-gray-500">{t('Shtyllat = neto e ditës · Vija = kumulative')}</span>
        </div>
        {chart ? (() => {
          const { s, cum } = chart;
          const W = 720, H = 190, L = 52, R = 12, T = 12, B = 26;
          const iw = W - L - R, ih = H - T - B;
          const all = [...s.map(p => Number(p.net)), ...cum, 0];
          const lo = Math.min(...all), hi = Math.max(...all);
          const pad = Math.max((hi - lo) * 0.08, 1);
          const y0 = lo - pad, y1 = hi + pad;
          const x = (i: number) => L + (s.length === 1 ? iw / 2 : (i / (s.length - 1)) * iw);
          const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * ih;
          const bw = Math.max(2, (iw / Math.max(s.length, 1)) * 0.6);
          const zero = y(0);
          const line = s.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(cum[i]).toFixed(1)}`).join(' ');
          const ticks = Array.from({ length: 4 }, (_, i) => y0 + ((y1 - y0) * i) / 3);
          const xi = Array.from(new Set([0, Math.round((s.length - 1) / 2), s.length - 1]));
          const dm = (d: string) => { const p = d.split('-'); return `${p[2]}.${p[1]}`; };
          return (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[320px]" style={{ height: 190 }}>
                {ticks.map((v, i) => (
                  <g key={i}>
                    <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="#1f2937" strokeWidth="1" />
                    <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#6b7280">
                      {Math.round(v).toLocaleString('en-US')}
                    </text>
                  </g>
                ))}
                <line x1={L} y1={zero} x2={W - R} y2={zero} stroke="#4b5563" strokeWidth="1" />
                {s.map((p, i) => {
                  const v = Number(p.net);
                  const top = v >= 0 ? y(v) : zero;
                  const hh = Math.abs(zero - y(v));
                  return <rect key={p.d} x={x(i) - bw / 2} y={top} width={bw} height={Math.max(hh, v === 0 ? 0 : 1)}
                    fill={v >= 0 ? '#34d399' : '#f87171'} opacity="0.55" rx="1" />;
                })}
                <path d={line} fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeLinejoin="round" />
                {xi.map(i => (
                  <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#6b7280">{dm(s[i].d)}</text>
                ))}
              </svg>
            </div>
          );
        })() : (
          <div className="py-8 text-center text-gray-500 text-sm">{loading ? t('Duke ngarkuar…') : t('Ende pa tregti të mbyllura.')}</div>
        )}
      </div>

      {/* NGA VJEN REZULTATI. Kjo është pjesa që i jep përgjigje ankesës "po humbi": sinjalet dhe
          tregtimi me dorë ndahen, në vend që të shkrihen në një total të vetëm. */}
      {ov && ov.sources && ov.sources.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-sky-400" />{t('Nga vjen rezultati')} ({days}{t('d')})
          </h3>
          <div className="space-y-1.5">
            {ov.sources.map(src => {
              const maxN = Math.max(...ov.sources.map(z => z.n), 1);
              return (
                <div key={src.label} className="flex items-center gap-2 sm:gap-3">
                  <div className="w-20 sm:w-28 shrink-0 text-[11px] truncate flex items-center gap-1">
                    {src.manual
                      ? <Hand className="w-3 h-3 text-amber-400 shrink-0" />
                      : <Bot className="w-3 h-3 text-gray-500 shrink-0" />}
                    <span className={src.manual ? 'text-amber-300 font-semibold' : 'text-gray-300'}>{src.label}</span>
                  </div>
                  <div className="flex-1 min-w-0 h-4 bg-gray-800/60 rounded overflow-hidden">
                    <div className={`h-full rounded ${src.net >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                      style={{ width: `${Math.max((src.n / maxN) * 100, 2)}%` }} />
                  </div>
                  <div className="w-10 sm:w-12 shrink-0 text-right text-[11px] text-gray-400">{src.n}</div>
                  <div className="w-8 sm:w-10 shrink-0 text-right text-[11px] text-gray-500">{pct(src.wins, src.n)}</div>
                  <div className={`w-16 sm:w-24 shrink-0 text-right text-[11px] font-semibold ${netCls(src.net)}`}>
                    {money(src.net)}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600 mt-2.5 leading-relaxed">
            {t('Rreshtat janë burimi i tregtisë siç e regjistron sistemi: "Me dorë" janë ato që hapi vetë përdoruesi, të tjerat i hapi një robot. Kur humbja rri te rreshti me dorë, ajo nuk vjen nga sinjalet.')}
          </p>
        </div>
      )}

      {/* SINJALET: nga ato që u dërguan, sa dolën te TP, sa te SL, dhe sa i mbylli vetë përdoruesi. */}
      {ov && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Crosshair className="w-4 h-4 text-amber-400" />{t('Sinjalet GoldSniperFX')} ({days}{t('d')})
          </h3>
          <div className="grid grid-cols-5 gap-2">
            {[
              { l: t('Dërguar'), v: ov.signals.sent, c: 'text-white' },
              { l: t('Te TP'), v: ov.signals.tp, c: 'text-emerald-400' },
              { l: t('Te SL'), v: ov.signals.sl, c: 'text-red-400' },
              { l: t('Me dorë'), v: ov.signals.manual, c: 'text-amber-400' },
              { l: t('Hapur'), v: ov.signals.open, c: 'text-sky-300' },
            ].map(x => (
              <div key={x.l} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-1.5 py-2 text-center">
                <div className={`text-lg font-bold ${x.c}`}>{x.v}</div>
                <div className="text-[9px] text-gray-500 mt-0.5">{x.l}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
            {t('"Me dorë" = tregtia doli larg TP-së dhe SL-së së sinjalit, pra përdoruesi e mbylli vetë ose i lëvizi nivelet. Sa më i lartë ky numër, aq më pak vlen të matet sinjali nga rezultati i tyre.')}
          </p>
        </div>
      )}

      {/* TABELA PËR PËRDORUES — secili me vijën e vet. Mesatarja e platformës e fsheh individin. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />{t('Përdoruesit — si po u shkon')}
          </h3>
          <span className="text-[11px] text-gray-500">{rows.length} {t('gjithsej')} · {days}{t('d')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[340px] sm:min-w-[860px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="text-left font-semibold px-2 sm:px-3 py-2">{t('Përdoruesi')}</th>
                <th className="text-left font-semibold px-2 sm:px-3 py-2 hidden md:table-cell">{t('Abonimi')}</th>
                <th className="text-left font-semibold px-2 sm:px-3 py-2 hidden sm:table-cell">MT5</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2">{t('Tregti')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2 hidden sm:table-cell">{t('Fitore')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2">{t('Neto')}</th>
                <th className="text-center font-semibold px-2 sm:px-3 py-2">{t('Trendi')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2 hidden lg:table-cell">{t('E fundit')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-3 py-3"><div className="h-6 bg-gray-800 rounded animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">{t('Asnjë përdorues.')}</td></tr>
              ) : rows.map(r => (
                <tr key={r.user_id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                  <td className="px-2 sm:px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-medium truncate max-w-[104px] sm:max-w-[150px]">{r.full_name || '—'}</span>
                      {r.is_admin && <Shield className="w-3 h-3 text-red-400 shrink-0" />}
                    </div>
                    <div className="text-gray-500 truncate max-w-[104px] sm:max-w-[170px]">{r.email}</div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 hidden md:table-cell">
                    <div className="text-gray-300 capitalize">{r.subscription_tier || '—'}</div>
                    {r.days_left != null && (
                      <div className={r.days_left <= 7 ? 'text-amber-400 font-semibold' : 'text-gray-600'}>
                        {r.days_left} {t('ditë')}
                      </div>
                    )}
                  </td>
                  <td className="px-2 sm:px-3 py-2 hidden sm:table-cell">
                    {r.mt_connected ? (
                      <div className="flex flex-col gap-0.5 items-start">
                        <span className={`text-[9px] font-bold px-1.5 rounded ${r.mt_mode === 'live' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-sky-500/15 text-sky-300'}`}>
                          {(r.mt_mode || 'demo').toUpperCase()}
                        </span>
                        {r.auto_trade && <span className="text-[9px] font-bold px-1.5 rounded bg-violet-500/15 text-violet-300">AUTO</span>}
                      </div>
                    ) : <span className="text-gray-700">{t('pa lidhje')}</span>}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-right">
                    <div className="text-gray-200 font-semibold">{r.trades}</div>
                    <div className="text-[10px] text-gray-600 flex items-center justify-end gap-1.5"
                      title={t('Sinjale / robotë të tjerë / me dorë')}>
                      <span className="flex items-center gap-0.5 text-amber-500/80"><Crosshair className="w-2.5 h-2.5" />{r.sig_trades}</span>
                      <span className="flex items-center gap-0.5"><Bot className="w-2.5 h-2.5" />{r.bot_trades}</span>
                      <span className="flex items-center gap-0.5"><Hand className="w-2.5 h-2.5" />{r.man_trades}</span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-right text-gray-300 hidden sm:table-cell">{pct(r.wins, r.trades)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${netCls(r.net)}`}>
                    {r.trades > 0 ? money(r.net) : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-2 sm:px-3 py-2">
                    <div className="flex justify-center"><Spark data={r.series ?? []} /></div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-right text-gray-500 hidden lg:table-cell">{dstr(r.last_trade_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-800 flex gap-2 text-[10px] text-gray-600">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{t('Kolona "Tregti" e ndan burimin: roboti i sinjaleve dhe tregtimi me dorë. Trendi është neto kumulative e dritares — kur vija bie ndërsa tregtitë me dorë janë të shumta, humbja nuk vjen nga sinjalet.')}</span>
        </div>
      </div>

      {/* Veprime të shpejta */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">{t('Veprime të shpejta')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <button key={link.label} onClick={() => onNavigate?.(link.page)}
                className={`bg-gray-800/50 border ${link.border} rounded-xl p-3 hover:bg-gray-800 cursor-pointer transition-all text-left`}>
                <div className={`w-8 h-8 ${link.bg} rounded-lg flex items-center justify-center mb-2`}>
                  <Icon className={`w-4 h-4 ${link.color}`} />
                </div>
                <div className="text-white text-xs font-semibold leading-tight">{link.label}</div>
                <div className="text-gray-600 text-[10px] mt-0.5 leading-tight">{link.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
