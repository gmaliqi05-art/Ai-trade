import { useState } from 'react';
import { Settings, Save, Loader2, Check, Globe, Bell, Shield, Database, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const { profile, user, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    full_name: profile?.full_name || '',
    username: profile?.username || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      full_name: form.full_name,
      username: form.username,
    }).eq('id', user.id);
    if (!error) {
      await refreshProfile();
      flash('success', t('Profili u përditësua me sukses.'));
    } else {
      flash('error', error.message);
    }
    setSaving(false);
  };

  const changePassword = async () => {
    if (!form.newPassword || form.newPassword !== form.confirmPassword) {
      flash('error', t('Fjalëkalimet nuk përputhen.'));
      return;
    }
    if (form.newPassword.length < 6) {
      flash('error', t('Fjalëkalimi duhet të paktën 6 karaktere.'));
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: form.newPassword });
    if (!error) {
      setForm(f => ({ ...f, currentPassword: '', newPassword: '', confirmPassword: '' }));
      flash('success', t('Fjalëkalimi u ndryshua me sukses.'));
    } else {
      flash('error', error.message);
    }
    setSaving(false);
  };

  const inputClass = "w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-colors placeholder-gray-600";

  return (
    <div className="p-5 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-red-400" />
            {t('Cilësimet e platformës')}
          </h2>
          <p className="text-gray-500 text-sm mt-1">{t('Menaxho llogarinë admin dhe preferencat e platformës')}</p>
        </div>
        {msg && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${
            msg.type === 'success'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/15 text-red-400 border border-red-500/30'
          }`}>
            <Check className="w-4 h-4" />
            {msg.text}
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-400" />
          <span className="text-white font-semibold text-sm">{t('Profili i adminit')}</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4 pb-4 border-b border-gray-800">
            <div className="w-14 h-14 bg-gradient-to-br from-red-500/30 to-orange-500/20 rounded-2xl flex items-center justify-center border border-red-500/30">
              <Shield className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <div className="text-white font-semibold">{profile?.full_name}</div>
              <div className="text-red-400 text-sm flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                {t('Super Administrator')}
              </div>{/* role */}
              <div className="text-gray-500 text-xs mt-0.5">{user?.email}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">{t('Emri i plotë')}</label>
              <input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                className={inputClass}
                placeholder={t('Emri yt')}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Username</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className={inputClass}
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Email</label>
              <input value={user?.email || ''} disabled className={`${inputClass} opacity-50 cursor-not-allowed`} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">{t('Roli')}</label>
              <input value={t('Super Administrator')} disabled className={`${inputClass} opacity-50 cursor-not-allowed text-red-400`} />
            </div>
          </div>
          <button
            onClick={saveProfile}
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('Ruaj profilin')}
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          <span className="text-white font-semibold text-sm">{t('Ndrysho fjalëkalimin')}</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 font-medium mb-1.5">{t('Fjalëkalimi i ri')}</label>
              <input
                type="password"
                value={form.newPassword}
                onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                className={inputClass}
                placeholder={t('Min. 6 karaktere')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 font-medium mb-1.5">{t('Konfirmo fjalëkalimin e ri')}</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                className={inputClass}
                placeholder={t('Përsërit fjalëkalimin')}
              />
            </div>
          </div>
          <button
            onClick={changePassword}
            disabled={saving || !form.newPassword}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {t('Ndrysho fjalëkalimin')}
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          <span className="text-white font-semibold text-sm">{t('Informacioni i platformës')}</span>
        </div>
        <div className="p-5 space-y-3">
          {[
            { label: t('Emri i platformës'), value: 'GOLDTRADE AI' },
            { label: t('Versioni'), value: '2.0.0' },
            { label: t('Mjedisi'), value: 'Production' },
            { label: t('Databaza'), value: 'Supabase PostgreSQL' },
            { label: t('Provider Auth'), value: 'Supabase Auth' },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
              <span className="text-gray-400 text-sm">{item.label}</span>
              <span className="text-white text-sm font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: Database, label: t('Databaza'), desc: 'Supabase PostgreSQL', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', status: t('E lidhur') },
          { icon: Bell, label: t('Njoftimet'), desc: t('Real-time aktive'), color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', status: t('Aktive') },
          { icon: RefreshCw, label: 'Auto-sync', desc: t('Të dhënat e tregut'), color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', status: t('Në punë') },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={`bg-gray-900 border ${item.border} rounded-xl p-4`}>
              <div className={`w-9 h-9 ${item.bg} rounded-lg flex items-center justify-center mb-3`}>
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <div className="text-white text-sm font-semibold">{item.label}</div>
              <div className="text-gray-500 text-xs mt-0.5">{item.desc}</div>
              <div className={`text-xs font-medium mt-2 flex items-center gap-1.5 ${item.color}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {item.status}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
