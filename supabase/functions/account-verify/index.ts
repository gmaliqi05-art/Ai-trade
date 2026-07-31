import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Verifikon kodin 6-shifror të qasjes (të dhënë nga admini) për një përdorues të sapoardhur.
// Kodi ruhet te profiles.access_code dhe NUK ekspozohet kurrë te klienti — krahasimi bëhet NË SERVER.
// Në sukses: profiles.is_verified = true → useri fiton qasje te faqet e tregtimit (jo VIP).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ valid: false }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Identifiko përdoruesin nga JWT-ja e tij.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ valid: false, error: "unauthorized" }, 401);
    const { data: u } = await db.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json({ valid: false, error: "unauthorized" }, 401);

    const { code } = await req.json().catch(() => ({}));
    const input = String(code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(input)) return json({ valid: false });

    const { data: prof } = await db.from("profiles").select("access_code, is_verified").eq("id", userId).maybeSingle();
    const p = prof as { access_code?: string | null; is_verified?: boolean } | null;
    // Nëse është tashmë i verifikuar → OK (idempotent).
    if (p?.is_verified) return json({ valid: true });
    if (!p?.access_code || String(p.access_code).trim() !== input) return json({ valid: false });

    const { error } = await db.from("profiles").update({ is_verified: true }).eq("id", userId);
    if (error) return json({ valid: false, error: error.message }, 500);
    return json({ valid: true });
  } catch (e) {
    return json({ valid: false, error: (e as Error).message }, 500);
  }
});
