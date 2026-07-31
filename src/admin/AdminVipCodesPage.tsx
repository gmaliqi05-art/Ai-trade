import { useState, useEffect, useCallback } from 'react';
import { Crown, Plus, Trash2, Loader2, Check, X, RefreshCw, Power, Users, KeyRound, ShieldCheck, Inbox } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  loadVipCodes, createVipCode, updateVipCode, deleteVipCode, type VipCodeRow,
  loadVipMembers, setVipMember, setVerifiedMember, regenAccessCode,
  loadVipRequests, resolveVipRequest, type VipMember, type VipRequest,
} from '../services/vipCodes';

// Menaxhimi i kodeve VIP nga super admini: një kod global + kode të veçanta për përdorues të veçantë.
// Kodet verifikohen në server; kjo faqe është e mbrojtur me RLS (vetëm is_admin).
export default function AdminVipCodesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<VipCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNote, setNewNote] = useState('');
  const [members, setMembers] = useState<VipMember[]>([]);
  const [memLoading, setMemLoading] = useState(true);
  const [memBusy, setMemBusy] = useState<string | null>(null);
  const [memQuery, setMemQuery] = useState('');
  const [requests, setRequests] = useState<VipRequest[]>([]);
  const [reqBusy, setReqBusy] = useState<string | null>(null);

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRows(await loadVipCodes()); } catch (e) { flash('error', (e as Error).message); }
    setLoading(false);
  }, []);
  const refreshMembers = useCallback(async () => {
    setMemLoading(true);
    try { setMembers(await loadVipMembers()); } catch (e) { flash('error', (e as Error).message); }
    setMemLoading(false);
  }, []);
  const refreshRequests = useCallback(async () => {
    try { setRequests(await loadVipRequests()); } catch (e) { flash('error', (e as Error).message); }
  }, []);
  useEffect(() => { refresh(); refreshMembers(); refreshRequests(); }, [refresh, refreshMembers, refreshRequests]);

  const toggleMember = async (m: VipMember) => {
    setMemBusy(m.id);
    try { await setVipMember(m.id, !m.is_vip); await refreshMembers(); flash('success', !m.is_vip ? t('VIP u dha.') : t('VIP u hoq.')); }
    catch (e) { flash('error', (e as Error).message); }
    setMemBusy(null);
  };

  const toggleVerified = async (m: VipMember) => {
    setMemBusy(m.id);
    try { await setVerifiedMember(m.id, !m.is_verified); await refreshMembers(); flash('success', !m.is_verified ? t('U verifikua.') : t('Verifikimi u hoq.')); }
    catch (e) { flash('error', (e as Error).message); }
    setMemBusy(null);
  };

  const regen = async (m: VipMember) => {
    setMemBusy(m.id);
    try { const code = await regenAccessCode(m.id); await refreshMembers(); flash('success', t('Kodi i ri: {code}', { code })); }
    catch (e) { flash('error', (e as Error).message); }
    setMemBusy(null);
  };

  const resolveReq = async (r: VipRequest, decision: 'approve' | 'reject') => {
    setReqBusy(r.id);
    try { await resolveVipRequest(r.id, decision); await Promise.all([refreshRequests(), refreshMembers()]); flash('success', decision === 'approve' ? t('Kërkesa u aprovua — VIP u dha.') : t('Kërkesa u refuzua.')); }
    catch (e) { flash('error', (e as Error).message); }
    setReqBusy(null);
  };

  const add = async () => {
    if (!newCode.trim()) { flash('error', t('Shkruaj një kod.')); return; }
    setBusy('add');
    try {
      await createVipCode(newCode, newLabel, newNote);
      setNewCode(''); setNewLabel(''); setNewNote('');
      flash('success', t('Kodi u shtua.'));
      await refresh();
    } catch (e) { flash('error', (e as Error).message); }
    setBusy(null);
  };

  const toggle = async (r: VipCodeRow) => {
    setBusy(r.id);
    try { await updateVipCode(r.id, { active: !r.active }); await refresh(); }
    catch (e) { flash('error', (e as Error).message); }
    setBusy(null);
  };

  const remove = async (r: VipCodeRow) => {
    if (!confirm(t('Të fshihet kodi "{code}"?', { code: r.code }))) return;
    setBusy(r.id);
    try { await deleteVipCode(r.id); await refresh(); flash('success', t('Kodi u fshi.')); }
    catch (e) { flash('error', (e as Error).message); }
    setBusy(null);
  };

  const saveField = async (id: string, patch: Partial<VipCodeRow>) => {
    try { await updateVipCode(id, patch); await refresh(); }
    catch (e) { flash('error', (e as Error).message); }
  };

  const inp = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Crown className="w-5 h-5 text-amber-400" />{t('Kodet VIP')}</h2>
        <button onClick={refresh} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
          <RefreshCw className="w-3.5 h-3.5" />{t('Rifresko')}
        </button>
      </div>
      <p className="text-xs text-gray-500">{t('Kodet zhbllokojnë faqet VIP në menu. Verifikohen në server — nuk ekspozohen kurrë te klienti. Krijo një kod global ose kode të veçanta për përdorues të veçantë (te "Etiketa" shkruaj kujt i takon).')}</p>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>}

      {/* KËRKESAT PËR VIP — përdoruesit dërgojnë kërkesë nga menu; admini aprovon/refuzon. */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <Inbox className="w-4 h-4 text-amber-400" />{t('Kërkesat për VIP')}
            {requests.filter(r => r.status === 'pending').length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{requests.filter(r => r.status === 'pending').length}</span>
            )}
          </div>
          <button onClick={refreshRequests} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"><RefreshCw className="w-3.5 h-3.5" />{t('Rifresko')}</button>
        </div>
        {requests.filter(r => r.status === 'pending').length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-3">{t('S\'ka kërkesa në pritje.')}</p>
        ) : (
          <div className="space-y-1.5">
            {requests.filter(r => r.status === 'pending').map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-gray-800/40 rounded-lg px-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className="text-white truncate">{r.email}</span>
                  <span className="block text-[10px] text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => resolveReq(r, 'approve')} disabled={reqBusy === r.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40">
                    {reqBusy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />}{t('Aprovo VIP')}
                  </button>
                  <button onClick={() => resolveReq(r, 'reject')} disabled={reqBusy === r.id} title={t('Refuzo')}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-40"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ANËTARËT VIP — jepi/hiqi privilegjin direkt (pa kod; useri është i loguar). */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><Users className="w-4 h-4 text-amber-400" />{t('Përdoruesit — verifikimi & VIP')}</div>
          <button onClick={refreshMembers} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"><RefreshCw className="w-3.5 h-3.5" />{t('Rifresko')}</button>
        </div>
        <p className="text-xs text-gray-500">{t('Kodi 6-shifror i qasjes gjenerohet vetë kur useri regjistrohet — jepja userit që ta verifikojë llogarinë (të hapë tregtimin). VIP jepet veçmas: butoni VIP i shfaqet në menu dhe faqet VIP hapen vetë — pa kod.')}</p>
        <input value={memQuery} onChange={e => setMemQuery(e.target.value)} placeholder={t('Kërko me email…')} className={`${inp} w-full text-xs`} />
        {memLoading ? (
          <div className="h-24 bg-gray-800 rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {members.filter(m => !memQuery.trim() || m.email.toLowerCase().includes(memQuery.trim().toLowerCase())).map(m => (
              <div key={m.id} className="bg-gray-800/40 rounded-lg px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0 text-sm flex-wrap">
                    <span className="text-white truncate">{m.email}</span>
                    {m.is_admin && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 shrink-0">ADMIN</span>}
                    {m.is_vip && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 shrink-0">VIP</span>}
                    {!m.is_admin && (m.is_verified
                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 shrink-0">{t('VERIFIKUAR')}</span>
                      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 shrink-0">{t('PA VERIFIKUAR')}</span>)}
                  </span>
                  <button onClick={() => toggleMember(m)} disabled={memBusy === m.id || m.is_admin} title={m.is_admin ? t('Admin — gjithmonë ka qasje') : m.is_vip ? t('Hiq VIP') : t('Jep VIP')}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 ${m.is_vip ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25' : 'bg-gray-700/50 text-gray-300 border border-gray-600 hover:bg-gray-700'}`}>
                    {memBusy === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : m.is_vip ? <X className="w-3.5 h-3.5" /> : <Crown className="w-3.5 h-3.5" />}
                    {m.is_vip ? t('Hiq VIP') : t('Jep VIP')}
                  </button>
                </div>
                {!m.is_admin && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <KeyRound className="w-3.5 h-3.5 text-amber-400/70" />
                      <span className="text-gray-500">{t('Kodi i qasjes')}:</span>
                      <span className="font-mono font-bold text-white tracking-widest">{m.access_code || '——————'}</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => regen(m)} disabled={memBusy === m.id} title={t('Rigjenero kodin')}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-gray-700/50 text-gray-300 border border-gray-600 hover:bg-gray-700 disabled:opacity-40">
                        <RefreshCw className="w-3 h-3" />{t('Kod i ri')}
                      </button>
                      <button onClick={() => toggleVerified(m)} disabled={memBusy === m.id} title={m.is_verified ? t('Hiq verifikimin') : t('Verifiko manualisht')}
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border disabled:opacity-40 ${m.is_verified ? 'bg-gray-700/50 text-gray-300 border-gray-600 hover:bg-gray-700' : 'bg-green-500/15 text-green-300 border-green-500/30 hover:bg-green-500/25'}`}>
                        <ShieldCheck className="w-3 h-3" />{m.is_verified ? t('Hiq') : t('Verifiko')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {members.length === 0 && <p className="text-gray-600 text-sm text-center py-4">{t('S\'ka përdorues.')}</p>}
          </div>
        )}
      </div>

      {/* Shto kod të ri */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-semibold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400" />{t('Shto kod të ri')}</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder={t('Kodi (p.sh. VIP-ARDIT-2026)')} className={inp} />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder={t('Etiketa (kujt i takon)')} className={inp} />
          <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder={t('Shënim (opsional)')} className={inp} />
        </div>
        <button onClick={add} disabled={busy === 'add'} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 disabled:opacity-50">
          {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{t('Shto kodin')}
        </button>
      </div>

      {/* Lista e kodeve */}
      {loading ? (
        <div className="h-32 bg-gray-800 rounded-2xl animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-6">{t('Ende s\'ka kode. Shto një më lart.')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className={`bg-gray-900 border rounded-xl p-3 ${r.active ? 'border-gray-800' : 'border-gray-800 opacity-60'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${r.active ? 'bg-green-500/15 text-green-300' : 'bg-gray-700/50 text-gray-400'}`}>{r.active ? 'ON' : 'OFF'}</span>
                  <input defaultValue={r.code} key={`c-${r.id}-${r.code}`} onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.code) saveField(r.id, { code: v }); }}
                    className="bg-transparent border-b border-gray-700 text-white font-mono text-sm px-1 focus:outline-none focus:border-amber-500" />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => toggle(r)} disabled={busy === r.id} title={r.active ? t('Çaktivizo') : t('Aktivizo')}
                    className={`p-1.5 rounded-lg ${r.active ? 'text-green-400 hover:bg-green-500/10' : 'text-gray-500 hover:bg-gray-800'}`}>
                    {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                  </button>
                  <button onClick={() => remove(r)} disabled={busy === r.id} title={t('Fshi')} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <input defaultValue={r.label ?? ''} key={`l-${r.id}-${r.label}`} onBlur={e => { const v = e.target.value.trim(); if (v !== (r.label ?? '')) saveField(r.id, { label: v || null }); }}
                  placeholder={t('Etiketa (kujt i takon)')} className={`${inp} text-xs`} />
                <input defaultValue={r.note ?? ''} key={`n-${r.id}-${r.note}`} onBlur={e => { const v = e.target.value.trim(); if (v !== (r.note ?? '')) saveField(r.id, { note: v || null }); }}
                  placeholder={t('Shënim')} className={`${inp} text-xs`} />
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><Check className="w-3 h-3" />{t('Përdorur')}: {r.uses}</span>
                {r.last_used_at && <span>{t('Fundit')}: {new Date(r.last_used_at).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
