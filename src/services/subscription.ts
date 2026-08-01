import { supabase } from '../lib/supabase';

// ABONIMI: provë falas 15 ditë · mujor 69€ · vjetor 699€ (në vend të 828€ = 69×12).
// Pagesa kryhet me Stripe Checkout (funksioni 'stripe-checkout' krijon sesionin).

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const CHECKOUT_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-checkout`;

export const TRIAL_DAYS = 15;
export const PRICE_MONTHLY = 69;
export const PRICE_YEARLY = 699;
export const PRICE_YEARLY_FULL = 828;   // 69 × 12 — çmimi pa zbritje (tregohet i kryqëzuar)
export const YEARLY_SAVING = PRICE_YEARLY_FULL - PRICE_YEARLY; // 129€

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
