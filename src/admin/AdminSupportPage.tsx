import { useState, useEffect, useCallback } from 'react';
import { LifeBuoy, Send, ArrowLeft, Loader2, RefreshCw, CheckCircle2, Clock, Archive, RotateCcw, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import {
  adminLoadTickets, loadMessages, adminReply, adminSetStatus, adminMarkRead,
  type SupportTicket, type SupportMessage,
} from '../services/support';

// SUPORTI (Admin) — mesazhet e klientëve me përgjigje brenda platformës.
// Kur Admini përgjigjet: statusi 'answered' + njoftim te zilja e klientit.
type Filter = 'all' | 'open' | 'answered' | 'closed';

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<SupportTicket | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setTickets(await adminLoadTickets());
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // Rifreskim i lehtë çdo 60s — mesazhet e reja shfaqen vetë.
  useEffect(() => { const id = setInterval(refresh, 60000); return () => clearInterval(id); }, [refresh]);

  const openTicket = async (tk: SupportTicket) => {
    setOpen(tk);
    setMsgs(await loadMessages(tk.id));
    if (tk.unread_by_admin) { await adminMarkRead(tk.id); refresh(); }
  };

  const submitReply = async () => {
    if (!user || !open || !reply.trim()) return;
    setBusy(true);
    const r = await adminReply(user.id, open, reply);
    setBusy(false);
    if (r.ok) { setReply(''); setMsgs(await loadMessages(open.id)); setOpen({ ...open, status: 'answered' }); refresh(); }
  };

  const setStatus = async (s: 'open' | 'answered' | 'closed') => {
    if (!open) return;
    await adminSetStatus(open.id, s);
    setOpen({ ...open, status: s });
    refresh();
  };

  const unreadCount = tickets.filter(tk => tk.unread_by_admin).length;
  const filtered = tickets.filter(tk => filter === 'all' || tk.status === filter);

  const who = (tk: SupportTicket) => tk.profiles?.full_name || tk.profiles?.username || tk.user_id.slice(0, 8);
  const fmtT = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  const StatusChip = ({ s }: { s: SupportTicket['status'] }) => (
    s === 'answered' ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('U përgjigj')}</span>
    : s === 'closed' ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-400">{t('Mbyllur')}</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{t('E hapur')}</span>
  );

  /* ---- Biseda ---- */
  if (open) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button onClick={() => { setOpen(null); refresh(); }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" />{t('Kthehu')}
          </button>
          <div className="flex items-center gap-2">
            <StatusChip s={open.status} />
            {open.status !== 'closed'
              ? <button onClick={() => setStatus('closed')} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"><Archive className="w-3.5 h-3.5" />{t('Mbyll')}</button>
              : <button onClick={() => setStatus('open')} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"><RotateCcw className="w-3.5 h-3.5" />{t('Rihap')}</button>}
          </div>
        </div>

        <div>
          <h1 className="text-lg font-bold text-white">{open.subject}</h1>
          <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
            <User className="w-3 h-3" />{who(open)} · {t('hapur më')} {fmtT(open.created_at)}
          </p>
        </div>

        <div className="space-y-2">
          {msgs.map(m => (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.sender === 'admin'
              ? 'ml-auto bg-red-500/10 border border-red-500/30'
              : 'mr-auto bg-gray-800 border border-gray-700'}`}>
              <div className="text-[10px] font-semibold mb-0.5 flex items-center gap-1.5">
                {m.sender === 'admin'
                  ? <span className="text-red-300">{t('Ti (Suporti)')}</span>
                  : <span className="text-sky-300">{who(open)}</span>}
                <span className="text-gray-500 font-normal">{fmtT(m.created_at)}</span>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 items-end">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3}
            placeholder={t('Shkruaj përgjigjen për klientin…')}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 resize-none" />
          <button onClick={submitReply} disabled={busy || !reply.trim()}
            className="p-3 rounded-xl bg-red-500 hover:bg-red-400 text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-gray-600">{t('Klienti njoftohet te zilja dhe e sheh përgjigjen te faqja e tij Suport.')}</p>
      </div>
    );
  }

  /* ---- Lista ---- */
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <LifeBuoy className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{t('Suporti — mesazhet e klientëve')}</h2>
            <p className="text-gray-500 text-xs">
              {unreadCount > 0
                ? <span className="text-amber-400 font-semibold">{t('{n} biseda të palexuara', { n: unreadCount })}</span>
                : t('Asnjë mesazh i palexuar')}
            </p>
          </div>
        </div>
        <button onClick={refresh} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {([['all', t('Të gjitha')], ['open', t('Të hapura')], ['answered', t('Të përgjigjura')], ['closed', t('Të mbyllura')]] as [Filter, string][]).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${filter === f
              ? 'bg-red-500/15 border-red-500/40 text-red-300'
              : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
            {label}{f === 'open' && unreadCount > 0 ? ` · ${unreadCount}` : ''}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">{t('Asnjë biletë në këtë filtër.')}</p>
        ) : filtered.map(tk => (
          <button key={tk.id} onClick={() => openTicket(tk)}
            className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${tk.unread_by_admin
              ? 'bg-amber-500/[0.06] border-amber-500/40 hover:bg-amber-500/[0.1]'
              : 'bg-gray-900 border-gray-800 hover:border-gray-700'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white truncate flex items-center gap-2">
                {tk.unread_by_admin && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
                {tk.subject}
              </span>
              <StatusChip s={tk.status} />
            </div>
            <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-1.5">
              <User className="w-3 h-3" />{who(tk)} · {fmtT(tk.last_msg_at)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
