import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// EMAIL-ET E LLOGARISË — dy veprime:
//   'verify' → ridërgon kodin 6-shifror te përdoruesi i kyçur (kërkon JWT-në e tij)
//   'reset'  → dërgon lidhjen e rivendosjes së fjalëkalimit (PUBLIK, pa kyçje)
//
// SIGURIA:
//   • 'reset' kthen GJITHMONË ok:true — përndryshe do të tregonte se cili email ka llogari.
//   • Lidhja gjenerohet nga vetë Supabase (auth.admin.generateLink) → tokeni është i sigurt
//     dhe njëpërdorimësh; ne vetëm e dërgojmë me pamjen tonë përmes Resend.
//   • Kufizim: maksimum 3 email-e për të njëjtën adresë brenda 15 minutash.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SITE = "https://www.goldsniper.vip";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(URL_, SERVICE);

  const send = (template: string, to: string, vars: Record<string, unknown>, userId?: string) =>
    fetch(`${URL_}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}` },
      body: JSON.stringify({ template, to, vars, user_id: userId ?? null }),
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

  /** Mbrojtje nga abuzimi: sa email-e i janë dërguar kësaj adrese në 15 minutat e fundit. */
  const throttled = async (email: string) => {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await db.from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("to_email", email).gte("created_at", since);
    return (count ?? 0) >= 3;
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // ---------- RIDËRGIMI I KODIT TË VERIFIKIMIT ----------
    if (action === "verify") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
      const { data: u } = await db.auth.getUser(jwt);
      const user = u?.user;
      if (!user?.email) return json({ ok: false, error: "unauthorized" }, 401);

      const { data: prof } = await db.from("profiles")
        .select("access_code, is_verified, full_name, first_name").eq("id", user.id).maybeSingle();
      const p = prof as { access_code?: string; is_verified?: boolean; full_name?: string; first_name?: string } | null;
      if (p?.is_verified) return json({ ok: true, already: true });
      if (!p?.access_code) return json({ ok: false, error: "no_code" }, 400);

      if (await throttled(user.email)) return json({ ok: false, error: "throttled" }, 429);

      const r = await send("verify", user.email,
        { code: p.access_code, name: p.first_name || p.full_name || "" }, user.id);
      return json({ ok: !!r.ok, error: r.error });
    }

    // ---------- RIVENDOSJA E FJALËKALIMIT ----------
    if (action === "reset") {
      const email = String(body.email || "").trim().toLowerCase();
      // Përgjigje e njëjtë për çdo rast — mos zbulo nëse adresa ka llogari.
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: true });
      if (await throttled(email)) return json({ ok: true });

      const { data: link, error } = await db.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${SITE}/#reset` },
      });
      const action_link = (link as { properties?: { action_link?: string } } | null)?.properties?.action_link;
      if (error || !action_link) return json({ ok: true });

      const { data: prof } = await db.from("profiles")
        .select("first_name, full_name").eq("id", link!.user!.id).maybeSingle();
      const p = prof as { first_name?: string; full_name?: string } | null;

      await send("reset", email, { link: action_link, name: p?.first_name || p?.full_name || "" }, link!.user!.id);
      return json({ ok: true });
    }

    return json({ ok: false, error: "bad_action" }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
