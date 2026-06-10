import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// lab-trades — Super Admin → ProTrade Lab: MËSIMI nga trade-t REALE të llogarisë aktive (marbaudoo).
// Vetëm-lexim: merr deal-et nga MT5, llogarit win-rate/expectancy/profit-factor sipas sesionit,
// strategjisë dhe simbolit. NUK prek robotin/sinjalet. Vetëm super-admin.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Deal { type?: string; profit?: number; commission?: number; swap?: number; symbol?: string; time?: string; comment?: string; brokerComment?: string; }
interface CD { net: number; symbol: string; scalp: boolean; hour: number; }

function clientHost(region: string) { return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`; }

function sessionOf(h: number): string {
  if (h >= 7 && h <= 11) return "Londra (07-12 UTC)";
  if (h >= 12 && h <= 15) return "Londra+NY (12-16 UTC)";
  if (h >= 16 && h <= 20) return "New York (16-21 UTC)";
  if (h < 7) return "Azia (00-07 UTC)";
  return "Vone (21-24 UTC)";
}

function stat(arr: CD[]) {
  const n = arr.length;
  const wins = arr.filter((d) => d.net > 0), losses = arr.filter((d) => d.net < 0);
  const gp = wins.reduce((s, d) => s + d.net, 0), gl = Math.abs(losses.reduce((s, d) => s + d.net, 0));
  const net = arr.reduce((s, d) => s + d.net, 0);
  const wr = n ? wins.length / n : 0;
  return {
    n, wins: wins.length, losses: losses.length,
    winRate: Math.round(wr * 100), net: +net.toFixed(2),
    avgWin: +(wins.length ? gp / wins.length : 0).toFixed(2),
    avgLoss: +(losses.length ? -gl / losses.length : 0).toFixed(2),
    expectancy: +(n ? net / n : 0).toFixed(2),
    profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : (gp > 0 ? 999 : 0),
  };
}

function groupStats(arr: CD[], keyFn: (d: CD) => string) {
  const m = new Map<string, CD[]>();
  for (const d of arr) { const k = keyFn(d); if (!m.has(k)) m.set(k, []); m.get(k)!.push(d); }
  return [...m.entries()].map(([label, a]) => ({ label, ...stat(a) })).sort((x, y) => y.net - x.net);
}

async function claudeAdvise(db: ReturnType<typeof createClient>, payload: unknown): Promise<unknown> {
  const { data: prov } = await db.from("ai_providers").select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
  const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
  if (!key) return { error: "Pa celes Claude te konfiguruar." };
  const model = (prov as { model?: string }).model || "claude-opus-4-8";
  const sys = "Je analist sasior tregtimi. Merr statistika REALE te trade-ve te nje llogarie demo ari (overall + sipas sesionit + strategjise). " +
    "Beso VETEM grupet me n>=10 (mostra te vogla = rastesi). Identifiko ku eshte me efikas (sesion/strategji) dhe jep sugjerime KONKRETE e KONSERVATORE per te rritur efikasitetin pa mbi-pershtatje. " +
    "Paralajmero per mostra te vogla; rekomando validim ne DEMO. Pergjigju VETEM me JSON ne SHQIP: {\"insights\":[\"...\"],\"suggestions\":[{\"title\":\"...\",\"detail\":\"...\"}],\"caution\":\"...\"}.";
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 2500, system: sys, messages: [{ role: "user", content: JSON.stringify(payload) }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { error: `Claude error ${resp.status}` };
    const data = await resp.json(); const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/); if (!m) return { error: "Claude pa JSON." };
    try { return JSON.parse(m[0]); } catch { return { error: "Claude ktheu nje pergjigje te paplote — kliko perseri." }; }
  } catch (e) { return { error: `Claude exception: ${(e as Error).message}` }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await svc.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!(prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const { data: lt } = await svc.from("trade_executions").select("user_id").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const targetUser = (body as { userId?: string })?.userId || (lt as { user_id?: string } | null)?.user_id;
    if (!targetUser) return json({ error: "no_account" });
    const { data: cfg } = await svc.from("metaapi_config").select("account_id, token, region").eq("user_id", targetUser).maybeSingle();
    const c = cfg as { account_id?: string; token?: string; region?: string } | null;
    if (!c?.account_id || !c?.token) return json({ error: "no_config" });

    const days = 30;
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const end = new Date().toISOString();
    const dealsUrl = `${clientHost(c.region || "london")}/users/current/accounts/${c.account_id}/history-deals/time/${encodeURIComponent(start)}/${encodeURIComponent(end)}`;
    let deals: Deal[] = [];
    try {
      const resp = await fetch(dealsUrl, { headers: { "auth-token": c.token }, signal: AbortSignal.timeout(20000) });
      if (!resp.ok) return json({ error: "syncing", status: resp.status });
      const b = await resp.json(); if (Array.isArray(b)) deals = b as Deal[];
    } catch (e) { return json({ error: "fetch_failed", detail: String(e) }); }

    const closing: CD[] = deals
      .filter((d) => (d.type === "DEAL_TYPE_BUY" || d.type === "DEAL_TYPE_SELL") && Number(d.profit) !== 0)
      .map((d) => ({
        net: (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0),
        symbol: String(d.symbol || "?"),
        scalp: /scalp/i.test(String(d.comment ?? "") + String(d.brokerComment ?? "")),
        hour: new Date(d.time || 0).getUTCHours(),
      }));

    const result: Record<string, unknown> = {
      account: String(c.account_id).slice(0, 8), days, total: closing.length,
      overall: stat(closing),
      bySession: groupStats(closing, (d) => sessionOf(d.hour)),
      byStrategy: groupStats(closing, (d) => d.scalp ? "Scalp (afat-shkurt)" : "Swing/Tjeter"),
      bySymbol: groupStats(closing, (d) => d.symbol),
    };
    if ((body as { advise?: boolean })?.advise && closing.length >= 10) {
      result.advice = await claudeAdvise(svc, { overall: result.overall, bySession: result.bySession, byStrategy: result.byStrategy });
    }
    return json(result);
  } catch (e) { return json({ error: String(e) }, 500); }
});
