import { supabase } from '../lib/supabase';

// Kodet VIP — verifikohen NË SERVER (edge function 'vip-verify'); menaxhohen nga super admini.
// Klienti kurrë s'i shkarkon kodet; verifikimi kthen vetëm valid/label.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const VERIFY_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/vip-verify`;

/** Verifikon një kod VIP në server. Kthen true nëse ekziston dhe është aktiv. */
export async function verifyVipCode(code: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ code }),
    });
    const j = await resp.json().catch(() => ({ valid: false }));
    return !!j.valid;
  } catch { return false; }
}

// ---- Menaxhimi nga super admin (RLS: vetëm is_admin) ----
export interface VipCodeRow {
  id: string;
  code: string;
  label: string | null;
  note: string | null;
  active: boolean;
  uses: number;
  last_used_at: string | null;
  created_at: string;
}

export async function loadVipCodes(): Promise<VipCodeRow[]> {
  const { data } = await supabase.from('vip_access_codes')
    .select('id, code, label, note, active, uses, last_used_at, created_at')
    .order('created_at', { ascending: false });
  return (data ?? []) as VipCodeRow[];
}

export async function createVipCode(code: string, label: string, note: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('vip_access_codes')
    .insert({ code: code.trim(), label: label.trim() || null, note: note.trim() || null, created_by: user?.id ?? null });
  if (error) throw new Error(error.message);
}

export async function updateVipCode(id: string, patch: Partial<Pick<VipCodeRow, 'code' | 'label' | 'note' | 'active'>>): Promise<void> {
  const { error } = await supabase.from('vip_access_codes').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteVipCode(id: string): Promise<void> {
  const { error } = await supabase.from('vip_access_codes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
