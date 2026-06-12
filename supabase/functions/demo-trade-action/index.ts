import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// demo-trade-action — hapje/mbyllje MANUALE e trade-ve virtuale nga klienti (faqja "Tregto Demo").
// Kërkon JWT-në e përdoruesit; shkruan me service role (pa prekur RLS). Asnjë para reale.
//   POST { action:'open', side:'buy'|'sell', volume, sl?, tp?, symbol?, signal_id? }
//   POST { action:'close', id }
// Hapja bëhet me ÇMIMIN REAL aktual të arit; mbyllja llogarit P&L-në në € dhe përditëson demo_balance.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
function normSym(s: string): string { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function valuePerPrice(symbol: string): number {
  const s = normSym(symbol);
  if (s.includes("XAU") || s.includes("GOLD")) return 100;
  if (s.includes("OIL") || s.includes("WTI") || s.includes("BRENT")) return 1000;
  return 100000;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "invalid_token" }, 401);

  const db = createClient(url, svc);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "");

  // Çmimi aktual sipas simbolit.
  const { data: assetRows } = await db.from("assets").select("symbol, current_price");
  const priceBy = new Map<string, number>();
  for (const a of (assetRows ?? []) as { symbol: string; current_price: number | null }[]) {
    if (a.current_price != null) priceBy.set(normSym(a.symbol), Number(a.current_price));
  }

  try {
    if (action === "open") {
      const side = String(body.side || "").toLowerCase();
      if (side !== "buy" && side !== "sell") return json({ error: "bad_side" }, 400);
      const symbol = String(body.symbol || "XAUUSD");
      const vol = Number(body.volume);
      if (!(vol >= 0.01 && vol <= 100)) return json({ error: "bad_volume" }, 400);
      const price = priceBy.get(normSym(symbol));
      if (price == null || !(price > 0)) return json({ error: "no_price" }, 400);
      const sl = body.sl != null && body.sl !== "" ? Number(body.sl) : null;
      const tp = body.tp != null && body.tp !== "" ? Number(body.tp) : null;
      const signal_id = body.signal_id ? String(body.signal_id) : null;
      // Mbroj nga gabimi: SL/TP në anën e duhur (përndryshe i lëmë bosh që roboti t'i menaxhojë).
      const slOk = sl == null || (side === "buy" ? sl < price : sl > price);
      const tpOk = tp == null || (side === "buy" ? tp > price : tp < price);
      const { error } = await db.from("demo_trades").insert({
        user_id: user.id, signal_id, symbol, side, volume: vol,
        entry_price: price, sl: slOk ? sl : null, tp: tpOk ? tp : null, status: "open",
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, entry: price });
    }

    if (action === "close") {
      const id = String(body.id || "");
      if (!id) return json({ error: "bad_id" }, 400);
      const { data: t } = await db.from("demo_trades")
        .select("id, symbol, side, volume, entry_price, status")
        .eq("id", id).eq("user_id", user.id).eq("status", "open").maybeSingle();
      if (!t) return json({ error: "not_found" }, 404);
      const price = priceBy.get(normSym(t.symbol as string));
      if (price == null || !(price > 0)) return json({ error: "no_price" }, 400);
      const isBuy = String(t.side).toLowerCase() === "buy";
      const profit = (price - Number(t.entry_price)) * (isBuy ? 1 : -1) * Number(t.volume) * valuePerPrice(t.symbol as string);
      const rp = Math.round(profit * 100) / 100;
      await db.from("demo_trades").update({
        status: "closed", exit_price: price, exit_reason: "manual", profit: rp, closed_at: new Date().toISOString(),
      }).eq("id", id);
      const { data: p } = await db.from("profiles").select("demo_balance").eq("id", user.id).maybeSingle();
      const newBal = Math.round((Number(p?.demo_balance ?? 100) + profit) * 100) / 100;
      await db.from("profiles").update({ demo_balance: newBal }).eq("id", user.id);
      return json({ ok: true, profit: rp, balance: newBal });
    }

    return json({ error: "bad_action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
