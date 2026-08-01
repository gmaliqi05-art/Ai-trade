import { useState, useEffect, useCallback } from 'react';
import { Settings, User, Shield, Bell, CreditCard, Save, Loader2, Check, ChevronRight, LogOut, Crown, BellRing, Smartphone, Trash2, AlertTriangle, Camera } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';
import { isStandalone, isIosLike, getPushState, subscribePush, unsubscribePush, sendTestPush } from '../services/push';
import SubscriptionPlans from '../components/SubscriptionPlans';
import { loadSubscription, daysLeft, openBillingPortal, type SubState } from '../services/subscription';

type Section = 'profile' | 'security' | 'notifications' | 'subscription';

// Preferencat e njoftimeve për përdoruesin STANDARD: mesazhet e platformës + kujtesa e abonimit.
// (Toggles e vjetra — Sinjale AI, Alarme çmimi, Konfirmime, Buletini — u hoqën: s'janë privilegje standarde.)
interface NotificationPrefs { messages: boolean; subscription: boolean; }

export default function SettingsPage() {
  const { t } = useI18n();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [profileForm, setProfileForm] = useState({
    first_name: profile?.first_name || '', last_name: profile?.last_name || '',
    username: profile?.username || '', phone: profile?.phone || '',
    address: profile?.address || '', country: profile?.country || '',
    birth_date: profile?.birth_date || '',
  });
  const [profileMsg, setProfileMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  // Datëlindja bllokohet vetëm KUR është vendosur tashmë; përdoruesit e vjetër (bosh) e plotësojnë.
  const birthLocked = !!profile?.birth_date;
  // FOTO E PROFILIT — ngarkohet te bucket-i 'avatars' (dosja = user id).
  const [avatarBusy, setAvatarBusy] = useState(false);
  const uploadAvatar = async (file: File) => {
    if (!user) return;
    setAvatarBusy(true); setProfileMsg(null);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', user.id);
      if (dbErr) throw new Error(dbErr.message);
      await refreshProfile();
      setProfileMsg({ type: 'success', text: t('Fotoja u ngarkua.') });
    } catch (e) {
      setProfileMsg({ type: 'error', text: (e as Error).message || t('Ngarkimi dështoi.') });
    }
    setAvatarBusy(false);
  };
  const [pwForm, setPwForm] = useState({ new: '', confirm: '' });
  const [notifications, setNotifications] = useState<NotificationPrefs>({ messages: true, subscription: true });
  const [pwMsg, setPwMsg] = useState('');

  // FSHIRJA E LLOGARISË — dy hapa: paralajmërim (të dhënat humbin) → fjalëkalim → fshirje e përhershme.
  const [delStep, setDelStep] = useState(0);
  const [delPw, setDelPw] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState('');
  const confirmDelete = async () => {
    if (!delPw) return;
    setDelBusy(true); setDelMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ password: delPw }),
      });
      const j = await resp.json().catch(() => ({}));
      if (j.ok) { await signOut(); return; } // llogaria u fshi — dil dhe kthehu te hyrja
      setDelMsg(j.error === 'wrong_password' ? t('Fjalëkalim i gabuar.')
        : j.error === 'admin_protected' ? t("Llogaritë admin s'fshihen nga këtu.")
        : (j.error || t('Fshirja dështoi. Provo sërish.')));
    } catch { setDelMsg(t('Fshirja dështoi. Provo sërish.')); }
    setDelBusy(false);
  };

  // ABONIMI: gjendja aktuale (plan, status, skadimi) — për tab-in "Abonimi".
  const [sub, setSub] = useState<SubState | null>(null);
  const refreshSub = useCallback(async () => { if (user) setSub(await loadSubscription(user.id)); }, [user]);
  useEffect(() => { refreshSub(); }, [refreshSub]);
  // Menaxhimi i abonimit (ndrysho kartën / anulo) — portali i sigurt i Stripe.
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');
  const manageBilling = async () => {
    setPortalBusy(true); setPortalMsg('');
    const r = await openBillingPortal();
    if (!r.url) setPortalMsg(r.error === 'no_customer' ? t('S\'ka abonim me pagesë për të menaxhuar.') : t('Nuk u hap dot portali. Provo sërish.'));
    setPortalBusy(false);
  };

  // Web Push (web + PWA): gjendja e abonimit në këtë pajisje.
  const [push, setPush] = useState<{ supported: boolean; permission: NotificationPermission; subscribed: boolean }>({ supported: false, permission: 'default', subscribed: false });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { getPushState().then(setPush); }, []);

  const enablePush = async () => {
    if (!user) return;
    setPushBusy(true); setPushMsg(null);
    const r = await subscribePush(user.id);
    if (r.ok) { setPushMsg({ type: 'success', text: t('Njoftimet push u aktivizuan për këtë pajisje.') }); }
    else if (r.error === 'denied') { setPushMsg({ type: 'error', text: t('Leja u refuzua. Lejo njoftimet te cilësimet e shfletuesit.') }); }
    else if (r.error === 'unsupported') { setPushMsg({ type: 'error', text: t('Ky shfletues/pajisje nuk i mbështet njoftimet push.') }); }
    else { setPushMsg({ type: 'error', text: r.error || t('Gabim gjatë aktivizimit.') }); }
    setPush(await getPushState());
    setPushBusy(false);
  };

  const disablePush = async () => {
    if (!user) return;
    setPushBusy(true); setPushMsg(null);
    await unsubscribePush(user.id);
    setPushMsg({ type: 'success', text: t('Njoftimet push u çaktivizuan për këtë pajisje.') });
    setPush(await getPushState());
    setPushBusy(false);
  };

  const testPush = async () => {
    if (!user) return;
    setPushBusy(true); setPushMsg(null);
    // Sigurohu që KJO pajisje (PWA ose shfletues) është e abonuar PARA testit. Pa këtë, testi i dërguar
    // nga PWA-ja shkonte te token-i i shfletuesit (pajisje tjetër) dhe njoftimi NUK shfaqej në PWA.
    const sub = await subscribePush(user.id);
    if (!sub.ok) {
      setPushMsg({
        type: 'error',
        text: sub.error === 'denied' ? t('Leja u refuzua. Lejo njoftimet te cilësimet e pajisjes.')
          : sub.error === 'unsupported' ? t('Kjo pajisje nuk i mbështet njoftimet push.')
          : (sub.error || t('Abonimi i kësaj pajisjeje dështoi.')),
      });
      setPush(await getPushState());
      setPushBusy(false);
      return;
    }
    const r = await sendTestPush();
    setPushMsg(r.ok ? { type: 'success', text: t('Njoftimi i provës u dërgua — duhet të shfaqet brenda pak sekondash.') } : { type: 'error', text: r.error || t('Dërgimi dështoi.') });
    setPush(await getPushState());
    setPushBusy(false);
  };

  useEffect(() => {
    if (profile) {
      setProfileForm({
        first_name: profile.first_name || '', last_name: profile.last_name || '',
        username: profile.username || '', phone: profile.phone || '',
        address: profile.address || '', country: profile.country || '',
        birth_date: profile.birth_date || '',
      });
      const raw = (profile as unknown as { notification_preferences?: Record<string, unknown> }).notification_preferences;
      if (raw) setNotifications({ messages: raw.messages !== false, subscription: raw.subscription !== false });
    }
  }, [profile]);

  const saveProfile = async () => {
    if (!user) return;
    setProfileMsg(null);
    // Datëlindja (kur plotësohet për herë të parë): 18+ e detyrueshme.
    if (!birthLocked && profileForm.birth_date) {
      const bd = new Date(profileForm.birth_date + 'T12:00:00'), now = new Date();
      let age = now.getFullYear() - bd.getFullYear();
      if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
      if (!(age >= 18)) { setProfileMsg({ type: 'error', text: t('Për shkak të sigurisë, hapja e llogarisë nuk lejohet për personat nën 18 vjeç.') }); return; }
    }
    setSaving(true);
    const patch: Record<string, unknown> = {
      first_name: profileForm.first_name || null, last_name: profileForm.last_name || null,
      full_name: `${profileForm.first_name} ${profileForm.last_name}`.trim() || profileForm.username || profile?.full_name || '',
      username: profileForm.username || null, phone: profileForm.phone || null,
      address: profileForm.address || null, country: profileForm.country || null,
      updated_at: new Date().toISOString(),
    };
    if (!birthLocked && profileForm.birth_date) patch.birth_date = profileForm.birth_date;
    // .select() konfirmon se rreshti U PËRDITËSUA vërtet (pa të, dështimi kalonte në heshtje).
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.id).select('id');
    setSaving(false);
    if (error) { setProfileMsg({ type: 'error', text: error.message }); return; }
    if (!data || data.length === 0) { setProfileMsg({ type: 'error', text: t('Ruajtja nuk u konfirmua nga serveri. Dil dhe hyr sërish, pastaj provo përsëri.') }); return; }
    await refreshProfile();
    setSaved(true); setTimeout(() => setSaved(false), 2000);
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
                {/* FOTO E PROFILIT — klik për ta ndryshuar. */}
                <label className="relative w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group" title={t('Ndrysho foton e profilit')}>
                  {profile?.avatar_url
                    ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-amber-500/20 flex items-center justify-center"><User className="w-7 h-7 text-amber-400" /></div>}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {avatarBusy ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
                  </div>
                  <input type="file" accept="image/*" className="hidden" disabled={avatarBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.currentTarget.value = ''; }} />
                </label>
                <div>
                  <div className="text-white font-semibold">{profile?.full_name || 'Trader'}</div>
                  <div className="text-gray-400 text-sm">{user?.email}</div>
                  <div className="flex items-center gap-1 mt-1"><Crown className="w-3 h-3 text-amber-400" /><span className="text-amber-400 text-xs font-medium capitalize">{t('Plani {tier}', { tier: profile?.subscription_tier || 'free' })}</span></div>
                </div>
              </div>
              <div className="space-y-4">
                {/* Emri + Mbiemri */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[{ label: t('Emri'), key: 'first_name' as const }, { label: t('Mbiemri'), key: 'last_name' as const }].map(f => (
                    <div key={f.key}>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">{f.label}</label>
                      <input type="text" value={profileForm[f.key] || ''} onChange={(e) => setProfileForm(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                    </div>
                  ))}
                </div>
                {/* Datëlindja (vetëm-lexim — vendoset në regjistrim) + Telefoni */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Datëlindja')}</label>
                    {birthLocked ? (
                      <input type="text" value={new Date(profile!.birth_date + 'T12:00:00').toLocaleDateString('en-GB')} disabled
                        className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-gray-500 cursor-not-allowed" />
                    ) : (
                      <input type="date" value={profileForm.birth_date || ''} max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setProfileForm(p => ({ ...p, birth_date: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors [color-scheme:dark]" />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Nr. i telefonit')}</label>
                    <input type="tel" value={profileForm.phone || ''} onChange={(e) => setProfileForm(p => ({ ...p, phone: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                </div>
                {/* Adresa + Shteti */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Adresa e banimit')}</label>
                    <input type="text" value={profileForm.address || ''} onChange={(e) => setProfileForm(p => ({ ...p, address: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Shteti')}</label>
                    <input type="text" value={profileForm.country || ''} onChange={(e) => setProfileForm(p => ({ ...p, country: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
                  <input type="text" value={profileForm.username || ''} onChange={(e) => setProfileForm(p => ({ ...p, username: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                  <input type="email" value={user?.email || ''} disabled className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-gray-500 cursor-not-allowed" />
                </div>
                {profileMsg && (
                  <div className={`text-sm rounded-xl px-3 py-2 ${profileMsg.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>{profileMsg.text}</div>
                )}
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

              {/* ——— NJOFTIME PUSH (web + PWA) — kur roboti hap/mbyll trade dhe kur vjen sinjal i ri ——— */}
              <div className="mb-5 p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 rounded-xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0"><BellRing className="w-4 h-4 text-amber-400" /></div>
                    <div>
                      <div className="text-white text-sm font-semibold">{t('Njoftime push (web & telefon)')}</div>
                      <div className="text-gray-400 text-xs mt-0.5 leading-snug">{t('Merr njoftim edhe kur app-i është i mbyllur: kur roboti hap ose mbyll një trade, dhe kur vjen një sinjal i ri.')}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${push.subscribed ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {push.subscribed ? t('AKTIV') : t('JOAKTIV')}
                  </span>
                </div>

                {isIosLike() && !isStandalone() ? (
                  // APPLE (iPhone/iPad): Web Push punon VETËM si app në Home Screen me Safari (iOS/iPadOS 16.4+),
                  // KURRË në një tab shfletuesi apo në Chrome. Udhëzim i qartë në vend të butonit që dështon.
                  <div className="mt-3 text-[11px] text-amber-200/90 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-start gap-1.5 font-semibold text-amber-300"><Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('Në iPhone/iPad, njoftimet punojnë vetëm si APP në Home Screen (jo në shfletues):')}</div>
                    <ol className="list-decimal ml-5 space-y-0.5 text-gray-300">
                      <li>{t('Hape këtë faqe me Safari (jo Chrome).')}</li>
                      <li>{t('Prek butonin Share (katror me shigjetë lart) → "Add to Home Screen".')}</li>
                      <li>{t('Hape app-in nga ikona e re në Home Screen.')}</li>
                      <li>{t('Kthehu këtu te Cilësimet → "Aktivizo njoftimet push" → Lejo.')}</li>
                    </ol>
                    <div className="text-amber-300/80 font-medium">{t('📍 Tani je në shfletues — prandaj butoni s\'shfaqet ende. Ai del automatikisht te ky panel kur e hap app-in nga ikona (pa shiritin e adresës lart).')}</div>
                    <div className="text-gray-500">{t('Kërkon iPadOS/iOS 16.4 ose më të ri.')}</div>
                  </div>
                ) : !push.supported ? (
                  <p className="text-[11px] text-amber-300/90 mt-3">{t('Ky shfletues/pajisje nuk i mbështet njoftimet push.')}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {push.subscribed ? (
                      <button onClick={disablePush} disabled={pushBusy} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-gray-800 text-gray-200 border border-gray-700 hover:border-gray-500 disabled:opacity-50">
                        {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}{t('Çaktivizo në këtë pajisje')}
                      </button>
                    ) : (
                      <button onClick={enablePush} disabled={pushBusy} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-amber-500 text-gray-950 hover:bg-amber-400 disabled:opacity-50">
                        {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}{t('Aktivizo njoftimet push')}
                      </button>
                    )}
                    {push.subscribed && (
                      <button onClick={testPush} disabled={pushBusy} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-gray-800 text-amber-300 border border-amber-500/30 hover:bg-gray-700 disabled:opacity-50">
                        {t('Dërgo njoftim prove')}
                      </button>
                    )}
                  </div>
                )}

                {pushMsg && (
                  <div className={`mt-2.5 text-[11px] rounded-lg px-2.5 py-1.5 ${pushMsg.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{pushMsg.text}</div>
                )}
                {isIosLike() && isStandalone() && !push.supported && (
                  <p className="text-[10px] text-gray-400 mt-2 flex items-start gap-1.5"><Smartphone className="w-3 h-3 mt-0.5 shrink-0" />{t('Sigurohu që je në iPadOS/iOS 16.4+ dhe e hape app-in nga ikona e Home Screen.')}</p>
                )}
              </div>

              <div className="space-y-3">
                {[
                  { key: 'messages' as const, label: t('Mesazhet e platformës'), desc: t('Push notification kur platforma të dërgon një mesazh ose njoftim të rëndësishëm') },
                  { key: 'subscription' as const, label: t('Kujtesa e abonimit'), desc: t('Push notification 1 javë para se të skadojë abonimi yt') },
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
              {/* GJENDJA AKTUALE — plani, statusi dhe ditët e mbetura. */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                  <h3 className="text-white font-semibold flex items-center gap-2"><Crown className="w-4 h-4 text-amber-400" />{t('Plani aktual')}</h3>
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                    sub && ['active', 'trialing'].includes(sub.status) ? 'bg-green-500/20 text-green-400'
                    : sub && sub.status === 'past_due' ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-gray-700 text-gray-300'}`}>
                    {sub?.status === 'trialing' ? t('Provë falas')
                      : sub?.tier === 'monthly' ? t('Mujor')
                      : sub?.tier === 'yearly' ? t('Vjetor')
                      : sub?.status === 'past_due' ? t('Pagesë e vonuar')
                      : sub?.status === 'canceled' ? t('Anuluar')
                      : sub?.status === 'expired' ? t('Skaduar')
                      : (profile?.subscription_tier || 'free')}
                  </span>
                </div>
                {sub && (sub.expiresAt || sub.trialEndsAt) && ['active', 'trialing'].includes(sub.status) ? (
                  <p className="text-gray-400 text-sm">
                    {t('Skadon më')} <span className="text-white font-semibold">{new Date((sub.expiresAt || sub.trialEndsAt)!).toLocaleDateString('en-GB')}</span>
                    {' · '}<span className="text-amber-400 font-semibold">{daysLeft(sub.expiresAt || sub.trialEndsAt)} {t('ditë të mbetura')}</span>
                    {' — '}{t('do të marrësh njoftim 1 javë para skadimit.')}
                  </p>
                ) : (
                  <p className="text-gray-400 text-sm">{t('Zgjidh një plan më poshtë për të hapur sinjalet dhe robotin auto-trade.')}</p>
                )}
                {/* MENAXHIMI I ABONIMIT — ndrysho kartën ose anulo (portali i Stripe). */}
                {sub?.tier && ['monthly', 'yearly'].includes(sub.tier) && (
                  <div className="mt-3">
                    <button onClick={manageBilling} disabled={portalBusy}
                      className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-gray-800 text-gray-200 border border-gray-700 hover:border-gray-500 disabled:opacity-50">
                      {portalBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      {t('Menaxho abonimin (kartën / anulimin)')}
                    </button>
                    {portalMsg && <p className="text-[11px] text-red-400 mt-1.5">{portalMsg}</p>}
                  </div>
                )}
              </div>

              {/* PLANET — provë falas · mujor · vjetor (pagesa me Stripe). */}
              <SubscriptionPlans sub={sub} onDone={async () => { await refreshSub(); await refreshProfile(); }} compact />

              {/* ZONA E RREZIKUT — çaktivizimi/fshirja e llogarisë (e detyrueshme për privatësinë).
                  Rrjedha: paralajmërim (të gjitha të dhënat humbin) → fjalëkalimi → fshirje e përhershme. */}
              <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-5">
                <h3 className="text-red-400 font-semibold flex items-center gap-2 mb-1"><Trash2 className="w-4 h-4" />{t('Çaktivizo llogarinë')}</h3>
                <p className="text-gray-400 text-sm mb-3">{t('Fshirja e llogarisë është e përhershme: profili, raportet, trade-t, shënimet dhe të gjitha të dhënat e tua humbin përgjithmonë.')}</p>
                <button onClick={() => { setDelStep(1); setDelPw(''); setDelMsg(''); }}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-red-900/30 text-red-400 border border-red-800/60 hover:bg-red-900/50 transition-colors">
                  <Trash2 className="w-4 h-4" />{t('Fshi llogarinë')}
                </button>
              </div>

              {/* DRITARJA E FSHIRJES — dy hapa. */}
              {delStep > 0 && (
                <div className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4" onClick={() => !delBusy && setDelStep(0)}>
                  <div className="bg-gray-900 border border-red-900/60 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                    {delStep === 1 && (
                      <>
                        <h3 className="text-red-400 font-bold flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5" />{t('Je i sigurt?')}</h3>
                        <p className="text-gray-300 text-sm leading-relaxed mb-4">
                          {t('Ky veprim fshin PËRGJITHMONË llogarinë tënde dhe TË GJITHA të dhënat: profilin, raportet, trade-t, shënimet e Journal-it, konfigurimet dhe njoftimet. Nuk ka kthim pas dhe asgjë nuk mund të rikuperohet.')}
                        </p>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setDelStep(0)} className="text-sm font-semibold px-4 py-2 rounded-xl bg-gray-800 text-gray-300 border border-gray-700 hover:text-white">{t('Anulo')}</button>
                          <button onClick={() => setDelStep(2)} className="text-sm font-semibold px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-500">{t('Vazhdo me fshirjen')}</button>
                        </div>
                      </>
                    )}
                    {delStep === 2 && (
                      <>
                        <h3 className="text-red-400 font-bold flex items-center gap-2 mb-2"><Shield className="w-5 h-5" />{t('Konfirmo me fjalëkalimin')}</h3>
                        <p className="text-gray-400 text-sm mb-3">{t('Për sigurinë tënde, vendos fjalëkalimin e llogarisë për të përfunduar fshirjen e përhershme.')}</p>
                        <input type="password" value={delPw} autoFocus onChange={e => { setDelPw(e.target.value); setDelMsg(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') confirmDelete(); }}
                          placeholder={t('Fjalëkalimi')}
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 mb-2" />
                        {delMsg && <p className="text-red-400 text-xs mb-2">{delMsg}</p>}
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setDelStep(0)} disabled={delBusy} className="text-sm font-semibold px-4 py-2 rounded-xl bg-gray-800 text-gray-300 border border-gray-700 hover:text-white disabled:opacity-50">{t('Anulo')}</button>
                          <button onClick={confirmDelete} disabled={delBusy || !delPw}
                            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">
                            {delBusy && <Loader2 className="w-4 h-4 animate-spin" />}{t('Fshi llogarinë përgjithmonë')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
