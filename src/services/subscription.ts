import { supabase } from '../lib/supabase';

// ABONIMI: provë falas 15 ditë · mujor 69€ · vjetor 699€ (në vend të 828€ = 69×12).
// Pagesa kryhet me Stripe Checkout (funksioni 'stripe-checkout' krijon sesionin).

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const CHECKOUT_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-checkout`;

// VLERAT REZERVË — përdoren derisa të mbërrijë konfigurimi real nga billing_config.
// Burimi i vërtetë i çmimeve është tabela billing_config (Admin → Planet e Abonimit):
// regjistrimi, cilësimet e përdoruesit DHE stripe-checkout lexojnë të gjithë të njëjtin rresht.
export const TRIAL_DAYS = 15;
export const PRICE_MONTHLY = 69;
export const PRICE_YEARLY = 699;
export const PRICE_YEARLY_FULL = 828;   // 69 × 12 — çmimi pa zbritje (tregohet i kryqëzuar)
export const YEARLY_SAVING = PRICE_YEARLY_FULL - PRICE_YEARLY; // 129€

export interface CryptoWallet { coin: string; network: string; address: string }

export interface BillingConfig {
  trialDays: number;
  monthly: number;
  yearly: number;
  yearlyFull: number;
  cryptoEnabled: boolean;
  cryptoNote: string;
  wallets: CryptoWallet[];
}

export const DEFAULT_BILLING: BillingConfig = {
  trialDays: TRIAL_DAYS, monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY, yearlyFull: PRICE_YEARLY_FULL,
  cryptoEnabled: false, cryptoNote: '', wallets: [],
};

/** Konfigurimi i çmimeve/kripto-ve nga Admini — i njëjtë kudo (regjistrim, cilësime, checkout). */
export async function loadBillingConfig(): Promise<BillingConfig> {
  const { data } = await supabase.from('billing_config').select('*').eq('id', 1).maybeSingle();
  if (!data) return DEFAULT_BILLING;
  const d = data as { trial_days: number; monthly_eur: number; yearly_eur: number; yearly_full_eur: number;
    crypto_enabled: boolean; crypto_note: string; crypto_wallets: CryptoWallet[] | null };
  return {
    trialDays: Number(d.trial_days ?? TRIAL_DAYS),
    monthly: Number(d.monthly_eur ?? PRICE_MONTHLY),
    yearly: Number(d.yearly_eur ?? PRICE_YEARLY),
    yearlyFull: Number(d.yearly_full_eur ?? PRICE_YEARLY_FULL),
    cryptoEnabled: !!d.crypto_enabled,
    cryptoNote: d.crypto_note || '',
    wallets: Array.isArray(d.crypto_wallets) ? d.crypto_wallets : [],
  };
}

export type PlanId = 'trial' | 'monthly' | 'yearly';

export interface SubState {
  tier: string | null;            // none|trial|monthly|yearly (ose planet e vjetra)
  status: string;                 // none|trialing|active|past_due|canceled|expired
  expiresAt: string | null;
  trialEndsAt: string | null;
}

/** Gjendja e abonimit për përdoruesin e kyçur (nga profiles). */
export async function loadSubscription(userId: string): Promise<SubState | null> {
  const { data } = await supabase.from('profiles')
    .select('subscription_tier, subscription_status, subscription_expires_at, trial_ends_at')
    .eq('id', userId).maybeSingle();
  if (!data) return null;
  const d = data as { subscription_tier: string | null; subscription_status: string | null; subscription_expires_at: string | null; trial_ends_at: string | null };
  return {
    tier: d.subscription_tier,
    status: d.subscription_status || 'none',
    expiresAt: d.subscription_expires_at,
    trialEndsAt: d.trial_ends_at,
  };
}

/** Ditët e mbetura deri në skadim (null nëse s'ka datë). */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

interface CheckoutResp { ok?: boolean; url?: string; trial?: boolean; expires_at?: string; error?: string; message?: string }

/** Hap portalin e Stripe për të menaxhuar kartën ose ANULUAR abonimin. */
export async function openBillingPortal(): Promise<CheckoutResp> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ plan: 'portal', origin: window.location.origin }),
    });
    const j = (await resp.json().catch(() => ({}))) as CheckoutResp;
    if (j.url) { window.location.href = j.url; return j; }
    return j;
  } catch (e) { return { error: (e as Error).message }; }
}

/** Nis provën FALAS 15-ditore (pa kartë) ose hap Stripe Checkout për planin me pagesë. */
export async function choosePlan(plan: PlanId): Promise<CheckoutResp> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ plan, origin: window.location.origin }),
    });
    const j = (await resp.json().catch(() => ({}))) as CheckoutResp;
    if (j.url) { window.location.href = j.url; return j; }   // ridrejtim te faqja e pagesës
    return j;
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------------------------------------------------------------------------
// RINOVIMI AUTOMATIK, PAGESAT E MIA, DHE MIRËSEARDHJA (5 gusht 2026)
// ---------------------------------------------------------------------------

/** Gjendja e plotë e abonimit + rinovimi + a është parë mirëseardhja. */
export interface SubExtra {
  autoRenew: boolean;
  hasStripeSub: boolean;
  welcomeSeenAt: string | null;
}

export async function loadSubExtra(userId: string): Promise<SubExtra> {
  const { data } = await supabase.from('profiles')
    .select('auto_renew, stripe_subscription_id, welcome_seen_at')
    .eq('id', userId).maybeSingle();
  const d = (data ?? {}) as { auto_renew?: boolean; stripe_subscription_id?: string | null; welcome_seen_at?: string | null };
  return {
    autoRenew: d.auto_renew !== false,
    hasStripeSub: !!d.stripe_subscription_id,
    welcomeSeenAt: d.welcome_seen_at ?? null,
  };
}

/** Ndez ose fik rinovimin automatik. Fikja NUK e ndërpret aksesin — abonimi vlen deri në fund
 *  të periudhës së paguar dhe thjesht nuk rifaturohet. */
export async function setAutoRenew(enabled: boolean): Promise<{ ok?: boolean; auto_renew?: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ plan: 'autorenew', enabled }),
    });
    return (await resp.json().catch(() => ({}))) as { ok?: boolean; auto_renew?: boolean; error?: string };
  } catch (e) { return { error: (e as Error).message }; }
}

export interface MyPayment {
  id: string; plan: string; amount_cents: number; currency: string; status: string;
  paid_at: string | null; period_end: string | null; invoice_url: string | null;
}

/** Faturat e MIA — RLS-ja e kufizon vetë te rreshtat e përdoruesit të kyçur. */
export async function loadMyPayments(): Promise<MyPayment[]> {
  const { data } = await supabase.from('payments')
    .select('id, plan, amount_cents, currency, status, paid_at, period_end, invoice_url')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(24);
  return (data ?? []) as MyPayment[];
}

/** Shënon mirëseardhjen si të parë, që të mos shfaqet sërish në çdo hyrje. */
export async function markWelcomeSeen(userId: string): Promise<void> {
  await supabase.from('profiles').update({ welcome_seen_at: new Date().toISOString() }).eq('id', userId);
}
