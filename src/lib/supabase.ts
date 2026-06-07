import { createClient } from '@supabase/supabase-js';

// Lidhja me Supabase. Përdor env-variablat kur ekzistojnë; përndryshe bie te vlerat
// publike të projektit. (Anon key-i është PUBLIK nga natyra — përfshihet gjithsesi në
// bundle-in e klientit dhe mbrohet nga RLS.) Kjo siguron që login të punojë edhe te
// mjediset ku env-variablat s'injektohen (p.sh. disa preview), pa "Failed to fetch".
const FALLBACK_URL = 'https://zwyuscgqacfpjafznybg.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3eXVzY2dxYWNmcGphZnpueWJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODg0NzgsImV4cCI6MjA5NTk2NDQ3OH0.BhP8DNlQPVm5XdqZU9USZOlgqT-BnuJyq9Xk8Y0G7vg';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('[supabase] VITE_SUPABASE_* mungojnë — po përdoret fallback-u publik i projektit.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
