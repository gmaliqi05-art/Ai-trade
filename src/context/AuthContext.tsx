import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface Profile {
  id: string;
  username: string | null;
  full_name: string;
  avatar_url: string;
  balance: number;
  subscription_tier: string;
  is_admin: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (data) setProfile(data as Profile);
    } catch { /* injoro — mos e ndal hapjen e aplikacionit */ }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setLoading(false); } };
    // Rrjet i shtrirë mund të bllokojë getSession(); MOS ngec kurrë te "Loading…".
    // Pas 6s hap aplikacionin gjithsesi — onAuthStateChange e rifreskon sesionin kur vjen.
    const timer = setTimeout(finish, 6000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) fetchProfile(session.user.id);
      })
      .catch(() => { /* injoro — provohet sërish nga onAuthStateChange */ })
      .finally(finish);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) { fetchProfile(session.user.id); }
      else { setProfile(null); }
      finish();
    });

    return () => { clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // Çdo hyrje fillon te faqja e parazgjedhur (Tregto Live), jo te faqja e fundit e ruajtur.
    if (!error) { try { localStorage.removeItem('client_current_page'); } catch { /* injoro */ } }
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    // Emri kalon te metadata → trigger-i `handle_new_user` e mbush profilin automatikisht.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, username: email.split('@')[0] } },
    });
    if (error) return { error };
    // Përdoruesit auto-konfirmohen (shih migrimin) → nëse s'ka session nga signUp,
    // hyr menjëherë me kredencialet që sapo u vendosën, që të hapet dashboard-i.
    if (!data.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) return { error: signInErr };
    }
    try { localStorage.removeItem('client_current_page'); } catch { /* injoro */ }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
