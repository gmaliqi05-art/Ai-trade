import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// STRIPE CHECKOUT — krijon sesionin e pagesës për abonimin (mujor ose vjetor) dhe kthen URL-në.
// Çmimet ndërtohen INLINE (price_data) → s'ka nevojë për Price ID të para-krijuar te Stripe;
// mjafton sekreti STRIPE_SECRET_KEY. Sukses/anulim → kthehet te aplikacioni.
// Veprimi 'trial' nis provën FALAS 15-ditore (pa Stripe, pa kartë).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// PLANET (një burim i vetëm i së vërtetës për çmimet — përdoret edhe te UI).
const PLANS = {
  monthly: { amount: 6900, interval: "month", label: "Sinjale Telegram + Robot auto-trade — mujor" },
  yearly: { amount: 69900, interval: "year", label: "Sinjale Telegram + Robot auto-trade — vjetor" },
} as const;
const TRIAL_DAYS = 15;

// Thirrje te Stripe REST (form-encoded) — pa SDK, i lehtë për Deno.
async function stripe(path: string, key: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      "Authorization": `Bearer ${key}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(String((body as { error?: { message?: string } })?.error?.message || `Stripe ${resp.status}`));
  return body as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data: u } = await db.auth.getUser(jwt);
    const userId = u?.user?.id, email = u?.user?.email;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const plan = String(body.plan || "");
    const { data: prof } = await db.from("profiles")
      .select("stripe_customer_id, subscription_status, trial_ends_at, first_name, last_name").eq("id", userId).maybeSingle();
    const p = prof as { stripe_customer_id?: string | null; subscription_status?: string; trial_ends_at?: string | null; first_name?: string; last_name?: string } | null;

    // ---- PROVA FALAS 15 DITORE (pa Stripe) ----
    if (plan === "trial") {
      if (p?.trial_ends_at) return json({ error: "trial_used" }, 400); // një provë për llogari
      const ends = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
      const { error } = await db.from("profiles").update({
        subscription_tier: "trial", subscription_status: "trialing",
        trial_ends_at: ends, subscription_expires_at: ends,
        subscription_started_at: new Date().toISOString(),
      }).eq("id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, trial: true, expires_at: ends });
    }

    // ---- ABONIM ME PAGESË (Stripe Checkout) ----
    if (plan !== "monthly" && plan !== "yearly") return json({ error: "bad_plan" }, 400);
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return json({ error: "stripe_not_configured", message: "Mungon STRIPE_SECRET_KEY te sekretet e Supabase." }, 503);

    // Klienti te Stripe (rifitohet nëse ekziston) — që abonimet të mos dublohen.
    let customer = p?.stripe_customer_id || "";
    if (!customer) {
      const c = await stripe("customers", key, {
        email: email || "",
        name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (email || ""),
        "metadata[user_id]": userId,
      });
      customer = String(c.id);
      await db.from("profiles").update({ stripe_customer_id: customer }).eq("id", userId);
    }

    const cfg = PLANS[plan];
    const origin = String(body.origin || req.headers.get("origin") || "").replace(/\/+$/, "");
    const session = await stripe("checkout/sessions", key, {
      mode: "subscription",
      customer,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(cfg.amount),
      "line_items[0][price_data][recurring][interval]": cfg.interval,
      "line_items[0][price_data][product_data][name]": cfg.label,
      "metadata[user_id]": userId,
      "metadata[plan]": plan,
      "subscription_data[metadata][user_id]": userId,
      "subscription_data[metadata][plan]": plan,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      locale: "auto",
      allow_promotion_codes: "true",
    });
    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
