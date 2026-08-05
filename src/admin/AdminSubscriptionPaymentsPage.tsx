import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Receipt, RefreshCw, Search, ExternalLink, CheckCircle2, XCircle,
  RotateCcw, Crown, TrendingUp, RepeatIcon, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

/* PAGESAT E ABONUESVE
 *
 * Deri tani e vetmja gjurmë e një pagese ishte ngjarja e papërpunuar e Stripe-it te
 * 'subscription_events' — e mirë për auditim, e papërdorshme si raport: për të parë sa pagoi kush,
 * duhej gërmuar brenda payload-it të çdo rreshti.
 *
 * Këtu çdo faturë del si rresht: kush, cili plan, sa, kur, deri kur vlen, dhe a rinovohet vetë.
 * Burimi është po ai webhook — thjesht i shkruar në kolona që lexohen.
 *
 * NJË DALLIM QË MBAHET ME KUJDES: të ardhurat numërohen VETËM nga faturat e arkëtuara. Një pagesë e
 * dështuar është sinjal që duhet ndjekur, jo para; prandaj ka ngjyrë dhe numërues të vetin, dhe
 * nuk hyn kurrë te totali. */

interface Row {
  id: string; user_id: string | null; email: string | null; full_name: string | null;
  plan: string; amount_cents: number; currency: string; status: string;
  paid_at: string | null; period_end: string | null;
  receipt_url: string | null; invoice_url: string | null; stripe_invoice_id: string | null;
  sub_tier: string | null; sub_status: string | null; sub_expires_at: string | null;
  auto_renew: boolean;
}

interface Summary {
  days: number;
  paid_count: number; paid_cents: number;
  failed_count: number; refunded_cents: number;
  payers: number; monthly_count: number; yearly_count: number;
  auto_on: number; auto_off: number;
}

const money = (cents: number, cur = 'eur') =>
  `${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(cur).toUpperCase()}`;
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const dtstr = (s: string | null) =>
  s ? `${new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—';

const STATUS: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
  paid:     { label: 'Arkëtuar',  cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', Icon: CheckCircle2 },
  failed:   { label: 'Dështoi',   cls: 'bg-red-500/15 text-red-300 border-red-500/40',             Icon: XCircle },
  refunded: { label: 'U kthye',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',       Icon: RotateCcw },
};

export default function AdminSubscriptionPaymentsPage() {
  const { t } = useI18n();
  const [days, setDays] = useState(90);
  const [filter, setFilter] = useState<'' | 'paid' | 'failed' | 'refunded'>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [a, b] = await Promise.all([
      supabase.rpc('admin_payments', { p_days: days, p_status: filter || null }),
      supabase.rpc('admin_payments_summary', { p_days: days }),
    ]);
    setLoading(false);
    if (a.error) { setErr(a.error.message); return; }
    setRows(((a.data ?? []) as Row[]).map(r => ({ ...r, amount_cents: Number(r.amount_cents) || 0 })));
    if (b.data) setSum(b.data as Summary);
  }, [days, filter]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      (r.email ?? '').toLowerCase().includes(s) ||
      (r.full_name ?? '').toLowerCase().includes(s) ||
      (r.stripe_invoice_id ?? '').toLowerCase().includes(s));
  }, [rows, q]);

  const Card = ({ label, value, sub, tone = 'text-white', border = 'border-gray-800', Icon }: {
    label: string; value: string; sub?: string; tone?: string; border?: string; Icon: React.ElementType;
  }) => (
    <div className={`bg-gray-900 border ${border} rounded-2xl p-3.5`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <span className="text-[11px] text-gray-400 font-semibold">{label}</span>
      </div>
      <div className={`text-lg sm:text-xl font-bold leading-none ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1.5">{sub}</div>}
    </div>
  );

  return (
    <div className="p-3 sm:p-5 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4 text-white" />
            </div>
            {t('Pagesat e abonuesve')}
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            {t('Çdo faturë e Stripe-it si rresht: kush pagoi, sa, për cilin plan dhe deri kur vlen.')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[30, 90, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                days === d ? 'bg-white/10 text-white border-white/20' : 'bg-transparent text-gray-500 border-gray-800 hover:text-gray-300'}`}>
              {d}{t('d')}
            </button>
          ))}
          <button onClick={load} disabled={loading} title={t('Rifresko')}
            className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {err && <div className="text-xs rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-300">{err}</div>}

      {/* TOTALET — të ardhurat vetëm nga faturat e arkëtuara. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card Icon={TrendingUp} border="border-emerald-500/25" tone="text-emerald-400"
          label={t('Të arkëtuara')} value={money(sum?.paid_cents ?? 0)}
          sub={`${sum?.paid_count ?? 0} ${t('fatura')} · ${sum?.payers ?? 0} ${t('abonues')}`} />
        <Card Icon={Crown} label={t('Sipas planit')}
          value={`${sum?.monthly_count ?? 0} / ${sum?.yearly_count ?? 0}`}
          sub={t('mujore / vjetore')} />
        <Card Icon={XCircle} border={sum && sum.failed_count > 0 ? 'border-red-500/25' : 'border-gray-800'}
          tone={sum && sum.failed_count > 0 ? 'text-red-400' : 'text-white'}
          label={t('Pagesa të dështuara')} value={String(sum?.failed_count ?? 0)}
          sub={sum && sum.refunded_cents > 0 ? `${t('kthyer')}: ${money(sum.refunded_cents)}` : t('karta e refuzuar ose fonde të pamjaftueshme')} />
        <Card Icon={RepeatIcon} label={t('Rinovimi automatik')}
          value={`${sum?.auto_on ?? 0} / ${(sum?.auto_on ?? 0) + (sum?.auto_off ?? 0)}`}
          sub={sum && sum.auto_off > 0 ? `${sum.auto_off} ${t('e kanë ndalur')}` : t('askush nuk e ka ndalur')} />
      </div>

      {/* FILTRAT */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Kërko: email, emër, nr. fature…')}
            className="w-full bg-black/40 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50" />
        </div>
        {([['', 'Të gjitha'], ['paid', 'Arkëtuar'], ['failed', 'Dështuar'], ['refunded', 'Kthyer']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v as typeof filter)}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              filter === v ? 'bg-white/10 text-white border-white/20' : 'bg-transparent text-gray-500 border-gray-800 hover:text-gray-300'}`}>
            {t(l)}
          </button>
        ))}
      </div>

      {/* TABELA */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[340px] sm:min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="text-left  font-semibold px-2 sm:px-3 py-2">{t('Abonuesi')}</th>
                <th className="text-left  font-semibold px-2 sm:px-3 py-2 hidden sm:table-cell">{t('Plani')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2">{t('Shuma')}</th>
                <th className="text-left  font-semibold px-2 sm:px-3 py-2">{t('Statusi')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2 hidden md:table-cell">{t('Paguar më')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2 hidden lg:table-cell">{t('Vlen deri')}</th>
                <th className="text-center font-semibold px-2 sm:px-3 py-2 hidden lg:table-cell">{t('Rinovim')}</th>
                <th className="text-right font-semibold px-2 sm:px-3 py-2 hidden md:table-cell">{t('Fatura')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-3 py-3"><div className="h-6 bg-gray-800 rounded animate-pulse" /></td></tr>
                ))
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                  {t('Ende asnjë pagesë. Sapo të arkëtohet e para, shfaqet këtu brenda sekondave.')}
                </td></tr>
              ) : list.map(r => {
                const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-700 text-gray-300 border-gray-600', Icon: Info };
                const StIcon = st.Icon;
                return (
                  <tr key={r.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                    <td className="px-2 sm:px-3 py-2">
                      <div className="text-white font-medium truncate max-w-[110px] sm:max-w-[180px]">{r.full_name || '—'}</div>
                      <div className="text-gray-500 truncate max-w-[110px] sm:max-w-[180px]">{r.email}</div>
                    </td>
                    <td className="px-2 sm:px-3 py-2 hidden sm:table-cell">
                      <span className="text-gray-300 capitalize">
                        {r.plan === 'yearly' ? t('Vjetor') : r.plan === 'monthly' ? t('Mujor') : (r.plan || '—')}
                      </span>
                    </td>
                    <td className={`px-2 sm:px-3 py-2 text-right font-semibold ${r.status === 'paid' ? 'text-emerald-400' : 'text-gray-400'}`}>
                      {money(r.amount_cents, r.currency)}
                    </td>
                    <td className="px-2 sm:px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${st.cls}`}>
                        <StIcon className="w-3 h-3" />{t(st.label)}
                      </span>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-right text-gray-400 hidden md:table-cell">{dtstr(r.paid_at)}</td>
                    <td className="px-2 sm:px-3 py-2 text-right text-gray-400 hidden lg:table-cell">{dstr(r.period_end ?? r.sub_expires_at)}</td>
                    <td className="px-2 sm:px-3 py-2 text-center hidden lg:table-cell">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        r.auto_renew ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                        {r.auto_renew ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-right hidden md:table-cell">
                      {r.invoice_url
                        ? <a href={r.invoice_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300">
                            <ExternalLink className="w-3 h-3" />{t('hap')}
                          </a>
                        : <span className="text-gray-700">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-800 flex gap-2 text-[10px] text-gray-600">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{t('Rreshtat vijnë nga faturat e Stripe përmes webhook-ut — pra janë vetë pagesat, jo një kopje e mbajtur me dorë. "Rinovim OFF" do të thotë se abonuesi e ka ndalur vetë; aksesin e mban deri në datën "Vlen deri", pastaj nuk rifaturohet.')}</span>
        </div>
      </div>
    </div>
  );
}
