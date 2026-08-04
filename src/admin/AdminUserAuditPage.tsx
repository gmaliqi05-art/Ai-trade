import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, Loader2, Search, Crown, Cloud, CloudOff, ChevronDown,
  CalendarClock, Save, Check, TrendingUp, Hand, Bot,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

/* AUDITIMI I PËRDORUESVE
 *
 * Një pamje e vetme që i përgjigjet pyetjes së pronarit: "a janë të kënaqur përdoruesit, dhe si po
 * u shkon me sinjalet e mia?" — pa hamendje, me numra.
 *
 * Thelbi është NDARJA E BURIMIT. Një përdorues mund të thotë "po humbas" ndërsa humbjet vijnë nga
 * tregtimi i tij manual, jo nga sinjalet. Këtu të tria kolonat rrinë krah për krah, ndaj kjo bisedë
 * zgjidhet me një shikim.
 *
 * Dhe te detajet e secilit: çdo tregti sinjali me REZULTATIN E VËRTETË — a doli te TP-ja, te SL-ja,
 * apo dikush e mbylli vetë / lëvizi nivelet. Kjo e fundit është pika ku "sinjali nuk punoi" bëhet
 * "sinjali nuk u ndoq". */

type Row = {
  user_id: string; email: string | null; full_name: string | null; username: string | null;
  registered_at: string | null; is_admin: boolean; is_vip: boolean;
  subscription_tier: string | null; subscription_status: string | null;
  subscription_expires_at: string | null; trial_ends_at: string | null;
  mt_connected: boolean; mt_mode: string | null; mt_last_connected_at: string | null;
  sig_trades: number; sig_net: number; sig_wins: number;
  bot_trades: number; bot_net: number; bot_wins: number;
  man_trades: number; man_net: number; man_wins: number;
};

type SigTrade = {
  id: string; created_at: string; closed_at: string | null; symbol: string; action: string;
  volume: number; tp_index: number | null; entry_price: number | null; stop_loss: number | null;
  take_profit: number | null; orig_stop_loss: number | null; orig_take_profit: number | null;
  exit_price: number | null; net: number | null;
  status: string; outcome: 'tp' | 'sl' | 'manual' | 'open' | 'rejected';
};

/** Rezultati i kontrollit "po ta kishte lënë siç e dha sinjali". */
type WhatIf = {
  verdict: 'tp' | 'sl' | 'undecided' | 'ambiguous' | 'unknown';
  at?: string | null; sl?: number; tp?: number; approx_levels?: boolean; error?: string;
};

const money = (n: number) => `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}$`;
const cls = (n: number) => (n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-gray-400');
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');
const rate = (w: number, n: number) => (n > 0 ? `${Math.round((w / n) * 100)}%` : '—');

export default function AdminUserAuditPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const [trades, setTrades] = useState<SigTrade[]>([]);
  const [tLoading, setTLoading] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Kontrolli per-tregti: çfarë do të kishte ndodhur me nivelet e sinjalit.
  const [wif, setWif] = useState<Record<string, WhatIf>>({});
  const [wifBusy, setWifBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_user_audit');
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Hap detajet e një përdoruesi: tregtitë e sinjaleve + fusha e afatit të abonimit.
  const openUser = async (r: Row) => {
    if (open === r.user_id) { setOpen(null); return; }
    setOpen(r.user_id); setSaved(false); setTrades([]);
    setExpiry(r.subscription_expires_at ? r.subscription_expires_at.slice(0, 10) : '');
    setTLoading(true);
    const { data } = await supabase.rpc('admin_user_signal_trades', { target: r.user_id, p_days: 90 });
    setTLoading(false);
    setTrades((data as SigTrade[]) ?? []);
  };

  // Ruan afatin. Data vjen si 'YYYY-MM-DD' → e çojmë në fund të asaj dite, që abonimi të vlejë
  // gjithë ditën e fundit e të mos skadojë në mesnatë të asaj që sapo u zgjodh.
  const saveExpiry = async (r: Row, days?: number) => {
    setSaving(true); setSaved(false);
    let iso: string;
    if (days != null) {
      const base = r.subscription_expires_at && new Date(r.subscription_expires_at) > new Date()
        ? new Date(r.subscription_expires_at) : new Date();
      base.setDate(base.getDate() + days);
      iso = base.toISOString();
    } else {
      if (!expiry) { setSaving(false); return; }
      iso = new Date(`${expiry}T23:59:59`).toISOString();
    }
    const { error } = await supabase.rpc('admin_set_subscription', {
      target: r.user_id, p_expires: iso, p_tier: null, p_status: null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setSaved(true); setExpiry(iso.slice(0, 10)); load();
  };

  const checkWhatIf = async (id: string) => {
    setWifBusy(id);
    const { data, error } = await supabase.functions.invoke('admin-whatif', { body: { trade_id: id, hours: 72 } });
    setWifBusy(null);
    const r = (data ?? {}) as WhatIf & { ok?: boolean };
    setWif(p => ({ ...p, [id]: error ? { verdict: 'unknown', error: error.message } : r }));
  };

  const list = rows.filter(r => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return `${r.email ?? ''} ${r.full_name ?? ''} ${r.username ?? ''}`.toLowerCase().includes(s);
  });

  // Totalet — përgjigjja e shpejtë: a fitojnë njerëzit me sinjalet e mia, në tërësi?
  const tot = rows.reduce((a, r) => ({
    sig: a.sig + Number(r.sig_net || 0), man: a.man + Number(r.man_net || 0),
    bot: a.bot + Number(r.bot_net || 0), conn: a.conn + (r.mt_connected ? 1 : 0),
  }), { sig: 0, man: 0, bot: 0, conn: 0 });

  const badge = (o: SigTrade['outcome']) => {
    const m: Record<string, [string, string]> = {
      tp: [t('TP'), 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'],
      sl: [t('SL'), 'bg-red-500/15 text-red-300 border-red-500/30'],
      manual: [t('ME DORË'), 'bg-amber-500/15 text-amber-300 border-amber-500/40'],
      open: [t('hapur'), 'bg-sky-500/15 text-sky-300 border-sky-500/30'],
      rejected: [t('refuzuar'), 'bg-gray-700 text-gray-400 border-gray-600'],
    };
    const [label, c] = m[o] ?? [o, 'bg-gray-700 text-gray-400 border-gray-600'];
    return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${c}`}>{label}</span>;
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
          <Users className="w-6 h-6 text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-white">{t('Auditimi i përdoruesve')}</h1>
          <p className="text-xs text-gray-400">{t('Abonimet, lidhja me MT5 dhe rezultati i ndarë: sinjale · robotë · manual')}</p>
        </div>
        <button onClick={load} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {err && <div className="text-sm rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-300">{err}</div>}

      {/* TOTALET — a fitojnë njerëzit me sinjalet, krahasuar me çfarë bëjnë vetë. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { l: t('Përdorues'), v: String(rows.length), c: 'text-white', i: Users },
          { l: t('Të lidhur me MT5'), v: `${tot.conn}/${rows.length}`, c: 'text-sky-300', i: Cloud },
          { l: t('P&L nga sinjalet'), v: money(tot.sig), c: cls(tot.sig), i: TrendingUp },
          { l: t('P&L manual'), v: money(tot.man), c: cls(tot.man), i: Hand },
        ].map(s => (
          <div key={s.l} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[10px] uppercase text-gray-500 flex items-center gap-1"><s.i className="w-3 h-3" />{s.l}</div>
            <div className={`text-base font-black tabular-nums mt-0.5 ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Kërko me email ose emër…')}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500" />
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {list.map(r => {
            const isOpen = open === r.user_id;
            const expired = r.subscription_expires_at ? new Date(r.subscription_expires_at) < new Date() : false;
            return (
              <div key={r.user_id} className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <button onClick={() => openUser(r)} className="w-full text-left p-3 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">{r.email || r.full_name || r.user_id.slice(0, 8)}</span>
                    {r.is_admin && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                    {r.mt_connected
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-300 border-emerald-500/30"><Cloud className="w-3 h-3" />{r.mt_mode === 'live' ? 'LIVE' : 'DEMO'}</span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-gray-800 text-gray-500 border-gray-700"><CloudOff className="w-3 h-3" />{t('pa MT5')}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${expired ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-sky-500/15 text-sky-300 border-sky-500/30'}`}>
                      {r.subscription_tier || '—'} · {dstr(r.subscription_expires_at)}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-500 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { l: t('Sinjalet'), n: r.sig_trades, p: Number(r.sig_net || 0), w: r.sig_wins, i: TrendingUp },
                      { l: t('Robotët'), n: r.bot_trades, p: Number(r.bot_net || 0), w: r.bot_wins, i: Bot },
                      { l: t('Manual'), n: r.man_trades, p: Number(r.man_net || 0), w: r.man_wins, i: Hand },
                    ].map(c => (
                      <div key={c.l} className="rounded-lg bg-black/30 px-2 py-1.5">
                        <div className="text-[9px] uppercase text-gray-500 flex items-center gap-1"><c.i className="w-2.5 h-2.5" />{c.l}</div>
                        <div className={`text-xs font-black tabular-nums ${cls(c.p)}`}>{c.n > 0 ? money(c.p) : '—'}</div>
                        <div className="text-[9px] text-gray-600">{c.n} {t('tregti')} · {rate(c.w, c.n)}</div>
                      </div>
                    ))}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/10 p-3 space-y-3">
                    {/* AFATI I ABONIMIT */}
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="text-xs font-semibold text-white flex items-center gap-1.5 mb-2">
                        <CalendarClock className="w-3.5 h-3.5 text-amber-400" />{t('Afati i abonimit')}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="date" value={expiry} onChange={e => { setExpiry(e.target.value); setSaved(false); }}
                          className="bg-black/40 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50" />
                        <button onClick={() => saveExpiry(r)} disabled={saving || !expiry}
                          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-gray-950 hover:bg-amber-400 disabled:opacity-50">
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                          {saved ? t('U ruajt') : t('Ruaj')}
                        </button>
                        <span className="text-[10px] text-gray-600">{t('ose shto:')}</span>
                        {[30, 90, 365].map(d => (
                          <button key={d} onClick={() => saveExpiry(r, d)} disabled={saving}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700 disabled:opacity-50">
                            +{d} {t('ditë')}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1.5">
                        {t('Shtimi nis nga afati aktual nëse s\'ka skaduar; përndryshe nga sot.')}
                      </p>
                    </div>

                    {/* TREGTITË E SINJALEVE */}
                    <div>
                      <div className="text-xs font-semibold text-white mb-1.5">{t('Tregtitë nga sinjalet — 90 ditët e fundit')}</div>
                      {tLoading ? (
                        <div className="h-16 bg-gray-900 rounded-xl animate-pulse" />
                      ) : trades.length === 0 ? (
                        <p className="text-[11px] text-gray-600">{t('Asnjë tregti nga sinjalet për këtë përdorues.')}</p>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full text-[11px]">
                              <thead className="bg-black/40">
                                <tr className="text-gray-500">
                                  {[t('Data'), t('Simboli'), t('Drejtimi'), t('Lot'), t('Hyrja'), 'SL', 'TP', t('Dalja'), t('Neto'), t('Rezultati'), t('Po ta linte?')].map(h => (
                                    <th key={h} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {trades.map((x, i) => (
                                  <tr key={i} className="text-gray-300">
                                    <td className="px-2 py-1.5 whitespace-nowrap">{dstr(x.created_at)}</td>
                                    <td className="px-2 py-1.5">{x.symbol}</td>
                                    <td className={`px-2 py-1.5 font-semibold ${x.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{x.action}</td>
                                    <td className="px-2 py-1.5 tabular-nums">{x.volume}</td>
                                    <td className="px-2 py-1.5 tabular-nums">{x.entry_price ?? '—'}</td>
                                    <td className="px-2 py-1.5 tabular-nums text-red-300/70">{x.stop_loss ?? '—'}</td>
                                    <td className="px-2 py-1.5 tabular-nums text-emerald-300/70">{x.take_profit ?? '—'}</td>
                                    <td className="px-2 py-1.5 tabular-nums">{x.exit_price ?? '—'}</td>
                                    <td className={`px-2 py-1.5 tabular-nums font-bold ${cls(Number(x.net || 0))}`}>{x.net != null ? money(Number(x.net)) : '—'}</td>
                                    <td className="px-2 py-1.5">{badge(x.outcome)}</td>
                                    {/* KONTROLLI VENDIMTAR: vetëm për tregtitë ku dikush ndërhyri.
                                        Merr qirinjtë PAS mbylljes dhe sheh cilin nivel ORIGJINAL do
                                        ta kishte prekur i pari — TP-në apo SL-në. */}
                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                      {x.outcome !== 'manual' ? <span className="text-gray-700">—</span>
                                        : wif[x.id] ? (() => {
                                          const w = wif[x.id];
                                          const map: Record<string, [string, string]> = {
                                            tp: [t('do të kishte fituar'), 'text-emerald-300'],
                                            sl: [t('do të kishte humbur'), 'text-red-300'],
                                            ambiguous: [t('i njëjti qiri — s\'dihet'), 'text-gray-400'],
                                            undecided: [t('pa përfundim në 72h'), 'text-gray-400'],
                                            unknown: [t('s\'u kontrollua dot'), 'text-gray-500'],
                                          };
                                          const [lbl, c] = map[w.verdict] ?? [w.verdict, 'text-gray-400'];
                                          return <span className={`font-semibold ${c}`}>{lbl}{w.approx_levels ? ' *' : ''}</span>;
                                        })()
                                        : <button onClick={() => checkWhatIf(x.id)} disabled={wifBusy === x.id}
                                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700 disabled:opacity-50">
                                            {wifBusy === x.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}{t('kontrollo')}
                                          </button>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {/* Kjo është fjalia që e mbyll debatin "sinjali nuk punoi". */}
                          {trades.some(x => x.outcome === 'manual') && (
                            <p className="text-[10px] text-amber-300/80 mt-1.5">
                              {t('{n} nga këto tregti dolën larg SL-së dhe TP-së së sinjalit — pra u mbyllën me dorë ose u lëvizën nivelet.', {
                                n: trades.filter(x => x.outcome === 'manual').length,
                              })}
                            </p>
                          )}
                          {trades.some(x => wif[x.id]?.approx_levels) && (
                            <p className="text-[10px] text-gray-600 mt-1">
                              {t('* nivelet e kësaj tregtie u ruajtën retroaktivisht, ndaj mund të mos jenë saktësisht ato të sinjalit.')}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {list.length === 0 && <p className="text-sm text-gray-600 text-center py-6">{t('Asnjë përdorues nuk përputhet me kërkimin.')}</p>}
        </div>
      )}
    </div>
  );
}
