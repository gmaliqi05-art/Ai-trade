import { useState } from 'react';
import { TrendingUp, Eye, EyeOff, Loader2, BarChart3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (mode === 'login') {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      if (!fullName.trim()) { setError('Full name is required'); setLoading(false); return; }
      const { error } = await signUp(email, password, fullName);
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex">
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
              <p className="text-amber-400 text-sm font-medium tracking-widest">AI PLATFORM</p>
            </div>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
            Trade Smarter with<br /><span className="text-amber-400">AI Intelligence</span>
          </h2>
          <p className="text-gray-400 text-lg mb-10 leading-relaxed">
            Real-time signals, AI-powered analysis, and professional portfolio management for Gold, Forex, Crypto & Stocks.
          </p>
          <div className="grid grid-cols-3 gap-4">
            {[{ value: '94.2%', label: 'Signal Accuracy' }, { value: '$2.4B', label: 'Volume Tracked' }, { value: '12K+', label: 'Active Traders' }].map((s) => (
              <div key={s.label} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-xl font-bold text-amber-400">{s.value}</div>
                <div className="text-gray-400 text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3 justify-center">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <span className="text-gray-400 text-sm">Live market data across 100+ instruments</span>
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
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-gray-400 mb-8">
            {mode === 'login' ? 'Sign in to access your trading dashboard' : 'Start your AI-powered trading journey'}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Smith"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" required />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
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
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <span className="text-gray-400 text-sm">{mode === 'login' ? "Don't have an account? " : 'Already have an account? '}</span>
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="text-amber-400 hover:text-amber-300 text-sm font-medium transition-colors">
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </div>
          {mode === 'login' && (
            <div className="mt-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
              <p className="text-xs text-gray-500 text-center mb-2">Demo credentials</p>
              <button type="button" onClick={() => { setEmail('demo@goldtrade.ai'); setPassword('demo123456'); }}
                className="w-full text-xs text-gray-400 hover:text-amber-400 transition-colors text-center">
                demo@goldtrade.ai / demo123456
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
