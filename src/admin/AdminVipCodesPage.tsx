import { useState, useEffect, useCallback } from 'react';
import { Crown, Plus, Trash2, Loader2, Check, X, RefreshCw, Power } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  loadVipCodes, createVipCode, updateVipCode, deleteVipCode, type VipCodeRow,
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

  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRows(await loadVipCodes()); } catch (e) { flash('error', (e as Error).message); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

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
