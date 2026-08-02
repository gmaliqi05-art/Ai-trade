import { useState, useEffect, useCallback } from 'react';
import { Crown, Gift, Zap, Save, Loader2, Link2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

// PLANET E ABONIMIT (Admin) — burimi i VETËM i çmimeve (billing_config).
// Çdo ndryshim këtu shfaqet MENJËHERË: te tabela e planeve pas regjistrimit,
// te Cilësimet → Abonimi i përdoruesit, DHE te pagesa reale në Stripe Checkout
// (stripe-checkout i lexon çmimet nga e njëjta tabelë) — gjithçka e sinkronizuar.
interface Form { trial_days: number; monthly_eur: number; yearly_eur: number; yearly_full_eur: number }

export default function AdminPlansPage() {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>({ trial_days: 15, monthly_eur: 69, yearly_eur: 699, yearly_full_eur: 828 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const flash = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('billing_config').select('*').eq('id', 1).maybeSingle();
    if (data) {
      const d = data as Form;
      setForm({
        trial_days: Number(d.trial_days), monthly_eur: Number(d.monthly_eur),
        yearly_eur: Number(d.yearly_eur), yearly_full_eur: Number(d.yearly_full_eur),
      });
    }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (form.yearly_full_eur < form.yearly_eur) { flash('error', t('Çmimi i plotë vjetor s\'mund të jetë më i vogël se çmimi me zbritje.')); return; }
    setSaving(true);
    const { error } = await supabase.from('billing_config').update({
      trial_days: Math.round(form.trial_days), monthly_eur: form.monthly_eur,
      yearly_eur: form.yearly_eur, yearly_full_eur: form.yearly_full_eur,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    if (error) flash('error', error.message);
    else flash('success', t('Planet u ruajtën — regjistrimi, cilësimet dhe pagesat në Stripe përdorin çmimet e reja që tani.'));
  };

  const saving_eur = Math.max(0, form.yearly_full_eur - form.yearly_eur);
  const set = (k: keyof Form, v: number) => setForm(f => ({ ...f, [k]: Number.isFinite(v) ? v : f[k] }));
  const inp = 'w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500';

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <Crown className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{t('Planet e Abonimit')}</h2>
            <p className="text-gray-500 text-xs">{t('Burimi i vetëm i çmimeve — i sinkronizuar kudo automatikisht.')}</p>
          </div>
        </div>
        <button onClick={refresh} className="p-2.5 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-4 py-3 flex gap-2.5">
        <Link2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-[12px] text-sky-200 leading-relaxed">
          {t('Çdo ndryshim këtu pasqyrohet MENJËHERË në tre vende: 1) tabela e planeve pas regjistrimit, 2) Cilësimet → Abonimi i çdo përdoruesi, 3) shuma reale që Stripe ia ngarkon kartës. S\'ka nevojë për asnjë hap tjetër.')}
        </p>
      </div>

      {msg && <div className={`text-sm rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>}

      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] text-gray-500 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5 text-emerald-400" />{t('Prova falas (ditë)')}</span>
            <input type="number" min={0} max={365} value={form.trial_days} onChange={e => set('trial_days', Number(e.target.value))} className={inp} />
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" />{t('Abonimi mujor (€)')}</span>
            <input type="number" min={0} step="1" value={form.monthly_eur} onChange={e => set('monthly_eur', Number(e.target.value))} className={inp} />
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500 flex items-center gap-1.5"><Crown className="w-3.5 h-3.5 text-amber-400" />{t('Abonimi vjetor — çmimi real (€)')}</span>
            <input type="number" min={0} step="1" value={form.yearly_eur} onChange={e => set('yearly_eur', Number(e.target.value))} className={inp} />
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500">{t('Vjetori pa zbritje — i kryqëzuar (€)')}</span>
            <input type="number" min={0} step="1" value={form.yearly_full_eur} onChange={e => set('yearly_full_eur', Number(e.target.value))} className={inp} />
          </label>
        </div>
        <button onClick={save} disabled={saving || loading}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('Ruaj planet')}
        </button>
      </section>

      {/* PARAPAMJA — si e shohin klientët me vlerat e mësipërme. */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-white font-bold text-sm mb-3">{t('Parapamja — si u shfaqet klientëve')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border-2 border-gray-700 bg-gray-950 p-3 text-center">
            <Gift className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <div className="text-white font-bold text-lg">0€</div>
            <div className="text-[10px] text-gray-500">{form.trial_days} {t('ditë')} {t('provë')}</div>
          </div>
          <div className="rounded-xl border-2 border-gray-700 bg-gray-950 p-3 text-center">
            <Zap className="w-4 h-4 text-amber-400 mx-auto mb-1" />
            <div className="text-white font-bold text-lg">{form.monthly_eur}€</div>
            <div className="text-[10px] text-gray-500">/ {t('muaj')}</div>
          </div>
          <div className="rounded-xl border-2 border-amber-500 bg-gray-950 p-3 text-center relative">
            {saving_eur > 0 && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-500 text-gray-950 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                {t('Kurse {s}€', { s: saving_eur })}
              </span>
            )}
            <Crown className="w-4 h-4 text-amber-400 mx-auto mb-1" />
            <div className="text-white font-bold text-lg">
              {form.yearly_eur}€{form.yearly_full_eur > form.yearly_eur && <span className="text-gray-500 text-xs line-through ml-1">{form.yearly_full_eur}€</span>}
            </div>
            <div className="text-[10px] text-gray-500">/ {t('vit')}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
