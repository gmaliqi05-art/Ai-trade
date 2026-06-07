import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-delete-user — fshin një përdorues TËRËSISHT (përfshirë nga auth.users),
// që emaili të lirohet për regjistrim të ri. Vetëm super-admin.
// Heq fillimisht rreshtat te tabelat me FK "NO ACTION" (që përndryshe bllokojnë fshirjen
// e profilit nga cascade), pastaj fshin përdoruesin nga auth (cascade për pjesën tjetër).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Tabela që referojnë profiles me ON DELETE NO ACTION → duhen pastruar para fshirjes.
const BLOCKING_BY_USER = ["trades", "portfolio_positions", "push_tokens", "subscriptions", "watchlist", "mt_market_data", "signals"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // SIGURIA: vetëm super-admin. Identifiko thirrësin nga JWT-ja.
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await svc.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!(prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetId = (body as { user_id?: string }).user_id;
    if (!targetId) return json({ error: "user_id required" }, 400);
    if (targetId === u.user.id) return json({ error: "Nuk mund të fshish llogarinë tënde nga këtu." }, 400);

    // 1) Pastro tabelat bllokuese (NO ACTION) sipas user_id.
    for (const tbl of BLOCKING_BY_USER) {
      try { await svc.from(tbl).delete().eq("user_id", targetId); } catch { /* injoro nëse tabela s'ekziston */ }
    }
    // admin_audit_log → admin_id (nëse përdoruesi ka qenë admin).
    try { await svc.from("admin_audit_log").delete().eq("admin_id", targetId); } catch { /* injoro */ }

    // 2) Fshi nga auth.users → cascade për profiles + pjesën tjetër.
    const { error: delErr } = await svc.auth.admin.deleteUser(targetId);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
