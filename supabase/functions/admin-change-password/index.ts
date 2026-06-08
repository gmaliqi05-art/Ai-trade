import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: jwtErr } = await adminClient.auth.getUser(jwt);
    if (jwtErr || !caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: corsHeaders });
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .single();

    if (!callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { user_id, new_password } = body as { user_id?: string; new_password?: string };

    if (!user_id || !new_password) {
      return new Response(JSON.stringify({ error: "user_id and new_password are required" }), { status: 400, headers: corsHeaders });
    }
    if (new_password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), { status: 400, headers: corsHeaders });
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, { password: new_password });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
