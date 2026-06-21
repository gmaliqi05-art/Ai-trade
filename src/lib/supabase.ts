import { createClient } from '@supabase/supabase-js';

// Lidhja me Supabase — backend i VETËM e i fiksuar i këtij projekti.
// Anon key-i është PUBLIK nga natyra (përfshihet gjithsesi në bundle-in e klientit dhe mbrohet nga
// RLS). E mbajmë URL-në + key-in TË FIKSUARA që asnjë host (Bolt/Vercel/Netlify) të mos e prishë
// lidhjen me env-variabla të gabuara/boshe (shkaku i "Failed to fetch" gjatë login te disa hoste).
// Lejojmë override me env VETËM nëse tregon te i NJËJTI projekt (zwyuscgqacfpjafznybg) — përndryshe
// e injorojmë dhe përdorim vlerat e sakta të fiksuara.
const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const DEFAULT_URL = `https://${PROJECT_REF}.supabase.co`;
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3eXVzY2dxYWNmcGphZnpueWJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODg0NzgsImV4cCI6MjA5NTk2NDQ3OH0.BhP8DNlQPVm5XdqZU9USZOlgqT-BnuJyq9Xk8Y0G7vg';

const envUrl = import.meta.env.VITE_SUPABASE_URL;
const envAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Përdor env-in VETËM nëse është URL i vlefshëm i TË NJËJTIT projekt; ndryshe vlerat e fiksuara.
const useEnv = typeof envUrl === 'string' && envUrl.includes(`${PROJECT_REF}.supabase.co`) && typeof envAnon === 'string' && envAnon.length > 20;
const supabaseUrl = useEnv ? envUrl : DEFAULT_URL;
const supabaseAnonKey = useEnv ? envAnon : DEFAULT_ANON;

if (envUrl && !useEnv) {
  console.warn('[supabase] VITE_SUPABASE_URL i gabuar/i huaj u injorua — po përdoret backend-i i fiksuar i projektit.');
}

// Ruajtja e sesionit (që refresh/pull-to-refresh të MOS të nxjerrë jashtë): persiston te
// localStorage, rifreskon token-in vetë në sfond, dhe trajton callback-un e auth-it. Mban çelësin
// default të Supabase — s'i nxjerr përdoruesit që janë tashmë të kyçur.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
