import { useState } from 'react';
import { TrendingUp, Eye, EyeOff, Loader2, BarChart3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import AppFooter from '../components/AppFooter';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn, signUp } = useAuth();
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (mode === 'login') {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      if (!fullName.trim()) { setError(t('Emri i plotë është i detyrueshëm')); setLoading(false); return; }
      const { error } = await signUp(email, password, fullName);
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex relative">
      <div className="absolute top-4 right-4 z-20"><LanguageSwitcher /></div>
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-10 w-64 h-64 rounded-full bg-amber-400 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-80 h-80 rounded-full bg-amber-500 blur-3xl" />
        </div>
        <div className="relative z-10 text-center max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-8 h-8 text-gray-950" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white">GOLDTRADE</h1>
              <p className="text-amber-400 text-sm font-medium tracking-widest">{t('PLATFORMË AI')}</p>
            </div>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight"
            dangerouslySetInnerHTML={{ __html: t('Tregto më zgjuar me<br /><span class="text-amber-400">inteligjencën AI</span>') }}
          />
          <p className="text-gray-400 text-lg mb-10 leading-relaxed">
            {t('Sinjale nga motori matematik + arsyetim me inteligjencën e Robotit, çmime reale dhe auto-trade me mbrojtje rreziku — fokus 100% në Ar (XAUUSD).')}
          </p>
          <div className="grid grid-cols-3 gap-4">
            {[{ value: 'EMA·RSI·MACD', label: t('Indikatorë realë') }, { value: t('Roboti AI'), label: t('Arsyetim cilësor') }, { value: 'MetaTrader', label: t('Auto-trade (demo)') }].map((s) => (
              <div key={s.label} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-lg font-bold text-amber-400">{s.value}</div>
                <div className="text-gray-400 text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3 justify-center">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <span className="text-gray-400 text-sm">{t('Çmime reale: Ar & Naftë — fokus profesional')}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-gray-950" />
            </div>
            <span className="text-white font-bold text-lg">GOLDTRADE AI</span>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">
            {mode === 'login' ? t('Mirë se erdhe') : t('Krijo llogari')}
          </h2>
          <p className="text-gray-400 mb-8">
            {mode === 'login' ? t('Hyr për të hapur panelin tënd të tregtimit') : t('Nis udhëtimin tënd të tregtimit me AI')}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Emri i plotë')}</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('Emri Mbiemri')}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" required />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">{t('Fjalëkalimi')}</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors pr-12" required minLength={6} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            {error && <div className="bg-red-900/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-gray-950 font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 mt-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? t('Hyr') : t('Krijo llogari')}
            </button>
          </form>
          <div className="mt-6 text-center">
            <span className="text-gray-400 text-sm">{mode === 'login' ? t("S'ke llogari? ") : t('Ke tashmë llogari? ')}</span>
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="text-amber-400 hover:text-amber-300 text-sm font-medium transition-colors">
              {mode === 'login' ? t('Krijo një') : t('Hyr')}
            </button>
          </div>
        </div>
      </div>
      <div className="absolute bottom-1 left-0 right-0"><AppFooter /></div>
    </div>
  );
}
