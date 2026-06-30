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
    let cancelled = false, done = false;
    const finish = () => { if (!done) { done = true; setLoading(false); } };
    // A ekziston një sesion i ruajtur te pajisja? (çelësat sb-*-auth-token te localStorage)
    const hasStored = () => {
      try { return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('auth-token')); }
      catch { return false; }
    };
    const apply = (session: Session | null) => {
      if (cancelled) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id); else setProfile(null);
    };

    // RIKUPERIM REZISTENT: në rrjet të ngadaltë/roaming, rifreskimi i token-it mund të vonohet.
    // Sa kohë ekziston një sesion i ruajtur, RIPROVO disa herë para se ta konsiderojmë "i dalë" —
    // që një refresh të mos të nxjerrë jashtë vetëm sepse rrjeti vonoi.
    (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) { apply(session); break; }
          if (!hasStored()) { apply(null); break; }      // s'ka gjurmë sesioni → vërtet i dalë
        } catch { if (!hasStored()) { apply(null); break; } }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500)); // prit e riprovo (rrjet i ngadaltë)
      }
      finish();
    })();

    // Fallback i fortë: mos ngec kurrë te "Loading…" — pas 8s hap aplikacionin gjithsesi.
    const timer = setTimeout(finish, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session);
      finish();
    });

    return () => { cancelled = true; clearTimeout(timer); subscription.unsubscribe(); };
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
    // Dalja duhet të punojë GJITHMONË — edhe kur sesioni ka skaduar (token i pavlefshëm).
    // Scope 'local' s'i kërkon serverit ta revokojë (që dështon/ngec kur token-i s'vlen më);
    // pastron vetëm sesionin lokal. Pastaj fshijmë gjendjen + ruajtjen me dorë dhe rifreskojmë.
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* injoro — vazhdo me pastrimin lokal */ }
    try { setSession(null); setUser(null); setProfile(null); } catch { /* injoro */ }
    try {
      // Fshi çdo gjurmë sesioni të Supabase nga localStorage (çelësat sb-*).
      Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
    } catch { /* injoro */ }
    // Rikthe te ekrani i hyrjes me një ngarkim të pastër.
    if (typeof window !== 'undefined') window.location.href = '/';
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
