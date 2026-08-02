import { useState, useEffect, useCallback } from 'react';
import { LifeBuoy, Send, Plus, ArrowLeft, Loader2, Mail, CheckCircle2, Clock, MessageSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import {
  SUPPORT_EMAIL, loadMyTickets, createTicket, loadMessages, replyAsUser, markReadByUser,
  type SupportTicket, type SupportMessage,
} from '../services/support';

// SUPORT (klient) — bileta + bisedë me ekipin. Email zyrtar: support@goldsniper.vip.
export default function SupportPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [open, setOpen] = useState<SupportTicket | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const flash = (type: 'success' | 'error', text: string) => { setNote({ type, text }); setTimeout(() => setNote(null), 4000); };

  const refresh = useCallback(async () => {
    if (!user) return;
    setTickets(await loadMyTickets(user.id));
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);

  const openTicket = async (tk: SupportTicket) => {
    setOpen(tk);
    setMsgs(await loadMessages(tk.id));
    if (tk.unread_by_user) { await markReadByUser(tk.id); refresh(); }
  };

  const submitNew = async () => {
    if (!user || !subject.trim() || !body.trim()) return;
    setBusy(true);
    const r = await createTicket(user.id, subject, body);
    setBusy(false);
    if (r.ok) { setSubject(''); setBody(''); setShowNew(false); flash('success', t('Mesazhi u dërgua te suporti — do të marrësh përgjigje këtu.')); refresh(); }
    else flash('error', r.error || t('Dërgimi dështoi. Provo sërish.'));
  };

  const submitReply = async () => {
    if (!user || !open || !reply.trim()) return;
    setBusy(true);
    const r = await replyAsUser(user.id, open.id, reply);
    setBusy(false);
    if (r.ok) { setReply(''); setMsgs(await loadMessages(open.id)); refresh(); }
    else flash('error', r.error || t('Dërgimi dështoi. Provo sërish.'));
  };

  const StatusChip = ({ s }: { s: SupportTicket['status'] }) => (
    s === 'answered' ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('U përgjigj')}</span>
    : s === 'closed' ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-400">{t('Mbyllur')}</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{t('Në pritje')}</span>
  );

  const fmtT = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  /* ---- Pamja e bisedës ---- */
  if (open) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => { setOpen(null); refresh(); }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" />{t('Kthehu')}
          </button>
          <StatusChip s={open.status} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">{open.subject}</h1>
          <p className="text-[11px] text-gray-500">{t('Hapur më')} {fmtT(open.created_at)}</p>
        </div>

        <div className="space-y-2">
          {msgs.map(m => (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.sender === 'user'
              ? 'ml-auto bg-amber-500/15 border border-amber-500/30'
              : 'mr-auto bg-gray-800 border border-gray-700'}`}>
              <div className="text-[10px] font-semibold mb-0.5 flex items-center gap-1.5">
                {m.sender === 'admin'
                  ? <span className="text-sky-300 inline-flex items-center gap-1"><LifeBuoy className="w-3 h-3" />{t('Suporti')}</span>
                  : <span className="text-amber-300">{t('Ti')}</span>}
                <span className="text-gray-500 font-normal">{fmtT(m.created_at)}</span>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </div>

        {open.status !== 'closed' ? (
          <div className="flex gap-2 items-end">
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2}
              placeholder={t('Shkruaj përgjigjen…')}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 resize-none" />
            <button onClick={submitReply} disabled={busy || !reply.trim()}
              className="p-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-500 text-center">{t('Kjo bisedë është mbyllur. Hap një biletë të re nëse ke pyetje tjetër.')}</p>
        )}
        {note && <div className={`text-sm rounded-xl px-3 py-2 ${note.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>{note.text}</div>}
      </div>
    );
  }

  /* ---- Lista + formulari ---- */
  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <LifeBuoy className="w-6 h-6 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t('Suporti')}</h1>
          <p className="text-gray-400 text-sm">{t('Shkruaj ekipit tonë — përgjigjemi këtu, brenda platformës.')}</p>
        </div>
      </div>

      <a href={`mailto:${SUPPORT_EMAIL}`}
        className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-sky-500/40 transition-colors">
        <Mail className="w-4 h-4 text-sky-400" />
        {t('Email zyrtar:')} <span className="text-sky-300 font-semibold">{SUPPORT_EMAIL}</span>
      </a>

      {note && <div className={`text-sm rounded-xl px-3 py-2 ${note.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>{note.text}</div>}

      {!showNew ? (
        <button onClick={() => setShowNew(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" />{t('Mesazh i ri për suportin')}
        </button>
      ) : (
        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120}
            placeholder={t('Tema (p.sh. Problem me pagesën)')}
            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500" />
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} maxLength={5000}
            placeholder={t('Përshkruaje problemin ose pyetjen sa më qartë…')}
            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 resize-none" />
          <div className="flex gap-2">
            <button onClick={submitNew} disabled={busy || !subject.trim() || !body.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Dërgo')}
            </button>
            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 text-sm">{t('Anulo')}</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">{t('Ende s\'ke asnjë bisedë me suportin.')}</p>
        ) : tickets.map(tk => (
          <button key={tk.id} onClick={() => openTicket(tk)}
            className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${tk.unread_by_user
              ? 'bg-sky-500/[0.07] border-sky-500/40 hover:bg-sky-500/[0.12]'
              : 'bg-gray-900 border-gray-800 hover:border-gray-700'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white truncate flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-gray-500 shrink-0" />{tk.subject}
                {tk.unread_by_user && <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />}
              </span>
              <StatusChip s={tk.status} />
            </div>
            <div className="text-[11px] text-gray-500 mt-1">{fmtT(tk.last_msg_at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
