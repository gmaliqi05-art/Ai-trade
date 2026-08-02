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
  brand_name: string;
  logo_url: string;
  legal_note: string;
  footer_note: string;
}

export interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  is_system: boolean;
  sort_order: number;
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
  from_name: 'GoldSniperFX',
  from_email: 'no-reply@goldsniper.vip',
  reply_to: 'support@goldsniper.vip',
  brand_name: 'GoldSniperFX',
  logo_url: '',
  legal_note: '',
  footer_note: 'Krijuar nga MarGroup DE',
};

/* ---------------- ADMIN ---------------- */

export async function loadEmailConfig(): Promise<EmailConfig> {
  const { data } = await supabase.from('email_config')
    .select('from_name, from_email, reply_to, brand_name, logo_url, legal_note, footer_note')
    .eq('id', 1).maybeSingle();
  return { ...DEFAULT_EMAIL_CONFIG, ...((data ?? {}) as Partial<EmailConfig>) };
}

/* ---------------- MODELET ---------------- */

export async function loadTemplates(): Promise<EmailTemplate[]> {
  const { data } = await supabase.from('email_templates')
    .select('id, key, name, subject, body, enabled, is_system, sort_order')
    .order('sort_order');
  return (data ?? []) as EmailTemplate[];
}

export async function saveTemplate(id: string, patch: Partial<EmailTemplate>): Promise<void> {
  const { data, error } = await supabase.from('email_templates')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Ruajtja nuk u konfirmua nga serveri.');
}

export async function createTemplate(t: Pick<EmailTemplate, 'key' | 'name' | 'subject' | 'body'>): Promise<void> {
  const { error } = await supabase.from('email_templates')
    .insert({ ...t, enabled: true, is_system: false, sort_order: 500 });
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('email_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Ndërton HTML-në e email-it pa e dërguar — për parapamje në panel. */
export async function previewTemplate(key: string): Promise<{ ok: boolean; html?: string; subject?: string; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const r = await fetch(FN('send-email'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        template: key, preview: true,
        // Vlera shembull, që parapamja të duket si email i vërtetë.
        vars: {
          name: 'Arben', code: '482913', link: 'https://www.goldsniper.vip',
          plan: 'Vjetor', amount: '699.00 EUR', start: '02/08/2026',
          expires: '02/08/2027', invoice: 'in_1QxWvT2eZvKY',
        },
      }),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    return j as { ok: boolean; html?: string; subject?: string; error?: string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Ngarkon logon te depoja publike 'brand' dhe kthen adresën e saj. */
export async function uploadLogo(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('brand').upload(path, file, {
    cacheControl: '31536000', upsert: true, contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('brand').getPublicUrl(path);
  return data.publicUrl;
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
