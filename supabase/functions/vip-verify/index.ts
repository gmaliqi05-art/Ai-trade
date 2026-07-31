import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Verifikon kodin VIP NË SERVER — kodet ruhen te vip_access_codes dhe NUK ekspozohen kurrë te klienti.
// RREGULLA (31 korrik 2026): një kod vlen VETËM për përdoruesin të cilit ia ka caktuar admini
// (vip_access_codes.user_id). Kod i pacaktuar ose i dikujt tjetër → i pavlefshëm. Kështu kodi i
// një përdoruesi s'mund të përdoret nga të tjerët.
// Në sukses: profiles.is_vip=true me vip_source='code'.
// Veprimi 'lock': mbyll qasjen VIP të vetes (vetëm kur burimi është 'code') — is_vip=false,
// që rihyrja të kërkojë sërish kodin. VIP e dhënë nga admini ('admin') NUK mbyllet nga këtu.
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
    // Identifiko thirrësin — i DETYRUESHËM (kodi lidhet me llogarinë e tij).
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ valid: false, error: "unauthorized" }, 401);
    const { data: u } = await db.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json({ valid: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // MBYLLJA e qasjes VIP (vetë-shërbim, vetëm për VIP me kod).
    if (body.action === "lock") {
      await db.from("profiles").update({ is_vip: false, vip_source: null })
        .eq("id", userId).eq("vip_source", "code");
      return json({ ok: true });
    }

    const input = String(body.code || "").trim();
    if (!input) return json({ valid: false });
    const { data } = await db.from("vip_access_codes").select("id, label, active, user_id").eq("code", input).maybeSingle();
    // Kodi duhet të jetë aktiv DHE i caktuar PIKËRISHT këtij përdoruesi.
    if (!data || !data.active) return json({ valid: false });
    if (!data.user_id || String(data.user_id) !== String(userId)) return json({ valid: false });
    // Rrit numëruesin (best-effort — s'e bllokon përgjigjen).
    try { await db.rpc("increment_vip_use", { p_id: data.id }); } catch { /* */ }
    // Shëno VIP me burim 'code' — robotët MMT/Sinjalet punojnë për të; mbyllet me action 'lock'.
    const { error } = await db.from("profiles").update({ is_vip: true, vip_source: "code" }).eq("id", userId);
    if (error) return json({ valid: false, error: error.message }, 500);
    return json({ valid: true, label: data.label ?? null });
  } catch (e) {
    return json({ valid: false, error: (e as Error).message }, 500);
  }
});
