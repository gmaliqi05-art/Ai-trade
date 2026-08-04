import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-whatif — "Po ta kishte lënë siç e dha sinjali, çfarë do të kishte ndodhur?"
//
// Rasti që e lindi (kërkesë e pronarit, 4 gusht 2026): roboti hyn me Entry/SL/TP sipas sinjalit.
// Gjatë tregtisë përdoruesi e afron SL-në, qiriri e prek, dhe ai humbet — ndërsa çmimi më pas
// kthehet dhe do ta kishte arritur TP-në. Pastaj thotë "sinjalet nuk punojnë".
//
// Ky funksion e zgjidh atë me të dhëna, jo me fjalë: merr qirinjtë PAS mbylljes dhe kontrollon
// cilin nivel ORIGJINAL do ta kishte prekur i pari — TP-në apo SL-në.
//
// Nuk hamendëson kurrë. Nëse brenda dritares nuk preket asnjëri, e thotë hapur: e papërcaktuar.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function marketDataHost(region: string) {
  return `https://mt-market-data-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

type Candle = { time?: string; brokerTime?: string; high?: number; low?: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Vetëm admini. Identiteti merret nga JWT-ja e thirrësit, jo nga trupi i kërkesës.
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid_token" }, 401);
    const { data: me } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!me?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const tradeId = String(body.trade_id || "");
    if (!tradeId) return json({ error: "trade_id_required" }, 400);
    const hours = Math.min(Math.max(Number(body.hours) || 72, 1), 336); // 1 orë … 14 ditë

    const { data: t } = await db.from("telegram_trades")
      .select("user_id, symbol, action, entry_price, stop_loss, take_profit, orig_stop_loss, orig_take_profit, orig_backfilled, exit_price, net, closed_at, status")
      .eq("id", tradeId).maybeSingle();
    if (!t) return json({ error: "trade_not_found" }, 404);
    if (!t.closed_at) return json({ error: "trade_still_open" }, 400);

    const sl = Number(t.orig_stop_loss ?? t.stop_loss);
    const tp = Number(t.orig_take_profit ?? t.take_profit);
    if (!(sl > 0) || !(tp > 0)) return json({ error: "levels_missing" }, 400);

    const { data: cfg } = await db.from("metaapi_config")
      .select("account_id, token, region, symbol_map").eq("user_id", t.user_id).maybeSingle();
    if (!cfg?.account_id || !cfg?.token) return json({ error: "metaapi_not_configured" }, 400);

    // Emri i simbolit te brokeri (p.sh. XAUUSD → XAUUSD+ / XAUUSD.b) — i mësuar më parë.
    const map = (cfg.symbol_map ?? {}) as Record<string, string>;
    const sym = map[String(t.symbol).toUpperCase()] ?? String(t.symbol);

    // Qirinjtë ngarkohen PRAPA nga 'startTime', ndaj kërkojmë nga fundi i dritares dhe filtrojmë
    // përpara. 15m × 1000 mbulon ~10 ditë — mjaft për çdo dritare deri 14-ditëshe.
    const closed = new Date(t.closed_at as string).getTime();
    const until = new Date(Math.min(closed + hours * 3600_000, Date.now())).toISOString();
    const api = `${marketDataHost(cfg.region)}/users/current/accounts/${cfg.account_id}` +
      `/historical-market-data/symbols/${encodeURIComponent(sym)}/timeframes/15m/candles` +
      `?startTime=${encodeURIComponent(until)}&limit=1000`;
    const resp = await fetch(api, { headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(20000) });
    const txt = await resp.text();
    if (!resp.ok) return json({ error: "candles_failed", status: resp.status, details: txt.slice(0, 300) }, 502);

    let raw: unknown; try { raw = JSON.parse(txt); } catch { return json({ error: "candles_unparsable" }, 502); }
    const all = (Array.isArray(raw) ? raw : []) as Candle[];

    // Vetëm qirinjtë PAS mbylljes, në rend kohor.
    const after = all
      .map((c) => ({ t: new Date(String(c.brokerTime ?? c.time ?? "")).getTime(), hi: Number(c.high), lo: Number(c.low) }))
      .filter((c) => Number.isFinite(c.t) && c.t > closed && Number.isFinite(c.hi) && Number.isFinite(c.lo))
      .sort((a, b) => a.t - b.t);

    if (after.length === 0) return json({ ok: true, verdict: "unknown", reason: "no_candles", sl, tp, checked: 0 });

    // Ecim qiri për qiri dhe shohim cili nivel preket i pari. Kur një qiri i prek të dy, s'e dimë
    // radhën brenda tij — e themi hapur si 'ambiguous' në vend që të zgjedhim njërin.
    const isBuy = String(t.action).toUpperCase() === "BUY";
    let verdict = "undecided";
    let at: string | null = null;
    for (const c of after) {
      const hitTp = isBuy ? c.hi >= tp : c.lo <= tp;
      const hitSl = isBuy ? c.lo <= sl : c.hi >= sl;
      if (hitTp && hitSl) { verdict = "ambiguous"; at = new Date(c.t).toISOString(); break; }
      if (hitTp) { verdict = "tp"; at = new Date(c.t).toISOString(); break; }
      if (hitSl) { verdict = "sl"; at = new Date(c.t).toISOString(); break; }
    }

    return json({
      ok: true, verdict, at, sl, tp, symbol: sym,
      checked: after.length, hours,
      from: new Date(closed).toISOString(),
      // Nëse nivelet janë mbushur retroaktivisht, mund të mos jenë ato origjinale — thuaje.
      approx_levels: t.orig_backfilled === true,
      actual_exit: t.exit_price, actual_net: t.net,
    });
  } catch (e) {
    return json({ error: "server_error", message: (e as Error).message }, 500);
  }
});
