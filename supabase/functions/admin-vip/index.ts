import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Menaxhim VIP nga SUPER-ADMIN: liston përdoruesit dhe u jep/heq privilegjin VIP (profiles.is_vip).
// I mbrojtur — vetëm përdorues me profiles.is_admin (kontrollohet nga JWT-ja e thirrësit).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Kontrollo që thirrësi është ADMIN.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const { data: caller } = await db.auth.getUser(jwt);
  const callerId = caller?.user?.id;
  if (!callerId) return json({ error: "unauthorized" }, 401);
  const { data: me } = await db.from("profiles").select("is_admin").eq("id", callerId).maybeSingle();
  if (!(me as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "list");

  // Vendos/hiq VIP për një përdorues.
  if (action === "set") {
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "no_user" }, 400);
    const { error } = await db.from("profiles").update({ is_vip: !!body.is_vip }).eq("id", userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Listo përdoruesit (email + is_vip + is_admin).
  const { data: profs } = await db.from("profiles").select("id, is_vip, is_admin, full_name, username");
  const emailById = new Map<string, string>();
  try {
    // deno-lint-ignore no-explicit-any
    const { data: au } = await (db.auth as any).admin.listUsers({ page: 1, perPage: 1000 });
    for (const x of (au?.users ?? [])) emailById.set(x.id, x.email ?? "");
  } catch { /* pa email nëse s'lexohet dot */ }
  // deno-lint-ignore no-explicit-any
  const users = ((profs ?? []) as any[]).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) || p.username || p.full_name || p.id,
    is_vip: !!p.is_vip,
    is_admin: !!p.is_admin,
  })).sort((a, b) => (a.is_admin === b.is_admin ? String(a.email).localeCompare(String(b.email)) : a.is_admin ? -1 : 1));
  return json({ ok: true, users });
});
