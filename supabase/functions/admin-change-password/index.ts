import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-change-password — ndryshon fjalëkalimin e një përdoruesi. Vetëm super-admin.
// Ndjek të njëjtin model sigurie si admin-delete-user (userClient me anon + Authorization).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
    const newPassword = (body as { new_password?: string }).new_password;
    if (!targetId || !newPassword) return json({ error: "user_id dhe new_password janë të detyrueshëm" }, 400);
    if (newPassword.length < 6) return json({ error: "Fjalëkalimi duhet të ketë të paktën 6 karaktere" }, 400);

    const { error: updErr } = await svc.auth.admin.updateUserById(targetId, { password: newPassword });
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
