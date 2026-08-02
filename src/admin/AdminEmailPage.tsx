import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Key, Save, Send, Loader2, CheckCircle2, XCircle, RefreshCw, Eye, Plus, Trash2,
  AlertTriangle, ExternalLink, Inbox, FileText, Image as ImageIcon, Upload, Lock, X,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  loadEmailConfig, saveEmailConfig, setResendKey, loadEmailStatus, loadEmailLog, sendTestEmail,
  loadTemplates, saveTemplate, createTemplate, deleteTemplate, previewTemplate, uploadLogo,
  DEFAULT_EMAIL_CONFIG, type EmailConfig, type EmailStatus, type EmailLogRow, type EmailTemplate,
} from '../services/email';

// FAQJA "EMAIL" — lidhja me Resend, marka, modelet e redaktueshme dhe regjistri i dërgimeve.
// Çelësi VENDOSET këtu por nuk LEXOHET kurrë nga klienti (shihen vetëm 4 shenjat e fundit).

type Tab = 'connection' | 'templates' | 'log';

// Variablat që zëvendësohen brenda modeleve — shfaqen si ndihmë te redaktori.
const VARS: { v: string; d: string }[] = [
  { v: '{{name}}', d: 'Emri i përdoruesit' },
  { v: '{{brand}}', d: 'Emri i platformës' },
  { v: '{{code}}', d: 'Kodi i verifikimit' },
  { v: '{{link}}', d: 'Lidhja (fjalëkalimi)' },
  { v: '{{plan}}', d: 'Plani i abonimit' },
  { v: '{{amount}}', d: 'Shuma e paguar' },
  { v: '{{start}}', d: 'Data e fillimit' },
  { v: '{{expires}}', d: 'Data e skadimit' },
  { v: '{{invoice}}', d: 'Referenca e pagesës' },
  { v: '{{site}}', d: 'Adresa e platformës' },
  { v: '{{support}}', d: 'Email-i i suportit' },
];

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function AdminEmailPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('connection');

  const [cfg, setCfg] = useState<EmailConfig>(DEFAULT_EMAIL_CONFIG);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [log, setLog] = useState<EmailLogRow[]>([]);
  const [tpls, setTpls] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [key, setKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Redaktori i modelit
  const [edit, setEdit] = useState<EmailTemplate | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [neu, setNeu] = useState({ key: '', name: '', subject: '', body: '' });

  const refresh = useCallback(async () => {
    setBusy(true);
    const [c, s, l, tp] = await Promise.all([loadEmailConfig(), loadEmailStatus(), loadEmailLog(100), loadTemplates()]);
    setCfg(c); setStatus(s); setLog(l); setTpls(tp);
    setBusy(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 4500);
  };

  const saveKey = async () => {
    if (!key.trim()) return;
    try { await setResendKey(key.trim()); setKey(''); await refresh(); flash('success', t('Çelësi u ruajt.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const saveField = async (patch: Partial<EmailConfig>) => {
    try { await saveEmailConfig(patch); flash('success', t('U ruajt.')); }
    catch (e) { flash('error', (e as Error).message); refresh(); }
  };

  const pickLogo = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1024 * 1024) { flash('error', t('Logoja duhet të jetë nën 1 MB.')); return; }
    setLogoBusy(true);
    try {
      const url = await uploadLogo(f);
      setCfg((p) => ({ ...p, logo_url: url }));
      await saveEmailConfig({ logo_url: url });
      flash('success', t('Logoja u ngarkua.'));
    } catch (e) { flash('error', (e as Error).message); }
    setLogoBusy(false);
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

  const doSaveTemplate = async () => {
    if (!edit) return;
    setEditBusy(true);
    try {
      await saveTemplate(edit.id, { name: edit.name, subject: edit.subject, body: edit.body, enabled: edit.enabled });
      await refresh(); setEdit(null); flash('success', t('Modeli u ruajt.'));
    } catch (e) { flash('error', (e as Error).message); }
    setEditBusy(false);
  };

  const doPreview = async (k: string) => {
    setPreview('');
    const r = await previewTemplate(k);
    if (r.ok && r.html) setPreview(r.html);
    else { setPreview(null); flash('error', r.error || t('Parapamja dështoi.')); }
  };

  const doAdd = async () => {
    const k = neu.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!k || !neu.name.trim() || !neu.subject.trim()) { flash('error', t('Plotëso çelësin, emrin dhe subjektin.')); return; }
    try {
      await createTemplate({ key: k, name: neu.name.trim(), subject: neu.subject.trim(), body: neu.body });
      setAdding(false); setNeu({ key: '', name: '', subject: '', body: '' });
      await refresh(); flash('success', t('Modeli u shtua.'));
    } catch (e) { flash('error', (e as Error).message); }
  };

  const doDelete = async (tp: EmailTemplate) => {
    if (!confirm(t('Të fshihet modeli "{name}"?', { name: tp.name }))) return;
    try { await deleteTemplate(tp.id); await refresh(); flash('success', t('Modeli u fshi.')); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'connection', label: t('Lidhja & Marka'), icon: Key },
    { id: 'templates', label: t('Modelet'), icon: FileText },
    { id: 'log', label: t('Regjistri'), icon: Inbox },
  ];

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

      {/* Statusi */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className={`text-sm font-bold flex items-center gap-1.5 ${status?.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
            {status?.configured ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {status?.configured ? t('E lidhur') : t('Pa çelës')}
          </div>
          <div className="text-[10px] text-gray-500 mt-1">{status?.last4 ? `••••${status.last4}` : t('Vendos çelësin e Resend')}</div>
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
          <div className="text-2xl font-bold text-sky-400">{tpls.length}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t('Modele')}</div>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
                tab === x.id ? 'bg-amber-500 border-amber-400 text-gray-950'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
              <Icon className="w-3.5 h-3.5" />{x.label}
            </button>
          );
        })}
      </div>

      {/* ============ LIDHJA & MARKA ============ */}
      {tab === 'connection' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />{t('Çelësi i Resend')}
            </h2>
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
            <p className="text-[10px] text-gray-600 flex items-start gap-1.5">
              <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {t('Çelësi ruhet i mbyllur në server — as kjo faqe nuk e lexon dot më pas, shfaqen vetëm 4 shenjat e fundit.')}
            </p>
          </div>

          {/* Logoja */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-400" />{t('Logoja në krye të email-it')}
            </h2>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="rounded-xl border border-gray-700 bg-[#0a1526] p-4 flex items-center justify-center min-w-[170px] min-h-[80px]">
                {cfg.logo_url
                  ? <img src={cfg.logo_url} alt="" className="max-h-14 max-w-[150px] object-contain" />
                  : (
                    <div className="text-center">
                      <div className="text-lg font-extrabold leading-none">
                        <span className="text-amber-400">GoldSniper</span><span className="text-white">FX</span>
                      </div>
                      <div className="text-[7px] text-gray-500 font-bold tracking-[0.25em] uppercase mt-1">Telegram Trading Platform</div>
                    </div>
                  )}
              </div>
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => pickLogo(e.target.files?.[0])} />
                <button onClick={() => fileRef.current?.click()} disabled={logoBusy}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 hover:bg-sky-500/25 disabled:opacity-50">
                  {logoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{t('Ngarko logon')}
                </button>
                {cfg.logo_url && (
                  <button onClick={() => { setCfg({ ...cfg, logo_url: '' }); saveField({ logo_url: '' }); }}
                    className="block text-[11px] text-gray-500 hover:text-red-400">{t('Hiqe logon')}</button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-gray-600">
              {t('PNG me sfond të tejdukshëm, nën 1 MB. Pa logo shfaqet emri i platformës i shkruar me stil — dhe kjo duket gjithmonë, edhe kur klienti i email-it i bllokon fotot.')}
            </p>
          </div>

          {/* Dërguesi + marka */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-white font-bold text-sm">{t('Dërguesi dhe marka')}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {([
                ['brand_name', 'Emri i platformës'],
                ['from_name', 'Emri i dërguesit'],
                ['from_email', 'Email-i i dërguesit'],
                ['reply_to', 'Përgjigjet shkojnë te'],
                ['footer_note', 'Shënimi në fund'],
              ] as Array<[keyof EmailConfig, string]>).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t(label)}</label>
                  <input value={String(cfg[k] ?? '')}
                    onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                    onBlur={(e) => saveField({ [k]: e.target.value })}
                    className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t('Shënimi ligjor (fundi i çdo email-i)')}</label>
              <textarea value={cfg.legal_note} rows={4}
                onChange={(e) => setCfg({ ...cfg, legal_note: e.target.value })}
                onBlur={(e) => saveField({ legal_note: e.target.value })}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-[12px] text-white leading-relaxed focus:outline-none focus:border-amber-500" />
            </div>
            <p className="text-[10px] text-gray-600">
              {t('Email-i i dërguesit duhet të jetë në një domen të verifikuar te Resend, përndryshe dërgimi refuzohet.')}
            </p>
          </div>

          {/* Prova */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <Send className="w-4 h-4 text-sky-400" />{t('Dërgo një provë')}
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="email@shembull.com"
                className="flex-1 bg-black/30 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500" />
              <button onClick={runTest} disabled={testing || !testTo.trim()}
                className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 hover:bg-sky-500/25 disabled:opacity-50">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('Dërgo')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODELET ============ */}
      {tab === 'templates' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-gray-400 max-w-lg">
              {t('Çdo email që largohet nga platforma vjen nga një model këtu. Ndryshimet zbatohen menjëherë, pa rilëshim.')}
            </p>
            <button onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25">
              <Plus className="w-3.5 h-3.5" />{t('Model i ri')}
            </button>
          </div>

          {tpls.map((tp) => (
            <div key={tp.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{tp.name}</span>
                    <code className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{tp.key}</code>
                    {tp.is_system && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300">{t('SISTEM')}</span>
                    )}
                    {!tp.enabled && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-600/30 text-gray-400">{t('I FIKUR')}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 truncate">{tp.subject}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer mr-1">
                    <input type="checkbox" checked={tp.enabled} className="w-3.5 h-3.5 accent-amber-500"
                      onChange={async (e) => {
                        try { await saveTemplate(tp.id, { enabled: e.target.checked }); refresh(); }
                        catch (err) { flash('error', (err as Error).message); }
                      }} />
                    {t('Aktiv')}
                  </label>
                  <button onClick={() => doPreview(tp.key)} title={t('Parapamje')}
                    className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEdit({ ...tp })} title={t('Ndrysho')}
                    className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-amber-400"><FileText className="w-3.5 h-3.5" /></button>
                  {!tp.is_system && (
                    <button onClick={() => doDelete(tp)} title={t('Fshi')}
                      className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============ REGJISTRI ============ */}
      {tab === 'log' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
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
                  {tpls.find((x) => x.key === r.template)?.name || r.template}
                </span>
                <span className="text-[11px] text-gray-400 truncate">{r.to_email}</span>
                <span className="text-[10px] text-gray-500 ml-auto">{fmtWhen(r.created_at)}</span>
              </div>
              <p className="text-[11px] text-gray-400 truncate">{r.subject}</p>
              {r.error && <p className="text-[10px] text-red-400 mt-0.5">{r.error}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ============ REDAKTORI ============ */}
      {edit && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl p-5 my-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-white font-bold">{edit.name}</h3>
              <button onClick={() => setEdit(null)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t('Emri i modelit')}</label>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t('Subjekti')}</label>
              <input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t('Teksti')}</label>
              <textarea value={edit.body} rows={14}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-[12px] text-white font-mono leading-relaxed focus:outline-none focus:border-amber-500" />
            </div>

            <div className="rounded-xl bg-black/25 border border-white/5 p-3 space-y-2">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{t('Si shkruhet')}</p>
              <ul className="text-[11px] text-gray-500 space-y-0.5">
                <li>{t('Rreshti bosh ndan paragrafët.')}</li>
                <li><code className="text-amber-400">**tekst**</code> — {t('tekst i trashë')}</li>
                <li><code className="text-amber-400">[button]Etiketa|{'{{site}}'}[/button]</code> — {t('buton i artë')}</li>
                <li><code className="text-amber-400">[code]{'{{code}}'}[/code]</code> — {t('kutia e madhe e kodit')}</li>
                <li><code className="text-amber-400">[rows]Emri|Vlera[/rows]</code> — {t('tabelë detajesh (një çift për rresht)')}</li>
              </ul>
              <div className="flex flex-wrap gap-1 pt-1">
                {VARS.map((x) => (
                  <button key={x.v} title={t(x.d)}
                    onClick={() => setEdit({ ...edit, body: edit.body + x.v })}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20">
                    {x.v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => doPreview(edit.key)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
                <Eye className="w-4 h-4" />{t('Parapamje')}
              </button>
              <button onClick={doSaveTemplate} disabled={editBusy}
                className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
                {editBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODEL I RI ============ */}
      {adding && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl p-5 my-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-white font-bold">{t('Model i ri')}</h3>
              <button onClick={() => setAdding(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {([['key', 'Çelësi (pa hapësira)'], ['name', 'Emri'], ['subject', 'Subjekti']] as Array<[keyof typeof neu, string]>).map(([k, label]) => (
              <div key={k}>
                <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t(label)}</label>
                <input value={neu[k]} onChange={(e) => setNeu({ ...neu, [k]: e.target.value })}
                  className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">{t('Teksti')}</label>
              <textarea value={neu.body} rows={8} onChange={(e) => setNeu({ ...neu, body: e.target.value })}
                className="w-full bg-black/30 border border-gray-700 rounded-xl px-3 py-2 text-[12px] text-white font-mono focus:outline-none focus:border-amber-500" />
            </div>
            <p className="text-[10px] text-gray-600">
              {t('Modelet e reja nuk dërgohen vetë — thirren nga kodi me çelësin e tyre. Përdori për njoftime që i dërgon me dorë.')}
            </p>
            <div className="flex justify-end">
              <button onClick={doAdd}
                className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950">
                <Plus className="w-4 h-4" />{t('Shto')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ PARAPAMJA ============ */}
      {preview !== null && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl my-6">
            <div className="flex justify-end mb-2">
              <button onClick={() => setPreview(null)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
                <X className="w-4 h-4" />{t('Mbyll')}
              </button>
            </div>
            {preview === '' ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
            ) : (
              <iframe title="preview" srcDoc={preview} sandbox=""
                className="w-full h-[70vh] rounded-2xl border border-gray-700 bg-white" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
