import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Handshake, Plus, Save, Trash2, Loader2, RefreshCw, ExternalLink, Info, Check,
  Power, PowerOff, Star, ClipboardCheck, Users, Landmark, Percent, ShieldCheck,
  Eye, StickyNote, Search, AlertTriangle, Link2,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  loadBrokers, saveBroker, deleteBroker, loadBrokerUsers, setReferral,
  DEFAULT_DISCLOSURE, type BrokerPartner, type BrokerUserRow, type ChecklistItem,
} from '../services/brokers';

/* PARTNERITETET ME BROKERËT — konsola e Super Adminit.
 *
 * Kërkesa e pronarit (4 gusht 2026): një vend i vetëm ku përgatitet dhe mbahet marrëveshja me
 * brokerin (Vantage i pari), me gjithçka që duhet — jo vetëm një link referimi.
 *
 * Faqja ndahet në tri pjesë, sipas rendit në të cilin puna ndodh vërtet:
 *
 *   1) MARRËVESHJA  — çfarë kemi rënë dakord: programi, kushtet, rregullat, transparenca.
 *   2) PYETJET      — çfarë duhet pyetur BRENDA se të nënshkruajmë. Shifra e reklamës ("deri $8/lot")
 *                     nuk është kontratë; kontratë është përgjigjja me shkrim. Prandaj çdo pyetje ka
 *                     vendin e vet për përgjigjen, dhe asnjëra nuk humbet nëpër biseda.
 *   3) PËRDORUESIT  — kush është te cili broker, sa lot ka tregtuar, dhe sa rebate pritet prej tij.
 *
 * DY GJËRA QË DUHEN THËNË HAPUR, dhe që janë ndërtuar brenda faqes:
 *
 *   • ATRIBUIMI. Portali i brokerit raporton sipas NUMRIT MT5, jo sipas 'account_id' të MetaApi-t.
 *     Prandaj platforma tani e ruan atë numër (te CHECK-u i lidhjes) dhe kolona "Llogaria MT" këtu
 *     është ura mes dy raporteve. Pa të, lista e rebate-it mbetet numra pa pronarë.
 *
 *   • KONFLIKTI. Rebate-i paguhet PËR LOT — pra platforma fiton më shumë kur hapen më shumë
 *     pozicione, pavarësisht nëse përdoruesi fiton apo humb. Kjo nuk zhduket duke heshtur. Fusha e
 *     transparencës është aty pikërisht për ta thënë, dhe rri e ndezur si parazgjedhje.
 */

type Tab = 'setup' | 'checklist' | 'users';

const PROGRAMS: { id: string; label: string; hint: string }[] = [
  { id: 'none',   label: 'Pa marrëveshje', hint: 'Broker i regjistruar vetëm për njohje llogarish.' },
  { id: 'ib',     label: 'IB — rebate për lot', hint: 'Të ardhura të vazhdueshme nga volumi. Për ne që ofrojmë shërbim.' },
  { id: 'cpa',    label: 'CPA — një herë për klient', hint: 'Pagesë e vetme kur klienti kualifikohet. Për marketing me klikime.' },
  { id: 'hybrid', label: 'Hybrid — CPA + rebate', hint: 'CPA më e vogël plus rebate i vazhdueshëm.' },
];

const STATUSES: { id: string; label: string; tone: string }[] = [
  { id: 'draft',    label: 'Draft',        tone: 'bg-gray-700/40 text-gray-300 border-gray-600' },
  { id: 'applied',  label: 'Aplikuar',     tone: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  { id: 'approved', label: 'Aprovuar',     tone: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
  { id: 'active',   label: 'Aktive',       tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  { id: 'paused',   label: 'Pezulluar',    tone: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  { id: 'rejected', label: 'Refuzuar',     tone: 'bg-red-500/15 text-red-300 border-red-500/40' },
];

const REF_STATUS: { id: string; label: string }[] = [
  { id: '',          label: '—' },
  { id: 'clicked',   label: 'Klikoi linkun' },
  { id: 'registered', label: 'Hapi llogari' },
  { id: 'confirmed', label: 'Konfirmuar te portali' },
  { id: 'rejected',  label: 'Nuk numërohet' },
];

const money = (n: number, c = 'USD') =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c}`;

/* FUSHAT E FORMËS — të deklaruara JASHTË komponentit, me qëllim.
 *
 * Po t'i mbaje brenda, React do t'i shihte si tipe të reja në çdo render dhe do t'i rimontonte
 * fushat sa herë shtypet një shkronjë — fokusi do të humbte pas çdo tasti. Jashtë, tipi mbetet i
 * njëjti dhe shkrimi rrjedh normalisht. */

type SetFn = (k: keyof BrokerPartner, v: unknown) => void;

function Txt({ k, label, hint, ph, wide, d, set }: {
  k: keyof BrokerPartner; label: string; hint?: string; ph?: string; wide?: boolean;
  d: BrokerPartner; set: SetFn;
}) {
  const { t } = useI18n();
  return (
    <label className={wide ? 'sm:col-span-2 block' : 'block'}>
      <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t(label)}</span>
      <input value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value)}
        placeholder={ph} spellCheck={false}
        className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50" />
      {hint && <span className="block text-[10px] text-gray-600 mt-1">{t(hint)}</span>}
    </label>
  );
}

function Num({ k, label, hint, step = '0.01', d, set }: {
  k: keyof BrokerPartner; label: string; hint?: string; step?: string;
  d: BrokerPartner; set: SetFn;
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t(label)}</span>
      <input type="number" step={step} value={Number(d[k] ?? 0)}
        onChange={(e) => set(k, Number(e.target.value) || 0)}
        className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50" />
      {hint && <span className="block text-[10px] text-gray-600 mt-1">{t(hint)}</span>}
    </label>
  );
}

function Area({ k, label, hint, rows = 3, d, set }: {
  k: keyof BrokerPartner; label: string; hint?: string; rows?: number;
  d: BrokerPartner; set: SetFn;
}) {
  const { t } = useI18n();
  return (
    <label className="sm:col-span-2 block">
      <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t(label)}</span>
      <textarea rows={rows} value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value)}
        className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-y" />
      {hint && <span className="block text-[10px] text-gray-600 mt-1">{t(hint)}</span>}
    </label>
  );
}

function Section({ icon: Icon, title, desc, children }: {
  icon: React.ElementType; title: string; desc?: string; children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div>
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <Icon className="w-4 h-4 text-amber-400" />{t(title)}
        </h3>
        {desc && <p className="text-[11px] text-gray-500 mt-1">{t(desc)}</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export default function AdminBrokersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('setup');

  const [brokers, setBrokers] = useState<BrokerPartner[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrokerPartner | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [users, setUsers] = useState<BrokerUserRow[]>([]);
  const [uLoading, setULoading] = useState(false);
  const [q, setQ] = useState('');
  const [refBusy, setRefBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setMsg(null);
    try {
      const list = await loadBrokers();
      setBrokers(list);
      setSelId((prev) => prev && list.some(b => b.id === prev) ? prev : (list[0]?.id ?? null));
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Kopja e punës: editimi bëhet lokalisht dhe shkon te baza vetëm me "Ruaj".
  useEffect(() => {
    setDraft(brokers.find(b => b.id === selId) ?? null);
    setMsg(null);
  }, [selId, brokers]);

  const loadUsers = useCallback(async () => {
    setULoading(true);
    try { setUsers(await loadBrokerUsers(90)); }
    catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
    finally { setULoading(false); }
  }, []);
  useEffect(() => { if (tab === 'users' && users.length === 0) loadUsers(); }, [tab, users.length, loadUsers]);

  const set = <K extends keyof BrokerPartner>(k: K, v: BrokerPartner[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d));

  const doSave = async () => {
    if (!draft) return;
    setBusy(true); setMsg(null);
    try {
      await saveBroker(draft);
      setMsg({ type: 'ok', text: t('U ruajt.') });
      await load();
    } catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const doCreate = async () => {
    setBusy(true); setMsg(null);
    try {
      const id = await saveBroker({ name: 'Vantage', slug: `vantage-${Date.now().toString(36)}` });
      await load(); setSelId(id); setTab('setup');
    } catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!draft) return;
    if (!confirm(t('Ta fshij këtë broker bashkë me referimet e tij? Ky veprim nuk kthehet.'))) return;
    setBusy(true);
    try { await deleteBroker(draft.id); setSelId(null); await load(); }
    catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const setChk = (i: number, patch: Partial<ChecklistItem>) =>
    setDraft(d => d ? { ...d, checklist: d.checklist.map((c, k) => k === i ? { ...c, ...patch } : c) } : d);

  const saveRef = async (r: BrokerUserRow, status: string) => {
    if (!draft) return;
    setRefBusy(r.user_id);
    try {
      await setReferral(r.user_id, draft.id, status, r.mt_login ?? undefined);
      setUsers(u => u.map(x => x.user_id === r.user_id ? { ...x, ref_status: status, broker_name: draft.name } : x));
    } catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
    finally { setRefBusy(null); }
  };

  // Norma që përdoret për vlerësim: ajo e arit ka përparësi, sepse ari është ajo që tregtohet këtu.
  const rate = draft ? (draft.rebate_gold_per_lot || draft.rebate_per_lot) : 0;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u =>
      (u.email ?? '').toLowerCase().includes(s) ||
      (u.full_name ?? '').toLowerCase().includes(s) ||
      (u.mt_login ?? '').toLowerCase().includes(s) ||
      (u.mt_server ?? '').toLowerCase().includes(s));
  }, [users, q]);
  const totals = useMemo(() => {
    const mine = filtered.filter(u => u.broker_id === draft?.id);
    const lots = mine.reduce((a, b) => a + b.lots, 0);
    return { n: mine.length, lots, rebate: lots * rate };
  }, [filtered, draft?.id, rate]);

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'setup',     label: 'Marrëveshja', icon: Handshake },
    { id: 'checklist', label: 'Pyetjet për brokerin', icon: ClipboardCheck },
    { id: 'users',     label: 'Përdoruesit', icon: Users },
  ];

  const done = draft ? draft.checklist.filter(c => c.done).length : 0;

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      {/* Ballina */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Handshake className="w-6 h-6 text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-white">{t('Brokerët — partneritetet')}</h1>
          <p className="text-xs text-gray-400">{t('Marrëveshjet IB/CPA, kushtet, dhe kush tregton te cili broker.')}</p>
        </div>
        <button onClick={load} title={t('Rifresko')}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 shrink-0">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Zgjedhja e brokerit */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {brokers.map(b => {
          const active = b.id === selId;
          return (
            <button key={b.id} onClick={() => setSelId(b.id)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                active ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-white/[0.03] text-gray-400 border-white/10 hover:text-white'}`}>
              {b.is_primary && <Star className="w-3 h-3 fill-current" />}
              {b.name}
              <span className={`w-1.5 h-1.5 rounded-full ${b.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
            </button>
          );
        })}
        <button onClick={doCreate} disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" />{t('Broker i ri')}
        </button>
      </div>

      {!draft && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-gray-400">
          {t('Ende s\'ka asnjë broker. Shtyp "Broker i ri" për të nisur me Vantage.')}
        </div>
      )}

      {draft && (
        <>
          {/* Nënfaqet */}
          <div className="flex gap-1.5 flex-wrap">
            {TABS.map(x => {
              const Icon = x.icon; const active = tab === x.id;
              return (
                <button key={x.id} onClick={() => setTab(x.id)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                    active ? 'bg-white/10 text-white border-white/20' : 'bg-transparent text-gray-500 border-transparent hover:text-gray-300'}`}>
                  <Icon className="w-3.5 h-3.5" />{t(x.label)}
                  {x.id === 'checklist' && (
                    <span className={`ml-0.5 text-[10px] font-bold px-1.5 rounded-full ${
                      done === draft.checklist.length && done > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                      {done}/{draft.checklist.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {msg && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${
              msg.type === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>{msg.text}</div>
          )}

          {/* ---------------- MARRËVESHJA ---------------- */}
          {tab === 'setup' && (
            <div className="space-y-4">
              <Section icon={Landmark} title="Identiteti dhe shfaqja"
                desc="Emri dhe linku janë ato që sheh përdoruesi. Derisa 'Aktiv' të jetë OFF, brokeri nuk shfaqet askund në platformë.">
                <Txt d={draft} set={set} k="name" label="Emri i brokerit" ph="Vantage" />
                <Txt d={draft} set={set} k="slug" label="Identifikuesi (slug)" ph="vantage" hint="Vetëm shkronja të vogla dhe viza — përdoret te linqet." />
                <Txt d={draft} set={set} k="website" label="Faqja zyrtare" ph="https://www.vantagemarkets.com" />
                <Txt d={draft} set={set} k="logo_url" label="Logoja (URL)" ph="https://…/vantage.png" />
                <Num d={draft} set={set} k="sort_order" label="Renditja" step="1" hint="Numri më i vogël del i pari." />
                <div className="flex items-end gap-2">
                  <button onClick={() => set('enabled', !draft.enabled)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                      draft.enabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                    {draft.enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    {draft.enabled ? t('Aktiv për përdoruesit') : t('Fshehur')}
                  </button>
                  <button onClick={() => set('is_primary', !draft.is_primary)}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                      draft.is_primary ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                    <Star className={`w-3.5 h-3.5 ${draft.is_primary ? 'fill-current' : ''}`} />{t('Kryesori')}
                  </button>
                </div>
              </Section>

              <Section icon={Handshake} title="Programi dhe statusi"
                desc="IB paguan për volum dhe vazhdon përjetë; CPA paguan një herë për klient. Për një platformë që ofron shërbim, IB ose Hybrid është i drejti.">
                <label className="block">
                  <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t('Programi')}</span>
                  <select value={draft.program} onChange={(e) => set('program', e.target.value as BrokerPartner['program'])}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50">
                    {PROGRAMS.map(p => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
                  </select>
                  <span className="block text-[10px] text-gray-600 mt-1">
                    {t(PROGRAMS.find(p => p.id === draft.program)?.hint ?? '')}
                  </span>
                </label>
                <label className="block">
                  <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t('Statusi i marrëveshjes')}</span>
                  <select value={draft.status} onChange={(e) => set('status', e.target.value as BrokerPartner['status'])}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50">
                    {STATUSES.map(s => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
                  </select>
                </label>
                <Txt d={draft} set={set} k="ib_code" label="Kodi / numri ynë IB" ph="p.sh. 123456" hint="Numri që të jep brokeri pas aprovimit." />
                <Txt d={draft} set={set} k="ib_link" label="Linku i referimit" ph="https://…/register?ib=123456" hint="Ky link hap llogarinë nën ne. Pa të, regjistrimi nuk numërohet." />
                <Txt d={draft} set={set} k="ib_portal_url" label="Portali i raporteve" ph="https://partners…/login" />
                <Txt d={draft} set={set} k="contract_url" label="Kontrata (URL ose vendndodhja)" />
                <Txt d={draft} set={set} k="contact_name" label="Menaxheri i partneritetit" />
                <Txt d={draft} set={set} k="contact_email" label="Email-i i tij" />
                <Txt d={draft} set={set} k="contact_phone" label="Telefoni" />
              </Section>

              <Section icon={Percent} title="Kushtet ekonomike"
                desc="Shkruaj shifrat E KONFIRMUARA me shkrim, jo ato të reklamës. Norma e arit është ajo që përdoret për vlerësimet te skeda 'Përdoruesit'.">
                <Txt d={draft} set={set} k="currency" label="Valuta" ph="USD" />
                <Num d={draft} set={set} k="rebate_per_lot" label="Rebate — i përgjithshëm ($/lot)" hint="Round-turn: 1 lot = 100.000 njësi." />
                <Num d={draft} set={set} k="rebate_gold_per_lot" label="Rebate — XAUUSD ($/lot)" hint="Kjo është norma që na intereson vërtet." />
                <Num d={draft} set={set} k="cpa_amount" label="CPA për klient" />
                <Num d={draft} set={set} k="cpa_min_deposit" label="CPA — depozita minimale" />
                <Num d={draft} set={set} k="cpa_min_lots" label="CPA — lot minimalë" />
                <div className="flex items-end">
                  <button onClick={() => set('sub_ib_enabled', !draft.sub_ib_enabled)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                      draft.sub_ib_enabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                    {draft.sub_ib_enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}{t('Sub-IB i lejuar')}
                  </button>
                </div>
                <Num d={draft} set={set} k="sub_ib_share_pct" label="Sub-IB — ndarja (%)" />
                <label className="block">
                  <span className="block text-[11px] font-semibold text-gray-300 mb-1">{t('Sa shpesh paguhet')}</span>
                  <select value={draft.payout_frequency} onChange={(e) => set('payout_frequency', e.target.value)}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50">
                    <option value="daily">{t('Çdo ditë')}</option>
                    <option value="weekly">{t('Çdo javë')}</option>
                    <option value="monthly">{t('Çdo muaj')}</option>
                  </select>
                </label>
                <Num d={draft} set={set} k="payout_min" label="Minimumi i tërheqjes" />
                <Txt d={draft} set={set} k="payout_method" label="Mënyra e pagesës" ph="Bankë / kripto / …" wide />
              </Section>

              <Section icon={ShieldCheck} title="Rregullat dhe pajtueshmëria"
                desc="Emrat e serverëve janë fusha më praktike këtu: prej tyre platforma njeh vetë se cili përdorues është te ky broker.">
                <Txt d={draft} set={set} k="entity" label="Entiteti" ph="ASIC / FCA / CIMA / VFSC" hint="Rebate-i dhe vendet e pranuara ndryshojnë sipas entitetit." />
                <Txt d={draft} set={set} k="regulator" label="Rregullatori / licenca" />
                <Txt d={draft} set={set} k="allowed_countries" label="Vendet e pranuara" ph="Kosovë, Shqipëri, Maqedoni, Gjermani, Zvicër" wide />
                <Txt d={draft} set={set} k="restricted_countries" label="Vendet e kufizuara" wide />
                <Num d={draft} set={set} k="min_deposit" label="Depozita minimale" />
                <Txt d={draft} set={set} k="account_types" label="Llojet e llogarive" ph="Standard, RAW, ECN" />
                <Txt d={draft} set={set} k="server_names" label="Emrat e serverëve MT4/MT5" wide
                  ph="VantageInternational-Live, VantageInternational-Demo"
                  hint="Me presje. Përputhja bëhet me pjesë të emrit — mjafton pjesa dalluese." />
                <Area d={draft} set={set} k="marketing_rules" label="Kufizimet e marketingut sipas kontratës"
                  hint="P.sh. ndalimi i premtimeve të fitimit, kushtet për reklama të paguara, përdorimi i markës." />
              </Section>

              <Section icon={Eye} title="Transparenca ndaj përdoruesve"
                desc="Rebate-i paguhet për lot — pra ne fitojmë më shumë kur hapen më shumë pozicione, pavarësisht rezultatit të përdoruesit. Ky tekst e thotë atë hapur. Përdoruesit e zbulojnë gjithsesi; më mirë ta lexojnë nga ne.">
                <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                  <button onClick={() => set('disclosure_enabled', !draft.disclosure_enabled)}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                      draft.disclosure_enabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                    {draft.disclosure_enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    {draft.disclosure_enabled ? t('Shfaqet te përdoruesit') : t('E fshehur')}
                  </button>
                  <button onClick={() => set('disclosure_text', DEFAULT_DISCLOSURE)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5">
                    <StickyNote className="w-3.5 h-3.5" />{t('Vendos tekstin e propozuar')}
                  </button>
                </div>
                <Area d={draft} set={set} k="disclosure_text" label="Teksti i deklarimit" rows={4} />
                {!draft.disclosure_enabled && (
                  <div className="sm:col-span-2 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {t('Me këtë OFF, përdoruesit nuk e dinë se ne paguhemi nga volumi i tyre. Shumica e kontratave IB e kërkojnë deklarimin — dhe pa të, besimi humbet kur e mësojnë vetë.')}
                  </div>
                )}
              </Section>

              <Section icon={StickyNote} title="Shënime të brendshme"
                desc="Nuk i sheh askush jashtë adminit.">
                <Area d={draft} set={set} k="notes" label="Shënime" rows={3} />
              </Section>

              <div className="flex flex-wrap gap-2">
                <button onClick={doSave} disabled={busy}
                  className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-amber-500 text-gray-950 hover:bg-amber-400 disabled:opacity-50">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{t('Ruaj brokerin')}
                </button>
                {draft.ib_link && (
                  <a href={draft.ib_link} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:bg-white/5">
                    <ExternalLink className="w-3.5 h-3.5" />{t('Provo linkun')}
                  </a>
                )}
                {draft.ib_portal_url && (
                  <a href={draft.ib_portal_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:bg-white/5">
                    <Link2 className="w-3.5 h-3.5" />{t('Portali i raporteve')}
                  </a>
                )}
                <button onClick={doDelete} disabled={busy}
                  className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 sm:ml-auto">
                  <Trash2 className="w-3.5 h-3.5" />{t('Fshi')}
                </button>
              </div>
            </div>
          )}

          {/* ---------------- PYETJET ---------------- */}
          {tab === 'checklist' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.07] px-4 py-3 text-[11px] text-sky-100 flex gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-300" />
                <span>{t('Këto janë pyetjet që përcaktojnë nëse marrëveshja vlen vërtet. Kërkoji përgjigjet ME SHKRIM para se të nënshkruash — shifrat e faqes së reklamës janë maksimume, jo premtime. Shkruaji përgjigjet këtu që të mos humbin.')}</span>
              </div>

              {draft.checklist.map((c, i) => (
                <div key={c.id} className={`rounded-xl border p-3 transition-colors ${
                  c.done ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex items-start gap-2.5">
                    <button onClick={() => setChk(i, { done: !c.done })}
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        c.done ? 'bg-emerald-500 border-emerald-500 text-gray-950' : 'border-gray-600 text-transparent hover:border-gray-500'}`}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs leading-relaxed ${c.done ? 'text-gray-400' : 'text-white'}`}>{t(c.q)}</p>
                      <textarea rows={2} value={c.a} onChange={(e) => setChk(i, { a: e.target.value })}
                        placeholder={t('Përgjigjja e brokerit…')}
                        className="mt-2 w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-y" />
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={doSave} disabled={busy}
                className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-amber-500 text-gray-950 hover:bg-amber-400 disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{t('Ruaj përgjigjet')}
              </button>
            </div>
          )}

          {/* ---------------- PËRDORUESIT ---------------- */}
          {tab === 'users' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 sm:px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{t('Te ky broker')}</div>
                  <div className="text-base sm:text-lg font-bold text-white">{totals.n}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 sm:px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{t('Lot / 90 ditë')}</div>
                  <div className="text-base sm:text-lg font-bold text-white">{totals.lots.toFixed(2)}</div>
                </div>
                {/* Shifra e rebate-it është më e gjata; valuta shkon në rresht të vet që në telefon
                    të mos e këpusë numrin. */}
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-2.5 sm:px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-amber-400/80">{t('Rebate i vlerësuar')}</div>
                  <div className="text-base sm:text-lg font-bold text-amber-300 leading-tight">
                    {totals.rebate.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    <span className="block text-[10px] font-semibold text-amber-400/70">{draft.currency}</span>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-gray-600 leading-relaxed">
                {t('Vlerësimi = lot të mbyllur × norma e arit që ke shkruar te kushtet. Është përafrim, jo faturë — e vërteta është ajo që shkruan portali i brokerit. Nëse norma nuk është plotësuar ende, shifra del 0.')}
              </p>

              <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Kërko: email, emër, numër llogarie, server…')}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50" />
                </div>
                <button onClick={loadUsers} disabled={uLoading}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50">
                  {uLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-white/10">
                      <th className="text-left font-semibold px-3 py-2">{t('Përdoruesi')}</th>
                      <th className="text-left font-semibold px-3 py-2">{t('Llogaria MT')}</th>
                      <th className="text-left font-semibold px-3 py-2">{t('Brokeri')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('Lot')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('Rebate')}</th>
                      <th className="text-left font-semibold px-3 py-2">{t('Referimi')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.user_id} className="border-b border-white/5 last:border-0">
                        <td className="px-3 py-2">
                          <div className="text-white font-medium truncate max-w-[160px]">{u.full_name || '—'}</div>
                          <div className="text-gray-500 truncate max-w-[160px]">{u.email}</div>
                        </td>
                        <td className="px-3 py-2">
                          {u.mt_login
                            ? <>
                                <div className="text-gray-200 font-mono">{u.mt_login}</div>
                                <div className="text-gray-600 truncate max-w-[150px]">{u.mt_server}</div>
                              </>
                            : <span className="text-gray-600">{t('e panjohur ende')}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-300">{u.broker_name || <span className="text-gray-600">—</span>}</td>
                        <td className="px-3 py-2 text-right text-gray-200">{u.lots.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-amber-300">
                          {u.broker_id === draft.id ? money(u.lots * rate, draft.currency) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select value={u.ref_status ?? ''} disabled={refBusy === u.user_id}
                            onChange={(e) => saveRef(u, e.target.value)}
                            className="bg-black/40 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/50 disabled:opacity-50">
                            {REF_STATUS.map(s => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && !uLoading && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">{t('Asnjë rezultat.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-gray-600 leading-relaxed">
                {t('Numri i llogarisë MT shfaqet pasi përdoruesi të testojë lidhjen te faqja e konfigurimit — atëherë e lexojmë nga brokeri dhe e ruajmë. Kolona "Brokeri" mbushet vetë kur emri i serverit përputhet me ata që ke shkruar te "Emrat e serverëve"; ndryshe mbetet bosh, sepse hamendja këtu do të ishte më keq se zbrazëtia.')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
