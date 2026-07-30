import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Verifikon kodin VIP NË SERVER — kodet ruhen te vip_access_codes dhe NUK ekspozohen kurrë te klienti.
// Kthen { valid, label } pa e treguar asnjë kod. Rrit numëruesin e përdorimeve në sukses.
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
    const { code } = await req.json().catch(() => ({}));
    const input = String(code || "").trim();
    if (!input) return json({ valid: false });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await db.from("vip_access_codes").select("id, label, active").eq("code", input).maybeSingle();
    if (!data || !data.active) return json({ valid: false });
    // Rrit numëruesin (best-effort — s'e bllokon përgjigjen).
    try { await db.rpc("increment_vip_use", { p_id: data.id }); } catch { /* */ }
    // Shëno përdoruesin si VIP në server (nga JWT-ja e tij) — kështu robotët MMT/Sinjalet
    // tregtojnë e njoftojnë VETËM për të. Mbetet derisa ta heqësh nga super-admin.
    try {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const { data: u } = await db.auth.getUser(jwt);
        if (u?.user?.id) await db.from("profiles").update({ is_vip: true }).eq("id", u.user.id);
      }
    } catch { /* jo-kritike për verifikimin */ }
    return json({ valid: true, label: data.label ?? null });
  } catch (e) {
    return json({ valid: false, error: (e as Error).message }, 500);
  }
});
