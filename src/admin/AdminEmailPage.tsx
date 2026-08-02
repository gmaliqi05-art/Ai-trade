import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Key, Save, Send, Loader2, CheckCircle2, XCircle, RefreshCw,
  AlertTriangle, ExternalLink, Inbox,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  loadEmailConfig, saveEmailConfig, setResendKey, loadEmailStatus, loadEmailLog, sendTestEmail,
  DEFAULT_EMAIL_CONFIG, type EmailConfig, type EmailStatus, type EmailLogRow,
} from '../services/email';

// FAQJA "EMAIL" — lidhja me Resend dhe mbikëqyrja e çdo email-i që largohet nga platforma.
// Çelësi VENDOSET këtu por nuk LEXOHET kurrë nga klienti (shihen vetëm 4 shenjat e fundit).

const TEMPLATE_LABEL: Record<string, string> = {
  verify: 'Kodi i verifikimit',
  reset: 'Rivendosje fjalëkalimi',
  welcome: 'Mirëseardhje',
  billing: 'Konfirmim abonimi',
  expiry: 'Kujtesë skadimi',
  test: 'Provë',
};

const TOGGLES: { key: keyof EmailConfig; label: string; hint: string }[] = [
  { key: 'send_verify', label: 'Kodi i verifikimit', hint: 'Dërgohet automatikisht pas regjistrimit.' },
  { key: 'send_reset', label: 'Rivendosje fjalëkalimi', hint: 'Lidhja e sigurt kur përdoruesi harron fjalëkalimin.' },
  { key: 'send_welcome', label: 'Mirëseardhje', hint: 'Pasi llogaria verifikohet me sukses.' },
  { key: 'send_billing', label: 'Konfirmim abonimi', hint: 'Plani, shuma dhe afatet pas pagesës.' },
  { key: 'send_expiry', label: 'Kujtesë skadimi', hint: '7 ditë para se të skadojë abonimi.' },
];

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function AdminEmailPage() {
  const { t } = useI18n();

  const [cfg, setCfg] = useState<EmailConfig>(DEFAULT_EMAIL_CONFIG);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [log, setLog] = useState<EmailLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [key, setKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    const [c, s, l] = await Promise.all([loadEmailConfig(), loadEmailStatus(), loadEmailLog(100)]);
    setCfg(c); setStatus(s); setLog(l);
    setBusy(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 4000);
  };

  const saveKey = async () => {
    if (!key.trim()) return;
    try { await setResendKey(key.trim()); setKey(''); await refresh(); flash('success', t('Çelësi u ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const saveCfg = async (patch: Partial<EmailConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try { await saveEmailConfig(patch); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); refresh(); }
  };

  const runTest = async () => {
    if (!testTo.trim()) return;
    setTesting(true);
    const r = await sendTestEmail(testTo.trim());
    setTesting(false);
    if (r.ok) flash('success', t('Email-i i provës u dërgua.'));
    else flash('error', r.error || t('Dërgimi dështoi.'));
    refresh();
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-white font-bold text-lg flex items-center gap-2">
            <Mail className="w-5 h-5 text-amber-400" />{t('Email (Resend)')}
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {t('Kodet e verifikimit, rivendosja e fjalëkalimit dhe njoftimet e abonimit dërgohen nga këtu.')}
          </p>
        </div>
        <button onClick={refresh} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${msg.type === 'success'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>{msg.text}</div>
      )}

      {/* Statusi i lidhjes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className={`text-sm font-bold flex items-center gap-1.5 ${status?.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
            {status?.configured ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {status?.configured ? t('E lidhur') : t('Pa çelës')}
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            {status?.last4 ? `••••${status.last4}` : t('Vendos çelësin e Resend')}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="text-2xl font-bold text-emerald-400">{status?.sent_7d ?? 0}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t('Dërguar (7 ditë)')}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="text-2xl font-bold text-red-400">{status?.failed_7d ?? 0}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t('Dështuar (7 ditë)')}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="text-2xl font-bold text-sky-400">{log.length}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t('Në regjistër')}</div>
        </div>
      </div>

      {/* Çelësi i Resend */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />{t('Çelësi i Resend')}
        </h2>
        <ol className="text-[11px] text-gray-400 space-y-1 list-decimal list-inside">
          <li>{t('Hap resend.com dhe krijo llogari me email-in tënd.')}</li>
          <li>{t('Te "Domains" shto goldsniper.vip dhe vendos regjistrimet DNS që të jep Resend (SPF/DKIM) te GoDaddy.')}</li>
          <li>{t('Te "API Keys" krijo një çelës të ri me leje "Sending access".')}</li>
          <li>{t('Ngjite çelësin këtu poshtë dhe ruaje.')}</li>
        </ol>
        <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300">
          <ExternalLink className="w-3 h-3" />{t('Hap Resend')}
        </a>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="re_..."
            className="flex-1 bg-black/30 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500" />
          <button onClick={saveKey} disabled={!key.trim()}
            className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
            <Save className="w-4 h-4" />{t('Ruaj çelësin')}
          </button>
        </div>
        <p className="text-[10px] text-gray-600">
          {t('Çelësi ruhet i mbyllur në server — as kjo faqe nuk e lexon dot më pas, shfaqen vetëm 4 shenjat e fundit.')}
        </p>
      </div>

      {/* Dërguesi */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-white font-bold text-sm">{t('Dërguesi')}</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {([
            ['from_name', 'Emri i dërguesit'],
            ['from_email', 'Email-i i dërguesit'],
            ['reply_to', 'Përgjigjet shkojnë te'],
          ] as Array<[keyof EmailConfig, string]>).map(([k, label]) => (
            <div key={k}>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t(label)}</label>
              <input
                value={String(cfg[k] ?? '')}
                onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                onBlur={(e) => saveEmailConfig({ [k]: e.target.value }).catch(() => {})}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-600">
          {t('Email-i i dërguesit duhet të jetë në një domen të verifikuar te Resend, përndryshe dërgimi refuzohet.')}
        </p>
      </div>

      {/* Çfarë dërgohet */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
        <h2 className="text-white font-bold text-sm">{t('Çfarë dërgohet')}</h2>
        {TOGGLES.map((tg) => (
          <label key={tg.key} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] cursor-pointer">
            <input type="checkbox" checked={cfg[tg.key] !== false}
              onChange={(e) => saveCfg({ [tg.key]: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-amber-500 flex-shrink-0" />
            <span>
              <span className="block text-sm text-white font-medium">{t(tg.label)}</span>
              <span className="block text-[11px] text-gray-500">{t(tg.hint)}</span>
            </span>
          </label>
        ))}
      </div>

      {/* Prova */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          <Send className="w-4 h-4 text-sky-400" />{t('Dërgo një provë')}
        </h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
            placeholder="email@shembull.com"
            className="flex-1 bg-black/30 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500" />
          <button onClick={runTest} disabled={testing || !testTo.trim()}
            className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 hover:bg-sky-500/25 disabled:opacity-50">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Dërgo')}
          </button>
        </div>
      </div>

      {/* Regjistri */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          <Inbox className="w-4 h-4 text-gray-400" />{t('Email-et e fundit')}
        </h2>
        {log.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">{t('Asnjë email i dërguar ende.')}</p>
        ) : log.map((r) => (
          <div key={r.id} className="rounded-xl border border-white/5 bg-black/25 p-2.5">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                r.status === 'sent' ? 'bg-emerald-500/15 text-emerald-300'
                  : r.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-gray-600/30 text-gray-400'}`}>
                {r.status === 'sent' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {r.status === 'sent' ? t('Dërguar') : r.status === 'failed' ? t('Dështoi') : t('Anashkaluar')}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-300">
                {TEMPLATE_LABEL[r.template] ? t(TEMPLATE_LABEL[r.template]) : r.template}
              </span>
              <span className="text-[11px] text-gray-400 truncate">{r.to_email}</span>
              <span className="text-[10px] text-gray-500 ml-auto">{fmtWhen(r.created_at)}</span>
            </div>
            <p className="text-[11px] text-gray-400 truncate">{r.subject}</p>
            {r.error && <p className="text-[10px] text-red-400 mt-0.5">{r.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
