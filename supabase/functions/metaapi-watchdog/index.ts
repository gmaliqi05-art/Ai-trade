import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// metaapi-watchdog — cron (çdo 2 min). ALARM I ZGJUAR për lidhjen MT5, PA prekur tregtimin.
// Provisioning API i MetaApi-t s'arrihet nga Supabase (DNS/SSL) → redeploy automatik s'bëhet dot;
// prandaj detektojmë me CLIENT-API (account-information) dhe NJOFTOJMË përdoruesin.
// Mbron nga false-alarme: (1) kërkon >=2 dështime radhazi (jo timeout kalimtar),
// (2) alarmon vetëm për llogari që ishin AKTIVE së fundi (jo ato të fikura me qëllim).
// Mbështet { dryRun: true } për testim.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

const FAIL_CONFIRM = 2;                  // dështime radhazi para se të nisë ora e shkëputjes
const ALERT_AFTER_MS = 10 * 60 * 1000;   // njofto pas 10 min shkëputje

interface Cfg {
  user_id: string; account_id: string; token: string; region: string;
  disconnect_since: string | null; disconnect_alerted: boolean;
  last_connected_at: string | null; conn_fail_count: number | null;
}

function clientHost(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

async function call(url: string, init: RequestInit, timeoutMs = 10000): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await resp.text();
  let body: unknown = text; try { body = JSON.parse(text); } catch { /* tekst */ }
  return { status: resp.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: row } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (row as { value?: string } | null)?.value;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch { /* injoro */ }

  let dryRun = false;
  try { const b = await req.json(); dryRun = b?.dryRun === true; } catch { /* pa trup */ }

  const out: Array<Record<string, unknown>> = [];
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const upd = async (uid: string, patch: Record<string, unknown>) => { if (!dryRun && Object.keys(patch).length) await db.from("metaapi_config").update(patch).eq("user_id", uid); };
  const notify = async (uid: string, title: string, body: string) => { if (!dryRun) await db.from("notifications").insert({ user_id: uid, type: "system", title, body }); };

  try {
    const { data: configs } = await db
      .from("metaapi_config")
      .select("user_id, account_id, token, region, disconnect_since, disconnect_alerted, last_connected_at, conn_fail_count")
      .eq("auto_trade", true);

    for (const raw of (configs ?? [])) {
      const cfg = raw as Cfg;
      if (!cfg.account_id || !cfg.token) continue;

      // Detektim: a po shërben të dhëna llogaria (200 me balance/equity)?
      let okConn = false;
      try {
        const r = await call(`${clientHost(cfg.region)}/users/current/accounts/${cfg.account_id}/account-information`, { headers: { "auth-token": cfg.token } });
        okConn = r.status === 200 && !!r.body && typeof r.body === "object" && (("balance" in (r.body as object)) || ("equity" in (r.body as object)));
      } catch { okConn = false; }

      if (okConn) {
        const patch: Record<string, unknown> = { last_connected_at: nowIso, conn_fail_count: 0, disconnect_since: null };
        let reconnected = false;
        if (cfg.disconnect_alerted) { patch.disconnect_alerted = false; reconnected = true; }
        await upd(cfg.user_id, patch);
        if (reconnected) await notify(cfg.user_id, "MT5 reconnected", "Your MT5 account is connected again — auto-trade has resumed.");
        out.push({ user: cfg.user_id, action: "connected", reconnected });
        continue;
      }

      // S'lidhet. Nëse llogaria S'ËSHTË lidhur KURRË (lastConn==0) → ndoshta e keqkonfiguruar → mos alarmo.
      // Por nëse është lidhur ndonjëherë, VAZHDO monitorimin sado gjatë të zgjasë ndërprerja — që ta
      // kapim rikthimin dhe të njoftojmë. (auto_trade=true → përdoruesi e DO të lidhur; s'duhet të heshtim.)
      const lastConn = cfg.last_connected_at ? new Date(cfg.last_connected_at).getTime() : 0;
      if (lastConn === 0) {
        out.push({ user: cfg.user_id, action: "never_connected(skip)" });
        continue;
      }

      // Aktive por s'lidhet → numëro dështimet, nis orën, alarmo pas 10 min.
      const failCount = (cfg.conn_fail_count ?? 0) + 1;
      const patch: Record<string, unknown> = { conn_fail_count: failCount };
      let sinceTs = cfg.disconnect_since ? new Date(cfg.disconnect_since).getTime() : 0;
      if (failCount >= FAIL_CONFIRM && !sinceTs) { sinceTs = now; patch.disconnect_since = nowIso; }
      let alerted = false;
      if (sinceTs && (now - sinceTs) >= ALERT_AFTER_MS && !cfg.disconnect_alerted) { patch.disconnect_alerted = true; alerted = true; }
      await upd(cfg.user_id, patch);
      if (alerted) await notify(cfg.user_id, "MT5 connection lost", "Your account lost its MetaApi connection ~10 min ago and is not trading. Open MetaApi and redeploy/reconnect the account (it must be Deployed + Connected/green), or check the broker server.");
      out.push({ user: cfg.user_id, action: "fail", failCount, downMin: sinceTs ? Math.round((now - sinceTs) / 60000) : 0, alerted });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, dryRun, checked: out.length, out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
