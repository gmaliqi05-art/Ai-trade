import { supabase } from '../lib/supabase';

// SISTEMI I EMAIL-EVE (Resend) — thirrjet nga ndërfaqja.
// Çelësi i Resend nuk kalon KURRË nga klienti gjatë dërgimit: edge function-i e lexon vetë
// nga 'email_secrets'. Nga këtu vetëm VENDOSET (me RPC të mbrojtur) dhe shihet statusi.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const FN = (name: string) => `https://${PROJECT_REF}.supabase.co/functions/v1/${name}`;

export interface EmailConfig {
  from_name: string;
  from_email: string;
  reply_to: string;
  send_verify: boolean;
  send_reset: boolean;
  send_welcome: boolean;
  send_billing: boolean;
  send_expiry: boolean;
}

export interface EmailStatus {
  configured: boolean;
  last4: string | null;
  sent_7d: number;
  failed_7d: number;
}

export interface EmailLogRow {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  from_name: 'GoldSniper',
  from_email: 'no-reply@goldsniper.vip',
  reply_to: 'support@goldsniper.vip',
  send_verify: true, send_reset: true, send_welcome: true, send_billing: true, send_expiry: true,
};

/* ---------------- ADMIN ---------------- */

export async function loadEmailConfig(): Promise<EmailConfig> {
  const { data } = await supabase.from('email_config').select('*').eq('id', 1).maybeSingle();
  return { ...DEFAULT_EMAIL_CONFIG, ...((data ?? {}) as Partial<EmailConfig>) };
}

export async function saveEmailConfig(patch: Partial<EmailConfig>): Promise<void> {
  // VERIFIKIM: një update pa përputhje s'jep gabim — kërkojmë rreshtin e kthyer.
  const { data, error } = await supabase.from('email_config')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Ruajtja nuk u konfirmua nga serveri.');
}

export async function setResendKey(key: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_resend_key', { p_key: key });
  if (error) throw new Error(error.message);
}

export async function loadEmailStatus(): Promise<EmailStatus | null> {
  const { data, error } = await supabase.rpc('admin_email_status');
  if (error) return null;
  return data as EmailStatus;
}

export async function loadEmailLog(limit = 100): Promise<EmailLogRow[]> {
  const { data } = await supabase.from('email_log')
    .select('id, to_email, template, subject, status, error, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as EmailLogRow[];
}

/** Dërgon një email prove te adresa e dhënë (vetëm admin). */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const r = await fetch(FN('send-email'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ template: 'test', to }),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    return { ok: !!j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ---------------- PËRDORUESI ---------------- */

/** Ridërgon kodin 6-shifror te email-i i përdoruesit të kyçur. */
export async function sendVerificationEmail(): Promise<{ ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: 'unauthorized' };
  try {
    const r = await fetch(FN('auth-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'verify' }),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    return { ok: !!j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Kërkon lidhjen e rivendosjes së fjalëkalimit. Kthen gjithmonë sukses — që të mos
 *  zbulohet nëse një adresë ka llogari apo jo. */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await fetch(FN('auth-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', email }),
    });
  } catch { /* injoro — përgjigjja është e njëjtë në çdo rast */ }
}
