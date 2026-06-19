import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// mmti-shadow — MMTI Faza C (SKELET, modaliteti SHADOW).
//
// ÇFARË BËN:  Provon strategjinë e optimizuar të MMTI-së mbi sinjalet REALE — por
//             PA PARA, PA MetaApi, PA prekur robotin aktual. "Hap" trade-t virtuale
//             me TP-në më të gjerë të MMTI-së (R:R i synuar) dhe i ndjek kundër çmimit
//             aktual (assets.current_price) derisa të prekin TP/SL ose të skadojnë.
//
// ÇFARË S'BËN: Nuk dërgon asnjë urdhër te tregu. Nuk lexon as shkruan te metaapi_config.
//             Nuk e prek auto-trade-runner-in. live_enabled raportohet, por edhe kur
//             është true, ky funksion S'EKZEKUTON kurrë trade real — kjo është vetëm
//             matja e performancës para aktivizimit (pas ~100 trade + miratimit).
//
// Cron: çdo 5 min (mmti-shadow-every-5min). Portë sigurie x-cron-secret (fail-safe lejo).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

// Normalizon simbolin për përputhje midis signals (XAUUSD) dhe assets (XAU/USD, etj.).
function normSym(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const OPEN_WINDOW_MIN = 15;      // sinjale të freskëta (si engine-scan) për të hapur shadow-trade
const EXPIRE_H = 48;            // shadow-trade i pambyllur pas 48h → mbyllet si 'expired'

// Njoftim Web Push te admin-at për aktivitetin e MMTI-së (provë/shadow) — best-effort.
async function pushAdmins(db: ReturnType<typeof createClient>, title: string, body: string, tag: string): Promise<void> {
  try {
    const { data: admins } = await db.from("profiles").select("id").eq("is_admin", true);
    const ids = ((admins ?? []) as Array<{ id: string }>).map((a) => a.id);
    const base = Deno.env.get("SUPABASE_URL"), svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    for (const uid of ids) {
      try {
        await fetch(`${base}/functions/v1/web-push-send`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${svc}` },
          body: JSON.stringify({ user_id: uid, title, body, url: "/", tag }), signal: AbortSignal.timeout(8000),
        });
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Portë sigurie për cron (vetëm akses). Fail-safe: lejo nëse s'ka sekret/gabim.
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
  } catch { /* fail-safe */ }

  try {
    // 1) Gjendja e MMTI-së. Aktiv + ka plan të optimizuar → ndryshe s'ka çfarë të provojë ende.
    const { data: st } = await db.from("mmti_state").select("active, optimized_params, live_enabled").eq("id", 1).maybeSingle();
    const state = st as { active?: boolean; optimized_params?: Record<string, unknown> | null; live_enabled?: boolean } | null;
    if (!state || !state.active) return json({ skipped: "mmti_inactive", opened: 0, evaluated: 0 });
    const plan = state.optimized_params || null;
    const minConfidence = plan && typeof plan.minConfidence === "number" ? plan.minConfidence as number : 70;
    const recommendedR = plan && typeof plan.recommendedR === "number" ? plan.recommendedR as number : 2;

    let opened = 0, evaluated = 0;
    const closedMsgs: string[] = []; // përmbledhje e mbylljeve (për push)

    // 2) Çmimet aktuale (për hapje + vlerësim) — një lexim, hartë sipas simbolit të normalizuar.
    const { data: assetRows } = await db.from("assets").select("symbol, current_price");
    const priceBy = new Map<string, number>();
    for (const a of (assetRows ?? []) as { symbol: string; current_price: number | null }[]) {
      if (a.current_price != null) priceBy.set(normSym(a.symbol), Number(a.current_price));
    }

    // 3) HAPJE — vetëm nëse ka plan (Faza B e llogaritur). Pa plan, skeleti rri gati pa hapur.
    if (plan) {
      const sinceIso = new Date(Date.now() - OPEN_WINDOW_MIN * 60 * 1000).toISOString();
      // Sinjalet REALE platform-wide (si ato që sheh klienti), të freskëta dhe me besueshmëri ≥ pragu i MMTI-së.
      const { data: sigs } = await db
        .from("signals")
        .select("id, symbol, type, entry_price, stop_loss, confidence, created_at")
        .eq("source", "engine")
        .gte("created_at", sinceIso)
        .gte("confidence", minConfidence)
        .order("created_at", { ascending: false })
        .limit(50);

      for (const s of (sigs ?? []) as { id: string; symbol: string; type: string; entry_price: number | null; stop_loss: number | null; confidence: number; created_at: string }[]) {
        // MMTI është për ARIN — simulo vetëm sinjale ari (jo crypto/naftë), që mësimi të jetë i pastër.
        if (!/XAU|GOLD/i.test((s.symbol || "").toUpperCase())) continue;
        if (s.entry_price == null || s.stop_loss == null) continue;
        const entry = Number(s.entry_price);
        const slDist = Math.abs(entry - Number(s.stop_loss));
        if (!(slDist > 0)) continue;
        const isBuy = (s.type || "").toLowerCase() === "buy";
        // TP-ja më e gjerë e MMTI-së (R:R i synuar) mbi të njëjtën distancë SL si sinjali.
        const sl = Number(s.stop_loss);
        const tp = isBuy ? entry + slDist * recommendedR : entry - slDist * recommendedR;

        // Dedup: një shadow-trade për çdo sinjal.
        const { data: dup } = await db.from("mmti_shadow_trades").select("id").eq("signal_id", s.id).limit(1);
        if (dup && dup.length > 0) continue;

        await db.from("mmti_shadow_trades").insert({
          signal_id: s.id, symbol: s.symbol, action: isBuy ? "BUY" : "SELL",
          horizon: "long", entry, sl, tp, rr: recommendedR, status: "open",
        });
        opened++;
      }
    }

    // 4) VLERËSIM — ndjek shadow-trade-t e hapura kundër çmimit aktual: TP/SL/expired.
    const { data: open } = await db
      .from("mmti_shadow_trades")
      .select("id, symbol, action, entry, sl, tp, rr, created_at")
      .eq("status", "open")
      .limit(500);

    const expireBefore = Date.now() - EXPIRE_H * 60 * 60 * 1000;
    for (const t of (open ?? []) as { id: string; symbol: string; action: string; entry: number; sl: number; tp: number; rr: number; created_at: string }[]) {
      const price = priceBy.get(normSym(t.symbol));
      const isBuy = (t.action || "").toUpperCase() === "BUY";
      const entry = Number(t.entry), sl = Number(t.sl), tp = Number(t.tp), rr = Number(t.rr) || recommendedR;
      const slDist = Math.abs(entry - sl) || 1;

      let status: string | null = null, pnlR: number | null = null;
      if (price != null) {
        const hitTp = isBuy ? price >= tp : price <= tp;
        const hitSl = isBuy ? price <= sl : price >= sl;
        if (hitTp) { status = "tp"; pnlR = +rr; }
        else if (hitSl) { status = "sl"; pnlR = -1; }
      }
      if (!status && new Date(t.created_at).getTime() < expireBefore) {
        status = "expired";
        // R-ja e realizuar deri në skadim (sa lëvizi në favor/kundër, e shprehur në njësi rreziku).
        pnlR = price != null ? +(((isBuy ? price - entry : entry - price)) / slDist).toFixed(3) : 0;
      }
      if (status) {
        await db.from("mmti_shadow_trades").update({ status, pnl_r: pnlR, closed_at: new Date().toISOString() }).eq("id", t.id);
        evaluated++;
        closedMsgs.push(`${t.symbol} ${status.toUpperCase()} ${pnlR != null && pnlR >= 0 ? "+" : ""}${pnlR}R`);
      }
    }

    // Njoftim push te admin-at kur MMTI pati aktivitet (provë/shadow) — i përmbledhur që të mos jetë zhurmë.
    if (opened > 0 || closedMsgs.length > 0) {
      const parts: string[] = [];
      if (opened > 0) parts.push(`hapi ${opened} provë`);
      if (closedMsgs.length > 0) parts.push(`mbylli ${closedMsgs.length} (${closedMsgs.slice(0, 3).join(", ")})`);
      await pushAdmins(db, "MMTI — provë (shadow)", parts.join(" · "), "mmti");
    }

    return json({ success: true, mode: "shadow", live_enabled: !!state.live_enabled, opened, evaluated });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
