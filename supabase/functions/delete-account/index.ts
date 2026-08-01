import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// FSHIRJA E LLOGARISË (vetë-shërbim, e detyrueshme për privatësinë): përdoruesi konfirmon me
// FJALËKALIMIN e vet → fshihen të gjitha të dhënat e tij + llogaria në auth — PËRGJITHMONË.
// Rrjedha në klient: paralajmërim ("të gjitha të dhënat humbin") → fjalëkalimi → fshirja.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Tabelat me të dhëna të përdoruesit — fshihen shprehimisht (best-effort) para llogarisë,
// që asgjë të mos mbetet edhe nëse ndonjë FK s'ka ON DELETE CASCADE.
const USER_TABLES = [
  "journal_notes", "vip_requests", "push_tokens", "notifications",
  "telegram_trades", "telegram_signals", "gold_sniper_posts", "gold_sniper_config",
  "pre_open_orders", "position_closes", "trade_executions", "open_pos_snapshot",
  "signals", "metaapi_config", "metaapi_usage_log", "profiles",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Identifiko përdoruesin nga JWT-ja.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data: u } = await db.auth.getUser(jwt);
    const userId = u?.user?.id;
    const email = u?.user?.email;
    if (!userId || !email) return json({ error: "unauthorized" }, 401);

    // ADMINËT nuk fshihen nga vetja këtu (mbrojtje kundër humbjes aksidentale të super-adminit).
    const { data: prof } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
    if ((prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "admin_protected" }, 403);

    // VERIFIKIMI I FJALËKALIMIT — i detyrueshëm: provo hyrjen me email + fjalëkalimin e dhënë.
    const body = await req.json().catch(() => ({}));
    const password = String(body.password || "");
    if (!password) return json({ error: "no_password" }, 400);
    const authClient = createClient(supabaseUrl, anonKey);
    const { error: pwErr } = await authClient.auth.signInWithPassword({ email, password });
    if (pwErr) return json({ error: "wrong_password" }, 403);

    // FSHIRJA: së pari të dhënat e tabelave (best-effort), pastaj llogaria në auth (përfundimtare).
    for (const tbl of USER_TABLES) {
      try { await db.from(tbl).delete().eq("user_id", userId); } catch { /* tabela mund të mos ekzistojë */ }
    }
    try { await db.from("profiles").delete().eq("id", userId); } catch { /* profiles përdor 'id' */ }
    // deno-lint-ignore no-explicit-any
    const { error: delErr } = await (db.auth as any).admin.deleteUser(userId);
    if (delErr) return json({ error: String(delErr.message || delErr) }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
