import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// KUJTESA E ABONIMIT — cron ditor: përdoruesve që u skadon abonimi brenda 7 DITËVE u dërgohet
// push notification (një herë për skadim) + njoftim në aplikacion. Respekton preferencën
// 'subscription' te profiles.notification_preferences.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Portë sigurie për cron.
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "unauthorized" }, 401); }

  // Shëno si të skaduara provat/abonimet e mbaruara (para se të llogariten kujtesat).
  try { await db.rpc("expire_subscriptions"); } catch { /* best-effort */ }

  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const { data: rows } = await db.from("profiles")
    .select("id, subscription_expires_at, sub_reminder_sent_at, notification_preferences")
    .not("subscription_expires_at", "is", null)
    .gte("subscription_expires_at", now.toISOString())
    .lte("subscription_expires_at", in7d.toISOString());

  let sent = 0;
  for (const r of (rows ?? []) as Array<{ id: string; subscription_expires_at: string; sub_reminder_sent_at: string | null; notification_preferences?: Record<string, unknown> }>) {
    // Një kujtesë PËR SKADIM: nëse kujtesa e fundit është dërguar pas (skadimi − 7 ditë), mos ridërgo.
    const windowStart = new Date(new Date(r.subscription_expires_at).getTime() - 7 * 24 * 3600 * 1000);
    if (r.sub_reminder_sent_at && new Date(r.sub_reminder_sent_at) >= windowStart) continue;
    // Preferenca 'subscription' e fikur shprehimisht → mos dërgo push (por shëno që u trajtua).
    const prefOff = (r.notification_preferences ?? {})["subscription"] === false;
    const dateTxt = new Date(r.subscription_expires_at).toLocaleDateString("en-GB");
    if (!prefOff) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/web-push-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ user_id: r.id, title: "⏳ Abonimi po skadon", body: `Abonimi yt skadon më ${dateTxt} — rinovoje me kohë që të mos ndalen shërbimet.`, url: "/", tag: "sub-reminder" }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* push best-effort */ }
    }
    // Njoftim edhe në aplikacion (zilja) — pavarësisht push-it.
    try {
      await db.from("notifications").insert({
        user_id: r.id, type: "subscription", title: "⏳ Abonimi po skadon",
        body: `Abonimi yt skadon më ${dateTxt} — rinovoje me kohë.`, is_broadcast: false,
      });
    } catch { /* */ }
    // KUJTESA ME EMAIL — i njëjti kufizim si push-i (preferenca 'subscription').
    if (!prefOff) {
      try {
        const { data: u } = await db.auth.admin.getUserById(r.id);
        const email = u?.user?.email;
        if (email) {
          const { data: prof } = await db.from("profiles")
            .select("first_name, full_name").eq("id", r.id).maybeSingle();
          const p = prof as { first_name?: string; full_name?: string } | null;
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              template: "expiry", to: email, user_id: r.id,
              vars: { name: p?.first_name || p?.full_name || "", expires: dateTxt },
            }),
            signal: AbortSignal.timeout(12000),
          });
        }
      } catch { /* email best-effort */ }
    }
    await db.from("profiles").update({ sub_reminder_sent_at: now.toISOString() }).eq("id", r.id);
    sent++;
  }
  return json({ ok: true, checked: (rows ?? []).length, sent });
});
