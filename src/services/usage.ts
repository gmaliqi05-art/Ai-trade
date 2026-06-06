// Përdorimi i planit për përdoruesin aktual (matës "X nga Y"). RPC: get_my_usage().
import { supabase } from '../lib/supabase';

export interface UsageInfo {
  plan: string;
  ai_used: number;
  ai_limit: number;      // -1 = pa limit
  alerts_used: number;
  alerts_limit: number;  // -1 = pa limit
}

export async function getMyUsage(): Promise<UsageInfo | null> {
  const { data, error } = await supabase.rpc('get_my_usage');
  if (error || !data) return null;
  return data as UsageInfo;
}
