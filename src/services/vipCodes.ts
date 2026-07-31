import { supabase } from '../lib/supabase';

// Kodet VIP — verifikohen NË SERVER (edge function 'vip-verify'); menaxhohen nga super admini.
// Klienti kurrë s'i shkarkon kodet; verifikimi kthen vetëm valid/label.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const VERIFY_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/vip-verify`;
const FN = (name: string) => `https://${PROJECT_REF}.supabase.co/functions/v1/${name}`;

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

/** Mbyll qasjen VIP në SERVER (vetëm kur VIP-i është marrë me kod) — rihyrja kërkon kodin sërish. */
export async function lockVipAccess(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ action: 'lock' }),
    });
  } catch { /* mbyllja lokale bëhet gjithsesi */ }
}

/** Verifikon kodin 6-shifror të qasjes (nga admini) për përdoruesin e kyçur. */
export async function verifyAccountCode(code: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(FN('account-verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ code }),
    });
    const j = await resp.json().catch(() => ({ valid: false }));
    return !!j.valid;
  } catch { return false; }
}

/** Dërgon një kërkesë për abonim VIP te admini. Kthen statusin (created/pending/already_vip). */
export async function requestVip(): Promise<{ ok: boolean; pending?: boolean; already_vip?: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(FN('vip-request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({}),
    });
    const j = await resp.json().catch(() => ({ ok: false }));
    return j as { ok: boolean; pending?: boolean; already_vip?: boolean; error?: string };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
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
  user_id: string | null; // kodi vlen VETËM për këtë përdorues (i caktuar nga admini)
}

export async function loadVipCodes(): Promise<VipCodeRow[]> {
  const { data } = await supabase.from('vip_access_codes')
    .select('id, code, label, note, active, uses, last_used_at, created_at, user_id')
    .order('created_at', { ascending: false });
  return (data ?? []) as VipCodeRow[];
}

export async function createVipCode(code: string, label: string, note: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('vip_access_codes')
    .insert({ code: code.trim(), label: label.trim() || null, note: note.trim() || null, created_by: user?.id ?? null });
  if (error) throw new Error(error.message);
}

export async function updateVipCode(id: string, patch: Partial<Pick<VipCodeRow, 'code' | 'label' | 'note' | 'active' | 'user_id'>>): Promise<void> {
  const { error } = await supabase.from('vip_access_codes').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteVipCode(id: string): Promise<void> {
  const { error } = await supabase.from('vip_access_codes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- Anëtarët VIP (privilegji jepet direkt nga admin — pa kod) ----
export interface VipMember { id: string; email: string; is_vip: boolean; is_admin: boolean; is_verified: boolean; access_code: string | null; vip_source?: string | null; created_at?: string | null; }

export interface VipRequest { id: string; user_id: string; email: string; status: string; note: string | null; created_at: string; resolved_at: string | null; }

async function callAdminVip(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/admin-vip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify(payload),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || j.error) throw new Error(j.error || 'Kërkesa dështoi.');
  return j;
}

/** Liston përdoruesit me statusin VIP (vetëm admin). */
export async function loadVipMembers(): Promise<VipMember[]> {
  const j = await callAdminVip({ action: 'list' });
  return (j.users as VipMember[]) ?? [];
}

/** I jep ose i heq privilegjin VIP një përdoruesi (vetëm admin). */
export async function setVipMember(userId: string, isVip: boolean): Promise<void> {
  await callAdminVip({ action: 'set', user_id: userId, is_vip: isVip });
}

/** Shënon manualisht një përdorues si të verifikuar / jo (qasje te tregtimi). */
export async function setVerifiedMember(userId: string, isVerified: boolean): Promise<void> {
  await callAdminVip({ action: 'set_verified', user_id: userId, is_verified: isVerified });
}

/** Rigjeneron kodin 6-shifror të qasjes për një përdorues. Kthen kodin e ri. */
export async function regenAccessCode(userId: string): Promise<string> {
  const j = await callAdminVip({ action: 'regen_code', user_id: userId });
  return String(j.access_code || '');
}

/** Liston kërkesat për VIP (vetëm admin). */
export async function loadVipRequests(): Promise<VipRequest[]> {
  const j = await callAdminVip({ action: 'list_requests' });
  return (j.requests as VipRequest[]) ?? [];
}

/** Aprovon ose refuzon një kërkesë VIP (vetëm admin). */
export async function resolveVipRequest(requestId: string, decision: 'approve' | 'reject'): Promise<void> {
  await callAdminVip({ action: 'resolve_request', request_id: requestId, decision });
}
