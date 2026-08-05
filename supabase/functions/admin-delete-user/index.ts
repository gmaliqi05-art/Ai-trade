import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-delete-user — fshin një përdorues TËRËSISHT (përfshirë nga auth.users),
// që emaili të lirohet për regjistrim të ri. Vetëm super-admin.
//
// RISHIKIM (5 gusht 2026). Funksioni ekzistonte dhe butoni ishte i lidhur, por koha e kishte lënë
// pas: nga dita kur u shkrua janë shtuar shumë tabela, dhe tri gjëra kishin mbetur jashtë.
//
//   1) ABONIMI TE STRIPE. Fshirja e llogarisë nuk e ndalte abonimin — pra personi largohej nga
//      platforma dhe karta e tij vazhdonte të faturohej çdo muaj, pa asnjë vend ku ta shihte ose ta
//      ndalte. Ky ishte gabimi më i rëndë i të gjithëve: para të marra pa shërbim. Tani abonimi
//      anulohet i pari, dhe vetëm nëse ai hap kalon, vazhdohet me fshirjen.
//
//   2) 'vip_access_codes.created_by' → auth.users me NO ACTION. Nuk pastrohej, ndaj fshirja e çdo
//      përdoruesi që kishte krijuar një kod VIP dështonte me gabim çelësi të huaj.
//
//   3) TABELA PA ÇELËS TË HUAJ ('position_closes', 'open_pos_snapshot'). Nuk e bllokojnë fshirjen,
//      por rreshtat mbeten përgjithmonë me një user_id që s'ekziston më — dhe raportet e adminit
//      vazhdojnë t'i numërojnë. Tani hiqen shprehimisht.
//
// Rendi ka rëndësi: PARA, pastaj të dhëna. Nëse Stripe dështon, nuk fshihet asgjë — një llogari e
// fshirë me abonim të gjallë nuk rregullohet dot më nga paneli.
//
// SHËNIM PËR VENDOSJEN (5 gusht 2026): rishikimi më lart u merge-ua te 'main' dhe prapëseprapë
// PRODHIMI mbeti me versionin e vjetër — sepse ky funksion nuk kishte fare workflow deploy-i.
// Kodi ndryshonte, testet ishin të gjelbra, dhe abonimet vazhdonin të faturoheshin. Prandaj tani
// ekziston '.github/workflows/deploy-admin-delete-user.yml'; ky rresht është edhe prekja që e nis
// atë deploy të parë.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Tabela që referojnë profiles/auth me ON DELETE NO ACTION → duhen pastruar para fshirjes,
// përndryshe çelësi i huaj e bllokon.
const BLOCKING_BY_USER = [
  "trades", "portfolio_positions", "push_tokens", "subscriptions",
  "watchlist", "mt_market_data", "signals",
];

// Tabela me 'user_id' POR pa çelës të huaj → nuk bllokojnë, thjesht lënë rreshta jetimë te raportet.
const ORPHANS_BY_USER = ["position_closes", "open_pos_snapshot"];

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

    const { data: target } = await svc.from("profiles")
      .select("full_name, subscription_tier, subscription_status, stripe_subscription_id")
      .eq("id", targetId).maybeSingle();
    const tp = (target ?? {}) as {
      full_name?: string; subscription_tier?: string; subscription_status?: string;
      stripe_subscription_id?: string | null;
    };

    // ---------- 1) ABONIMI TE STRIPE ----------
    // Anulohet MENJËHERË (jo në fund të periudhës): llogaria po zhduket, ndaj s'ka kuptim të mbetet
    // një abonim që faturë pas fature nuk i shërben më askujt.
    let stripeNote = "pa abonim te Stripe";
    if (tp.stripe_subscription_id) {
      const envKey = Deno.env.get("STRIPE_SECRET_KEY");
      const { data: bs } = await svc.from("billing_secrets").select("stripe_secret_key").eq("id", 1).maybeSingle();
      const key = envKey || String((bs as { stripe_secret_key?: string } | null)?.stripe_secret_key || "");
      if (!key) {
        return json({ error: "Përdoruesi ka abonim aktiv te Stripe, por çelësi i Stripe nuk është konfiguruar. Fshirja u ndal që karta e tij të mos vazhdojë të faturohet." }, 409);
      }
      const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${tp.stripe_subscription_id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      });
      const sb = await resp.json().catch(() => ({}));
      const msg = String((sb as { error?: { message?: string } })?.error?.message || "");
      // "No such subscription" ose tashmë i anuluar → qëllimi është arritur gjithsesi.
      if (!resp.ok && !/no such subscription|already canceled/i.test(msg)) {
        return json({ error: `Anulimi i abonimit te Stripe dështoi: ${msg || resp.status}. Fshirja u ndal.` }, 502);
      }
      stripeNote = resp.ok ? "abonimi u anulua te Stripe" : "abonimi nuk ekzistonte më te Stripe";
    }

    // ---------- 2) TABELAT BLLOKUESE ----------
    for (const tbl of BLOCKING_BY_USER) {
      try { await svc.from(tbl).delete().eq("user_id", targetId); } catch { /* injoro nëse tabela s'ekziston */ }
    }
    // Referencat që nuk quhen 'user_id' por prapë bllokojnë.
    try { await svc.from("admin_audit_log").delete().eq("admin_id", targetId); } catch { /* injoro */ }
    try { await svc.from("vip_access_codes").delete().eq("created_by", targetId); } catch { /* injoro */ }

    // ---------- 3) RRESHTAT JETIMË ----------
    for (const tbl of ORPHANS_BY_USER) {
      try { await svc.from(tbl).delete().eq("user_id", targetId); } catch { /* injoro */ }
    }

    // ---------- 4) FSHIRJA ----------
    const { error: delErr } = await svc.auth.admin.deleteUser(targetId);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({
      ok: true,
      name: tp.full_name ?? null,
      had_plan: tp.subscription_tier ?? null,
      stripe: stripeNote,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
