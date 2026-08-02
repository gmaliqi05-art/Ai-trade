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

// ÇMIMET & PROVA lexohen nga billing_config (tabela që menaxhon Admini te "Planet e
// Abonimit") → regjistrimi, cilësimet dhe checkout-i janë GJITHMONË të sinkronizuar.
// Vlerat më poshtë janë vetëm rezervë nëse rreshti mungon.
const FALLBACK = { trial_days: 15, monthly_eur: 69, yearly_eur: 699 };

// Çelësi i Stripe: sekreti i env-it ka përparësi; ndryshe lexohet nga billing_secrets
// (tabela pa RLS-politika → e lexon vetëm service-role; Admini e vendos nga faqja Pagesat).
// deno-lint-ignore no-explicit-any
async function stripeSecretKey(db: any): Promise<string> {
  const env = Deno.env.get("STRIPE_SECRET_KEY");
  if (env) return env;
  const { data } = await db.from("billing_secrets").select("stripe_secret_key").eq("id", 1).maybeSingle();
  return String(data?.stripe_secret_key || "");
}

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

    // Konfigurimi aktual i çmimeve (i menaxhuar nga Admini).
    const { data: bcRow } = await db.from("billing_config").select("*").eq("id", 1).maybeSingle();
    const bc = {
      trial_days: Number(bcRow?.trial_days ?? FALLBACK.trial_days),
      monthly_eur: Number(bcRow?.monthly_eur ?? FALLBACK.monthly_eur),
      yearly_eur: Number(bcRow?.yearly_eur ?? FALLBACK.yearly_eur),
    };

    // ---- PROVA FALAS (ditët nga billing_config, pa Stripe) ----
    if (plan === "trial") {
      if (p?.trial_ends_at) return json({ error: "trial_used" }, 400); // një provë për llogari
      const ends = new Date(Date.now() + bc.trial_days * 24 * 3600 * 1000).toISOString();
      const { error } = await db.from("profiles").update({
        subscription_tier: "trial", subscription_status: "trialing",
        trial_ends_at: ends, subscription_expires_at: ends,
        subscription_started_at: new Date().toISOString(),
      }).eq("id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, trial: true, expires_at: ends });
    }

    // ---- PORTALI I FATURIMIT: menaxho kartën / anulo abonimin (Stripe Customer Portal) ----
    if (plan === "portal") {
      const key0 = await stripeSecretKey(db);
      if (!key0) return json({ error: "stripe_not_configured" }, 503);
      if (!p?.stripe_customer_id) return json({ error: "no_customer" }, 400);
      const origin0 = String(body.origin || req.headers.get("origin") || "").replace(/\/+$/, "");
      const portal = await stripe("billing_portal/sessions", key0, {
        customer: p.stripe_customer_id,
        return_url: `${origin0}/`,
      });
      return json({ ok: true, url: portal.url });
    }

    // ---- ABONIM ME PAGESË (Stripe Checkout) — kartë Debit/Kredit, rinovim AUTOMATIK ----
    if (plan !== "monthly" && plan !== "yearly") return json({ error: "bad_plan" }, 400);
    const key = await stripeSecretKey(db);
    if (!key) return json({ error: "stripe_not_configured", message: "Vendos çelësin e Stripe te Admin → Pagesat." }, 503);

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

    const cfg = plan === "monthly"
      ? { amount: Math.round(bc.monthly_eur * 100), interval: "month", label: "Sinjale Telegram + Robot auto-trade — mujor" }
      : { amount: Math.round(bc.yearly_eur * 100), interval: "year", label: "Sinjale Telegram + Robot auto-trade — vjetor" };
    const origin = String(body.origin || req.headers.get("origin") || "").replace(/\/+$/, "");
    const session = await stripe("checkout/sessions", key, {
      mode: "subscription",                     // rinovim AUTOMATIK (si çdo abonim standard)
      "payment_method_types[0]": "card",         // vetëm kartë Debit/Kredit
      customer,
      billing_address_collection: "auto",
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
