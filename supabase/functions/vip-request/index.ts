import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Përdoruesi dërgon KËRKESË për abonim VIP. Krijon një rresht te vip_requests (status 'pending').
// Admini e sheh te paneli VIP dhe e aprovon (→ profiles.is_vip=true). Anti-dublim: nëse ka
// tashmë një kërkesë 'pending', s'krijon një tjetër.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: u } = await db.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

    // Nëse është tashmë VIP → s'ka nevojë për kërkesë.
    const { data: prof } = await db.from("profiles").select("is_vip").eq("id", userId).maybeSingle();
    if ((prof as { is_vip?: boolean } | null)?.is_vip) return json({ ok: true, already_vip: true });

    // A ka kërkesë 'pending' të hapur?
    const { data: existing } = await db.from("vip_requests").select("id").eq("user_id", userId).eq("status", "pending").limit(1);
    if (existing && existing.length > 0) return json({ ok: true, pending: true });

    const body = await req.json().catch(() => ({}));
    const note = body?.note ? String(body.note).slice(0, 500) : null;
    const { error } = await db.from("vip_requests").insert({ user_id: userId, status: "pending", note });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, created: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
