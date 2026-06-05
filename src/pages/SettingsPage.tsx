import { useState, useEffect } from 'react';
import { Settings, User, Shield, Bell, CreditCard, Save, Loader2, Check, ChevronRight, LogOut, Crown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

type Section = 'profile' | 'security' | 'notifications' | 'subscription';

interface NotificationPrefs { signals: boolean; priceAlerts: boolean; newsletter: boolean; tradeConfirmations: boolean; }

export default function SettingsPage() {
  const { t } = useI18n();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: profile?.full_name || '', username: profile?.username || '' });
  const [pwForm, setPwForm] = useState({ new: '', confirm: '' });
  const [notifications, setNotifications] = useState<NotificationPrefs>({ signals: true, priceAlerts: true, newsletter: false, tradeConfirmations: true });
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    if (profile) {
      setProfileForm({ full_name: profile.full_name || '', username: profile.username || '' });
      if ((profile as unknown as { notification_preferences?: NotificationPrefs }).notification_preferences) {
        setNotifications((profile as unknown as { notification_preferences: NotificationPrefs }).notification_preferences);
      }
    }
  }, [profile]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update({ full_name: profileForm.full_name, username: profileForm.username }).eq('id', user.id);
    await refreshProfile();
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const saveNotifications = async (updated: NotificationPrefs) => {
    if (!user) return;
    setNotifSaved(false);
    await supabase.from('profiles').update({ notification_preferences: updated }).eq('id', user.id);
    await refreshProfile();
    setNotifSaved(true); setTimeout(() => setNotifSaved(false), 2000);
  };

  const toggleNotification = (key: keyof NotificationPrefs) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    saveNotifications(updated);
  };

  const changePw = async () => {
    if (pwForm.new !== pwForm.confirm) { setPwMsg(t('Fjalëkalimet nuk përputhen.')); return; }
    if (pwForm.new.length < 6) { setPwMsg(t('Minimum 6 karaktere.')); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwForm.new });
    setPwMsg(error ? error.message : t('Fjalëkalimi u ndryshua!'));
    if (!error) setPwForm({ new: '', confirm: '' });
    setSaving(false);
  };

  const sections = [
    { id: 'profile' as Section, label: t('Profili'), icon: User },
    { id: 'security' as Section, label: t('Siguria'), icon: Shield },
    { id: 'notifications' as Section, label: t('Njoftimet'), icon: Bell },
    { id: 'subscription' as Section, label: t('Abonimi'), icon: CreditCard },
  ];

  const tiers = [
    { id: 'free', name: t('Falas'), price: '$0', features: [t('10 aktive të ndjekur'), t('Sinjale bazë'), t('3 alarme çmimi'), t('Mbështetje komuniteti')], border: 'border-gray-700', badge: '' },
    { id: 'pro', name: 'Pro', price: '$29', features: [t('Aktive të pakufizuara'), t('Të gjitha sinjalet AI'), t('Alarme të pakufizuara'), t('Mbështetje prioritare'), t('Analitikë e avancuar')], border: 'border-amber-500', badge: t('Më i popullarizuari') },
    { id: 'elite', name: 'Elite', price: '$79', features: [t('Gjithçka e Pro-s'), t('Menaxher portofoli AI'), t('Strategji të personalizuara'), t('Këshilltar i dedikuar'), t('Qasje API')], border: 'border-gray-600', badge: '' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center"><Settings className="w-5 h-5 text-gray-400" /></div>
        <div><h2 className="text-2xl font-bold text-white">{t('Cilësimet')}</h2><p className="text-gray-400 text-sm">{t('Menaxho preferencat e llogarisë tënde')}</p></div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-56 flex-shrink-0">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-2">
            {sections.map((s) => { const Icon = s.icon; return (
              <button key={s.id} onClick={() => setActiveSection(s.id)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all mb-1 last:mb-0 ${activeSection === s.id ? 'bg-amber-500/10 text-white border border-amber-500/20' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <div className="flex items-center gap-2.5"><Icon className={`w-4 h-4 ${activeSection === s.id ? 'text-amber-400' : ''}`} />{s.label}</div>
                <ChevronRight className={`w-3 h-3 ${activeSection === s.id ? 'text-amber-400' : 'text-gray-600'}`} />
              </button>
            ); })}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <button onClick={signOut} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-all"><LogOut className="w-4 h-4" />{t('Dil')}</button>
            </div>
          </div>
        </div>

        <div className="flex-1">
          {activeSection === 'profile' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h3 className="text-white font-semibold mb-5 flex items-center gap-2"><User className="w-4 h-4 text-amber-400" />{t('Të dhënat e profilit')}</h3>
              <div className="flex items-center gap-4 mb-6 p-4 bg-gray-800/50 rounded-2xl border border-gray-700/50">
                <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center flex-shrink-0"><User className="w-7 h-7 text-amber-400" /></div>
                <div>
                  <div className="text-white font-semibold">{profile?.full_name || 'Trader'}</div>
                  <div className="text-gray-400 text-sm">{user?.email}</div>
                  <div className="flex items-center gap-1 mt-1"><Crown className="w-3 h-3 text-amber-400" /><span className="text-amber-400 text-xs font-medium capitalize">{t('Plani {tier}', { tier: profile?.subscription_tier || 'free' })}</span></div>
                </div>
              </div>
              <div className="space-y-4">
                {[{ label: t('Emri i plotë'), key: 'full_name' as const, type: 'text' }, { label: 'Username', key: 'username' as const, type: 'text' }].map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{f.label}</label>
                    <input type={f.type} value={profileForm[f.key] || ''} onChange={(e) => setProfileForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                  <input type="email" value={user?.email || ''} disabled className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-gray-500 cursor-not-allowed" />
                </div>
                <button onClick={saveProfile} disabled={saving} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? t('U ruajt!') : t('Ruaj ndryshimet')}
                </button>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h3 className="text-white font-semibold mb-5 flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" />{t('Cilësimet e sigurisë')}</h3>
              <div className="space-y-4">
                {[{ label: t('Fjalëkalimi i ri'), key: 'new' as const }, { label: t('Konfirmo fjalëkalimin'), key: 'confirm' as const }].map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{f.label}</label>
                    <input type="password" value={pwForm[f.key]} onChange={(e) => setPwForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder="••••••••"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                ))}
                {pwMsg && <p className={`text-sm ${pwMsg.includes('!') ? 'text-green-400' : 'text-red-400'}`}>{pwMsg}</p>}
                <button onClick={changePw} disabled={saving} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}{t('Ndrysho fjalëkalimin')}
                </button>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-white font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-amber-400" />{t('Preferencat e njoftimeve')}</h3>
                {notifSaved && <span className="text-green-400 text-xs flex items-center gap-1"><Check className="w-3 h-3" />{t('U ruajt')}</span>}
              </div>
              <div className="space-y-3">
                {[
                  { key: 'signals' as const, label: t('Sinjale AI'), desc: t('Njoftohu kur gjenerohen sinjale të reja tregtimi') },
                  { key: 'priceAlerts' as const, label: t('Alarme çmimi'), desc: t('Njoftime kur aktivizohen alarmet e tua të çmimit') },
                  { key: 'tradeConfirmations' as const, label: t('Konfirmime tregtie'), desc: t('Konfirmim pas çdo tregtie të ekzekutuar') },
                  { key: 'newsletter' as const, label: t('Buletini i tregut'), desc: t('Përmbledhje javore e tregut dhe analizat') },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
                    <div><div className="text-white text-sm font-medium">{item.label}</div><div className="text-gray-500 text-xs mt-0.5">{item.desc}</div></div>
                    <button onClick={() => toggleNotification(item.key)} className={`w-11 h-6 rounded-full transition-all flex-shrink-0 relative ${notifications[item.key] ? 'bg-amber-500' : 'bg-gray-700'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${notifications[item.key] ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'subscription' && (
            <div className="space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-white font-semibold flex items-center gap-2"><Crown className="w-4 h-4 text-amber-400" />{t('Plani aktual')}</h3>
                  <span className="bg-amber-500/20 text-amber-400 text-xs font-bold px-2 py-1 rounded-lg capitalize">{profile?.subscription_tier || 'free'}</span>
                </div>
                <p className="text-gray-400 text-sm">{t('Pagesat online nuk janë aktivizuar ende — planet me pagesë vijnë së shpejti. Për ndryshim plani aktualisht, kontakto administratorin.')}</p>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {tiers.map((tier) => (
                  <div key={tier.id} className={`bg-gray-900 border-2 rounded-2xl p-5 relative ${tier.id === profile?.subscription_tier ? 'border-amber-500' : tier.border}`}>
                    {tier.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-gray-950 text-xs font-bold px-3 py-1 rounded-full">{tier.badge}</div>}
                    {tier.id === profile?.subscription_tier && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">{t('Aktiv')}</div>}
                    <div className="mb-4"><h4 className="text-white font-bold text-lg">{tier.name}</h4><div className="flex items-baseline gap-1 mt-1"><span className="text-3xl font-bold text-white">{tier.price}</span><span className="text-gray-400 text-sm">{t('/muaj')}</span></div></div>
                    <ul className="space-y-2 mb-5">{tier.features.map(f => <li key={f} className="flex items-center gap-2 text-gray-300 text-sm"><Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />{f}</li>)}</ul>
                    <button disabled className={`w-full py-2.5 rounded-xl text-sm font-semibold ${tier.id === profile?.subscription_tier ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-500'} cursor-not-allowed`}>
                      {tier.id === profile?.subscription_tier ? t('Aktiv') : t('Së shpejti')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
