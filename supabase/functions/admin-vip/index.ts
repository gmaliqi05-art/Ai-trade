import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Menaxhim nga SUPER-ADMIN:
//  - liston përdoruesit (email + is_vip + is_admin + is_verified + access_code)
//  - jep/heq privilegjin VIP (profiles.is_vip)
//  - rigjeneron kodin 6-shifror të qasjes (profiles.access_code)
//  - shënon manualisht një përdorues si të verifikuar / jo
//  - liston kërkesat për VIP (vip_requests) dhe i aprovon/refuzon
// I mbrojtur — vetëm përdorues me profiles.is_admin (kontrollohet nga JWT-ja e thirrësit).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Kod qasjeje 6-shifror i rastësishëm.
function gen6(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

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

  // Vendos/hiq VIP për një përdorues. Burimi 'admin' → i hapet vetë, pa kod (deri sa admini ta heqë).
  if (action === "set") {
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "no_user" }, 400);
    const { error } = await db.from("profiles")
      .update({ is_vip: !!body.is_vip, vip_source: body.is_vip ? "admin" : null }).eq("id", userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Shëno manualisht të verifikuar / jo (qasje te faqet e tregtimit).
  if (action === "set_verified") {
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "no_user" }, 400);
    const { error } = await db.from("profiles").update({ is_verified: !!body.is_verified }).eq("id", userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Rigjenero kodin 6-shifror të qasjes për një përdorues.
  if (action === "regen_code") {
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "no_user" }, 400);
    const code = gen6();
    const { error } = await db.from("profiles").update({ access_code: code }).eq("id", userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, access_code: code });
  }

  // Listo kërkesat për VIP (me email).
  if (action === "list_requests") {
    const { data: reqs } = await db.from("vip_requests")
      .select("id, user_id, status, note, created_at, resolved_at")
      .order("created_at", { ascending: false }).limit(200);
    const emailById = new Map<string, string>();
    try {
      // deno-lint-ignore no-explicit-any
      const { data: au } = await (db.auth as any).admin.listUsers({ page: 1, perPage: 1000 });
      for (const x of (au?.users ?? [])) emailById.set(x.id, x.email ?? "");
    } catch { /* pa email nëse s'lexohet dot */ }
    // deno-lint-ignore no-explicit-any
    const requests = ((reqs ?? []) as any[]).map((r) => ({
      id: r.id, user_id: r.user_id, email: emailById.get(r.user_id) || r.user_id,
      status: r.status, note: r.note, created_at: r.created_at, resolved_at: r.resolved_at,
    }));
    return json({ ok: true, requests });
  }

  // Aprovo / refuzo një kërkesë VIP. Aprovim → profiles.is_vip=true.
  if (action === "resolve_request") {
    const id = String(body.request_id || "");
    const decision = String(body.decision || ""); // 'approve' | 'reject'
    if (!id || (decision !== "approve" && decision !== "reject")) return json({ error: "bad_request" }, 400);
    const { data: reqRow } = await db.from("vip_requests").select("user_id, status").eq("id", id).maybeSingle();
    const rr = reqRow as { user_id?: string; status?: string } | null;
    if (!rr?.user_id) return json({ error: "not_found" }, 404);
    const status = decision === "approve" ? "approved" : "rejected";
    const { error: e1 } = await db.from("vip_requests").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
    if (e1) return json({ error: e1.message }, 500);
    if (decision === "approve") {
      const { error: e2 } = await db.from("profiles").update({ is_vip: true, vip_source: "admin" }).eq("id", rr.user_id);
      if (e2) return json({ error: e2.message }, 500);
    }
    return json({ ok: true });
  }

  // Listo përdoruesit (email + is_vip + is_admin + is_verified + access_code).
  const { data: profs } = await db.from("profiles").select("id, is_vip, is_admin, is_verified, access_code, vip_source, full_name, username, created_at");
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
    is_verified: !!p.is_verified,
    access_code: p.access_code || null,
    vip_source: p.vip_source || null,
    created_at: p.created_at || null,
  })).sort((a, b) => (a.is_admin === b.is_admin ? String(a.email).localeCompare(String(b.email)) : a.is_admin ? -1 : 1));
  return json({ ok: true, users });
});
