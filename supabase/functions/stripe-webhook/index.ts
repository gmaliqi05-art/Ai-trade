import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// STRIPE WEBHOOK — burimi i së vërtetës për gjendjen e abonimit. Dëgjon:
//  • checkout.session.completed / invoice.paid  → abonimi AKTIV (+ data e skadimit)
//  • customer.subscription.updated              → status + periudha e re
//  • customer.subscription.deleted              → anuluar
// Verifikimi i firmës bëhet me STRIPE_WEBHOOK_SECRET (skema t=…,v1=… e Stripe).
// verify_jwt=false — thirret nga Stripe, jo nga përdorues.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Verifikim HMAC-SHA256 i firmës së Stripe (pa SDK).
async function verify(sig: string, payload: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
    const t = parts["t"], v1 = parts["v1"];
    if (!t || !v1) return false;
    // Mbrojtje nga ripërsëritja: mos prano ngjarje më të vjetra se 5 minuta.
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    // Krahasim me kohë konstante.
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const raw = await req.text();

  let secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  if (!secret) {
    // Rezervë: çelësi i vendosur nga Admini te faqja Pagesat (billing_secrets, vetëm service-role).
    const { data: bs } = await db.from("billing_secrets").select("stripe_webhook_secret").eq("id", 1).maybeSingle();
    secret = String(bs?.stripe_webhook_secret || "");
  }
  const sig = req.headers.get("stripe-signature") || "";
  if (!secret) return json({ error: "webhook_not_configured" }, 503);
  if (!(await verify(sig, raw, secret))) return json({ error: "bad_signature" }, 400);

  let event: Record<string, unknown>;
  try { event = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const type = String(event.type || "");
  const obj = ((event.data as Record<string, unknown>)?.object ?? {}) as Record<string, unknown>;
  const meta = (obj.metadata ?? {}) as Record<string, string>;

  // IDEMPOTENCË: nëse ngjarja është trajtuar, dil menjëherë.
  const evId = String(event.id || "");
  if (evId) {
    const { data: seen } = await db.from("subscription_events").select("id").eq("id", evId).maybeSingle();
    if (seen) return json({ ok: true, duplicate: true });
  }

  // Gjej përdoruesin: nga metadata, ose nga customer/subscription i ruajtur.
  let userId = meta.user_id || "";
  const customer = String(obj.customer ?? "");
  const subId = String(obj.subscription ?? obj.id ?? "");
  if (!userId && customer) {
    const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", customer).maybeSingle();
    userId = (data as { id?: string } | null)?.id ?? "";
  }
  if (!userId && subId) {
    const { data } = await db.from("profiles").select("id").eq("stripe_subscription_id", subId).maybeSingle();
    userId = (data as { id?: string } | null)?.id ?? "";
  }

  const plan = meta.plan === "yearly" ? "yearly" : meta.plan === "monthly" ? "monthly" : null;
  const periodEnd = Number(obj.current_period_end ?? 0);
  const expiresAt = periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null;

  if (userId) {
    const patch: Record<string, unknown> = {};
    switch (type) {
      case "checkout.session.completed":
      case "invoice.paid": {
        patch.subscription_status = "active";
        if (plan) patch.subscription_tier = plan;
        if (customer) patch.stripe_customer_id = customer;
        if (subId) patch.stripe_subscription_id = subId;
        patch.subscription_started_at = new Date().toISOString();
        // Skadimi: nga periudha e Stripe ose +1 muaj/vit sipas planit.
        patch.subscription_expires_at = expiresAt
          ?? new Date(Date.now() + (plan === "yearly" ? 365 : 30) * 24 * 3600 * 1000).toISOString();
        patch.sub_reminder_sent_at = null; // rinis kujtesën për periudhën e re
        break;
      }
      case "customer.subscription.updated": {
        const st = String(obj.status ?? "");
        patch.subscription_status = st === "active" || st === "trialing" ? "active"
          : st === "past_due" || st === "unpaid" ? "past_due"
          : st === "canceled" ? "canceled" : st || "active";
        if (subId) patch.stripe_subscription_id = subId;
        if (expiresAt) patch.subscription_expires_at = expiresAt;
        break;
      }
      case "customer.subscription.deleted": {
        patch.subscription_status = "canceled";
        if (expiresAt) patch.subscription_expires_at = expiresAt;
        break;
      }
      case "invoice.payment_failed": {
        patch.subscription_status = "past_due";
        break;
      }
    }
    if (Object.keys(patch).length) {
      try { await db.from("profiles").update(patch).eq("id", userId); } catch { /* */ }
    }

    // ---------- EMAIL-ET E ABONIMIT ----------
    // Cili model i takon kësaj ngjarjeje. KUJDES me dublimin: te blerja e parë Stripe lëshon
    // EDHE 'checkout.session.completed' EDHE 'invoice.paid'. Prandaj fatura e parë
    // (billing_reason = 'subscription_create') nuk dërgon asgjë — konfirmimin e dërgon checkout-i.
    const reason = String(obj.billing_reason ?? "");
    let mail: string | null = null;
    if (type === "checkout.session.completed") mail = "billing";
    else if (type === "invoice.paid") mail = reason === "subscription_create" ? null : "renewed";
    else if (type === "invoice.payment_failed") mail = "payment_failed";
    else if (type === "customer.subscription.deleted") mail = "canceled";

    if (mail) {
      try {
        const { data: u } = await db.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (email) {
          const { data: prof } = await db.from("profiles")
            .select("first_name, full_name, subscription_tier, subscription_expires_at")
            .eq("id", userId).maybeSingle();
          const p = prof as {
            first_name?: string; full_name?: string;
            subscription_tier?: string; subscription_expires_at?: string;
          } | null;
          const fmt = (iso: unknown) => iso ? new Date(String(iso)).toLocaleDateString("en-GB") : "—";
          // Shuma vjen nga vetë ngjarja e Stripe (në cent) — pa hamendësime çmimesh.
          const cents = Number(obj.amount_total ?? obj.amount_paid ?? 0);
          const cur = String(obj.currency ?? "eur").toUpperCase();
          const tier = plan ?? p?.subscription_tier ?? "";
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              template: mail, to: email, user_id: userId,
              vars: {
                name: p?.first_name || p?.full_name || "",
                plan: tier === "yearly" ? "Yearly" : tier === "monthly" ? "Monthly" : "Subscription",
                amount: cents > 0 ? `${(cents / 100).toFixed(2)} ${cur}` : "",
                start: fmt(patch.subscription_started_at),
                expires: fmt(patch.subscription_expires_at ?? p?.subscription_expires_at),
                invoice: String(obj.id ?? ""),
              },
            }),
            signal: AbortSignal.timeout(15000),
          });
        }
      } catch { /* email best-effort — kurrë s'e prish webhook-un */ }
    }
  }

  // Regjistro ngjarjen (audit + idempotencë).
  try {
    await db.from("subscription_events").insert({ id: evId || crypto.randomUUID(), user_id: userId || null, type, payload: event });
  } catch { /* */ }
  return json({ ok: true });
});
